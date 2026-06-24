# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Resource cleanup: containers, images, volumes, runtime processes."""

import os
import sys
import subprocess
import time
import shutil
import json
import re
import fnmatch
from tt_setup.constants import *
from tt_setup.constants import _CLEANUP_IMAGE_REFS, _CLEANUP_VOLUME_PREFIX
from tt_setup.console import console, step
from tt_setup.docker import build_docker_compose_command, check_docker_access, run_docker_command
from tt_setup.env_config import get_env_var, is_first_time_setup, save_preference
from tt_setup.services import cleanup_docker_control_service, cleanup_fastapi_server


def _format_bytes(size):
    """Format a byte count as a human-readable string."""
    if size is None or size < 0:
        return "?"
    units = ["B", "KB", "MB", "GB", "TB"]
    f = float(size)
    for u in units:
        if f < 1024.0 or u == units[-1]:
            return f"{f:.1f} {u}" if u != "B" else f"{int(f)} {u}"
        f /= 1024.0
    return f"{f:.1f} {units[-1]}"


def _path_size(path):
    """Best-effort recursive size of a file or directory in bytes; 0 if unreadable."""
    try:
        if not os.path.exists(path):
            return 0
        if os.path.isfile(path) or os.path.islink(path):
            try:
                return os.path.getsize(path)
            except OSError:
                return 0
        total = 0
        for root, dirs, files in os.walk(path, onerror=lambda _: None):
            for name in files:
                fp = os.path.join(root, name)
                try:
                    if not os.path.islink(fp):
                        total += os.path.getsize(fp)
                except OSError:
                    continue
        return total
    except Exception:
        return 0


def _remove_path(path, no_sudo=False):
    """Remove a file or directory, falling back to sudo on PermissionError when allowed.

    Returns True if removed (or did not exist), False otherwise.
    """
    if not os.path.exists(path) and not os.path.islink(path):
        return True
    try:
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        return True
    except PermissionError:
        if no_sudo:
            print(f"{C_YELLOW}⚠️  Permission denied removing {path} (no sudo).{C_RESET}")
            return False
        try:
            subprocess.run(["sudo", "rm", "-rf", path], check=True)
            return True
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Failed to remove {path} with sudo: {e}{C_RESET}")
            return False
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Failed to remove {path}: {e}{C_RESET}")
        return False


def _remove_directory_contents(path, preserve_names=None, no_sudo=False):
    """Remove generated contents from a directory while keeping named entries."""
    if not os.path.isdir(path):
        return True
    preserve_names = set(preserve_names or [])
    ok = True
    for name in os.listdir(path):
        if name in preserve_names:
            continue
        if not _remove_path(os.path.join(path, name), no_sudo=no_sudo):
            ok = False
    try:
        if not os.listdir(path):
            os.rmdir(path)
    except OSError:
        pass
    return ok


def _parse_size_to_bytes(s):
    """Parse a docker-formatted size string (e.g. "39.42GB", "545kB", "32B") to bytes.

    Docker reports sizes in SI units (base 1000) via go-units, so this is the
    inverse of `_format_bytes` but decimal — used only to total the daemon's own
    numbers, not for display. Returns 0 on anything unparseable.
    """
    if not s:
        return 0
    m = re.match(r"\s*([0-9]*\.?[0-9]+)\s*([kKMGTP]?B)\s*$", s)
    if not m:
        return 0
    value, unit = float(m.group(1)), m.group(2).upper()
    factor = {"B": 1, "KB": 10**3, "MB": 10**6,
              "GB": 10**9, "TB": 10**12, "PB": 10**15}.get(unit, 1)
    return int(value * factor)


def _docker_reclaimable_bytes(has_docker_access):
    """Best-effort size of the Docker objects --cleanup-all removes.

    Reads `docker system df -v --format json` (the daemon already computes exact
    sizes) and sums the images and volumes cleanup-all actually deletes:
      - images whose Repository matches `_CLEANUP_IMAGE_REFS`
        (same set `_remove_local_tt_studio_images` removes),
      - `volume_id_*` model-weight volumes (`_remove_tt_studio_model_volumes`)
        plus dangling anonymous volumes (`_prune_anonymous_volumes`).
    Build cache is intentionally excluded — cleanup-all does not prune it.
    Returns {"images", "model_volumes", "anon_volumes"} byte counts; zeros if
    docker is unavailable, so the reclaim total degrades to the host-side paths
    just like before.
    """
    zero = {"images": 0, "model_volumes": 0, "anon_volumes": 0}
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "system", "df", "-v", "--format", "json"],
            capture_output=True, text=True, check=False,
        )
        data = json.loads(result.stdout)
    except Exception:
        return zero

    sizes = dict(zero)
    for img in data.get("Images") or []:
        repo = img.get("Repository", "")
        if any(fnmatch.fnmatch(repo, ref) for ref in _CLEANUP_IMAGE_REFS):
            sizes["images"] += _parse_size_to_bytes(img.get("Size", ""))

    for vol in data.get("Volumes") or []:
        name = vol.get("Name", "")
        if name.startswith(_CLEANUP_VOLUME_PREFIX):
            sizes["model_volumes"] += _parse_size_to_bytes(vol.get("Size", ""))
        elif "com.docker.volume.anonymous" in (vol.get("Labels") or ""):
            sizes["anon_volumes"] += _parse_size_to_bytes(vol.get("Size", ""))

    return sizes


def _remove_local_tt_studio_images(has_docker_access):
    """Remove TT Studio + inference-server + chroma images. Returns count removed."""
    sudo_prefix = ["sudo"] if not has_docker_access else []
    ids = []
    try:
        for ref in _CLEANUP_IMAGE_REFS:
            result = subprocess.run(
                sudo_prefix + ["docker", "image", "ls", "--filter",
                               f"reference={ref}", "-q"],
                capture_output=True, text=True, check=False,
            )
            ids.extend(line.strip() for line in result.stdout.splitlines() if line.strip())
        ids = list(dict.fromkeys(ids))
        if not ids:
            return 0
        subprocess.run(
            sudo_prefix + ["docker", "image", "rm", "-f", *ids],
            capture_output=True, check=False,
        )
        return len(ids)
    except Exception:
        return 0


def _remove_tt_studio_model_volumes(has_docker_access):
    """Remove docker named volumes that hold model weights (volume_id_*).

    Deployment containers attach to volumes named via
    `volume_{model_id}` (see app/backend/shared_config/model_config.py); each
    one stores weights for one model. These survive `compose down -v` because
    they are not declared in docker-compose.yml — they are created by the
    inference-server side of the deployment pipeline. Callers must stop the
    containers using them first or `volume rm` will fail with "in use".
    Returns count removed.
    """
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "volume", "ls", "--filter",
                           f"name={_CLEANUP_VOLUME_PREFIX}", "-q"],
            capture_output=True, text=True, check=False,
        )
        # `--filter name=foo` is substring match; double-check the prefix in
        # Python so we never delete an unrelated volume that happens to contain
        # "volume_id_" mid-name.
        names = [n for n in (line.strip() for line in result.stdout.splitlines())
                 if n.startswith(_CLEANUP_VOLUME_PREFIX)]
        if not names:
            return 0
        subprocess.run(
            sudo_prefix + ["docker", "volume", "rm", "-f", *names],
            capture_output=True, check=False,
        )
        return len(names)
    except Exception:
        return 0


def _remove_tt_studio_network_containers(has_docker_access):
    """Force-remove every container attached to tt_studio_network + its anon volumes.

    Deployment containers (vLLM, YOLO, stable-diffusion, …) are spawned outside
    docker-compose by the backend via docker-control-service, so `compose down`
    never sees them. They all join `tt_studio_network`, which makes the network
    a reliable filter. `-v` ensures anonymous volumes (e.g. the frontend dev
    container's `/app/node_modules` anon volume from docker-compose.dev-mode.yml)
    don't orphan when we remove the container before `compose down -v` gets a
    chance to clean them. Returns count removed.
    """
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "ps", "-aq", "--filter", "network=tt_studio_network"],
            capture_output=True, text=True, check=False,
        )
        ids = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        # Media (TTS/STT) containers don't always join tt_studio_network reliably —
        # the post-deploy network-connect hook in inference-api/api.py is best-effort.
        # Fall back to image-ancestor so cleanup catches them anyway. See issue #825.
        for ref in _CLEANUP_IMAGE_REFS:
            anc = subprocess.run(
                sudo_prefix + ["docker", "ps", "-aq", "--filter", f"ancestor={ref}"],
                capture_output=True, text=True, check=False,
            )
            ids.extend(line.strip() for line in anc.stdout.splitlines() if line.strip())
        ids = list(dict.fromkeys(ids))
        if not ids:
            return 0
        subprocess.run(
            sudo_prefix + ["docker", "rm", "-fv", *ids],
            capture_output=True, check=False,
        )
        return len(ids)
    except Exception:
        return 0


def _prune_anonymous_volumes(has_docker_access):
    """Defensive sweep for dangling anonymous volumes left by prior runs.

    `docker volume prune` (without `--all`) only targets anonymous unused
    volumes — named volumes from other projects on the same host are safe.
    Catches orphans created before `_remove_tt_studio_network_containers`
    started using `-v` (e.g. the frontend dev container's node_modules anon
    volume that survived earlier cleanup attempts). Returns count removed.
    """
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        before = subprocess.run(
            sudo_prefix + ["docker", "volume", "ls", "-q"],
            capture_output=True, text=True, check=False,
        )
        before_set = {line.strip() for line in before.stdout.splitlines() if line.strip()}

        subprocess.run(
            sudo_prefix + ["docker", "volume", "prune", "--force"],
            capture_output=True, check=False,
        )

        after = subprocess.run(
            sudo_prefix + ["docker", "volume", "ls", "-q"],
            capture_output=True, text=True, check=False,
        )
        after_set = {line.strip() for line in after.stdout.splitlines() if line.strip()}
        return len(before_set - after_set)
    except Exception:
        return 0


def _write_browser_cleanup_sentinel():
    """Write a fresh cleanup token so the frontend wipes IndexedDB + localStorage on next load."""
    try:
        os.makedirs(os.path.dirname(BROWSER_CLEANUP_SENTINEL), exist_ok=True)
        token = str(int(time.time() * 1000))
        with open(BROWSER_CLEANUP_SENTINEL, "w") as f:
            f.write(token)
        return token
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Could not write browser cleanup sentinel: {e}{C_RESET}")
        return None


def cleanup_resources(args):
    """Clean up TT Studio Docker resources, and (with --cleanup-all) all persistent state."""
    full_cleanup = bool(getattr(args, "cleanup_all", False))
    assume_yes = bool(getattr(args, "yes", False))

    if not full_cleanup:
        console.print("\n[bold]🧹 Cleaning up TT Studio[/bold]")
        _cleanup_runtime(args, check_docker_access())

        # Unset the Welcome flag so the next bring-up re-runs first-run setup.
        # Normal path: rewrite the file in place to preserve saved secrets (HF token, etc.).
        # If the file is owned by root (Docker wrote it on the host volume), fall back via
        # _remove_path so the backend regenerates a fresh user_config.json on next start.
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or \
            os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        user_config_path = os.path.join(host_persistent_volume, "backend_volume", "user_config.json")
        if os.path.exists(user_config_path):
            with step("Resetting Welcome flag", spinner=False) as s:
                try:
                    with open(user_config_path, "r") as f:
                        cfg = json.load(f)
                    if cfg.pop("setup_complete", None) is not None:
                        with open(user_config_path, "w") as f:
                            json.dump(cfg, f, indent=2)
                        s.detail("setup_complete cleared")
                    else:
                        s.skip("already cleared")
                except PermissionError:
                    # Root-owned (Docker wrote it): remove so the backend regenerates it.
                    if _remove_path(user_config_path, no_sudo=args.no_sudo):
                        s.detail("removed root-owned user_config.json")
                    else:
                        s.fail()
                        s.detail("permission denied")
                except Exception as e:
                    s.fail()
                    s.detail(type(e).__name__)

        console.print("\n[bold success]✓ Cleanup complete[/bold success]")
        return

    # --- --cleanup-all: build full inventory and ask once ---
    host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or \
        os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
    artifacts_root = os.path.join(TT_STUDIO_ROOT, ".artifacts")

    # All host-side runtime logs + PID files now live under logs/, so the whole
    # directory is removed in one shot (it is always a proper subdir of the repo,
    # never the repo root itself). The repo-root entries that follow clear logs
    # left behind by TT Studio versions from before the logs/ consolidation +
    # rename — and the degenerate case where logs/ couldn't be created and the
    # files fell back to the repo root.
    logs_dir = os.path.join(TT_STUDIO_ROOT, "logs")
    log_items = [
        ("📜", logs_dir, "host-side runtime logs & PID files (startup, model run, docker-control)"),
    ]
    log_items += [
        ("📜", os.path.join(TT_STUDIO_ROOT, name), "legacy host-side log (pre-consolidation)")
        for name in (
            "model_run.log", "model_run_logs",
            "fastapi.log", "fastapi.pid", "fastapi_logs",
            "startup.log", "docker-control-service.log", "docker-control-service.pid",
        )
    ]

    items = [
        ("📁", host_persistent_volume,
         "HF token, JWT secret, deployment history, backend logs, RAG vector DB, model weights"),
        ("⚙️ ", ENV_FILE_PATH,
         "configuration & secrets (DJANGO_SECRET_KEY, RAG_ADMIN_PASSWORD, cloud auth tokens)"),
        ("🔧", artifacts_root,
         "downloaded inference server + workflow logs + release tarball"),
        *log_items,
        ("⚙️ ", PREFS_FILE_PATH, "CLI preferences"),
        ("⚙️ ", SETUP_CONFIG_FILE_PATH, "quick-setup snapshot"),
        ("⚙️ ", LEGACY_SETUP_CONFIG_FILE_PATH, "legacy quick-setup snapshot"),
        ("🎙️ ", os.path.join(TT_STUDIO_ROOT, "output.wav"), "TTS scratch output"),
        ("🎙️ ", os.path.join(TT_STUDIO_ROOT, "speech.wav"), "STT scratch output"),
        ("🐍", os.path.join(INFERENCE_API_DIR, ".venv"),
         "inference-api Python virtualenv"),
        ("🐍", os.path.join(DOCKER_CONTROL_SERVICE_DIR, ".venv"),
         "docker-control-service Python virtualenv"),
        ("🐍", os.path.join(TT_STUDIO_ROOT, ".workflow_venvs"),
         "workflow Python virtualenvs"),
    ]

    existing = [(emoji, path, desc, _path_size(path))
                for emoji, path, desc in items if os.path.exists(path) or os.path.islink(path)]
    host_bytes = sum(sz for _, _, _, sz in existing)

    # Measure the Docker objects we are about to remove while they still exist,
    # so both the estimate and the final "Reclaimed approximately X" reflect the
    # model volumes + images (tens of GB), not just the host-side files.
    has_docker_access = check_docker_access()
    docker_sizes = _docker_reclaimable_bytes(has_docker_access)
    total_bytes = host_bytes + sum(docker_sizes.values())

    print(f"\n{C_ORANGE}{C_BOLD}🗑️  --cleanup-all will reset TT Studio to a fresh-clone state.{C_RESET}")
    print(f"\n{C_BOLD}The following will be PERMANENTLY DELETED:{C_RESET}\n")

    if existing:
        path_w = max(len(os.path.relpath(p, TT_STUDIO_ROOT)) for _, p, _, _ in existing)
        path_w = min(max(path_w, 32), 56)
        for emoji, path, desc, size in existing:
            rel = os.path.relpath(path, TT_STUDIO_ROOT)
            size_str = _format_bytes(size) if size > 0 else "—"
            print(f"  {emoji} {rel:<{path_w}}  {size_str:>10}")
            print(f"       └─ {C_CYAN}{desc}{C_RESET}")
    else:
        print(f"  {C_CYAN}(no host-side state found){C_RESET}")

    def _docker_size(key):
        return f"  ({_format_bytes(docker_sizes[key])})" if docker_sizes[key] > 0 else ""

    print(f"\n  🐳 Running deployment containers on tt_studio_network (vLLM, YOLO, …)")
    print(f"  💾 Docker named volumes holding model weights ({_CLEANUP_VOLUME_PREFIX}*)"
          f"{_docker_size('model_volumes')}")
    print(f"  💾 Dangling anonymous Docker volumes (frontend dev node_modules, …)"
          f"{_docker_size('anon_volumes')}")
    print(f"  🐳 Local images: tt-studio/*, tt-inference-server/*, "
          f"tt-media-inference-server, chromadb/chroma{_docker_size('images')}")
    print(f"  🌐 Browser data (chat history, theme, login)  — wiped on next page load\n")

    if total_bytes > 0:
        print(f"  {C_BOLD}Estimated disk to reclaim: {_format_bytes(total_bytes)}{C_RESET}")

    print(f"\n{C_RED}{C_BOLD}This CANNOT be undone.{C_RESET}")

    if not assume_yes:
        try:
            confirm = input(f"\n{C_YELLOW}Proceed? [y/N]: {C_RESET}").strip().lower()
        except (KeyboardInterrupt, EOFError):
            print(f"\n{C_YELLOW}🛑 Cleanup aborted. Nothing was deleted.{C_RESET}")
            return
        if confirm not in ("y", "yes"):
            print(f"\n{C_CYAN}🛑 Cleanup aborted. Nothing was deleted.{C_RESET}")
            return
    else:
        print(f"\n{C_YELLOW}--yes passed; proceeding without prompt.{C_RESET}")

    console.print("\n[bold]🧹 Cleaning up TT Studio[/bold]")
    _cleanup_runtime(args, has_docker_access)

    # Sudo prompts for password when we lack Docker access — the live spinner
    # would clash with that prompt, so disable it in that case.
    docker_spinner = has_docker_access

    # Volumes must come before images: removing a volume while its image is
    # gone is fine; removing an image while a volume's container is gone is
    # also fine — but we want both done before the host-state wipe so the
    # final "Reclaimed approximately X" total is honest.
    with step("Removing model volumes", spinner=docker_spinner) as s:
        removed_vols = _remove_tt_studio_model_volumes(has_docker_access)
        s.detail(f"{removed_vols} volume(s)")

    with step("Pruning anonymous volumes", spinner=docker_spinner) as s:
        removed_anon = _prune_anonymous_volumes(has_docker_access)
        s.detail(f"{removed_anon} volume(s)")

    with step("Removing local images", spinner=docker_spinner) as s:
        removed = _remove_local_tt_studio_images(has_docker_access)
        s.detail(f"{removed} image(s)")

    with step("Removing host state", spinner=False) as s:
        removed_paths = 0
        for _, path, _, _ in existing:
            if path == os.path.join(TT_STUDIO_ROOT, ".workflow_venvs"):
                removed = _remove_directory_contents(
                    path,
                    preserve_names={".venv_bootstrap_uv"},
                    no_sudo=args.no_sudo,
                )
            else:
                removed = _remove_path(path, no_sudo=args.no_sudo)
            if removed:
                removed_paths += 1
        s.detail(f"{removed_paths}/{len(existing)} path(s)")

    with step("Arming browser wipe", spinner=False) as s:
        token = _write_browser_cleanup_sentinel()
        if not token:
            s.skip()

    console.print("\n[bold success]✓ Cleanup complete[/bold success]")
    if total_bytes > 0:
        print(f"   Reclaimed approximately {C_BOLD}{_format_bytes(total_bytes)}{C_RESET} from disk.")
    print(f"\n{C_CYAN}🌐 Browser data (chat history, theme, login) will auto-clear the")
    print(f"   next time you open http://localhost:3000.")
    print(f"   To clear immediately: DevTools → Application → Storage → Clear site data.{C_RESET}")


def _cleanup_runtime(args, has_docker_access):
    """Tear down host services and compose containers. Deployment containers
    (vLLM, TTS, STT, …) survive a plain ``--cleanup`` so loaded models keep
    serving across a TT Studio restart; ``--cleanup-all`` still removes them
    as part of the full reset."""
    full_cleanup = bool(getattr(args, "cleanup_all", False))
    # Sudo prompts for password when we lack Docker access — the live spinner
    # would clash with that prompt, so disable it in that case.
    docker_spinner = has_docker_access

    if full_cleanup:
        # Deployment containers (vLLM, etc.) live outside compose — kill them first
        # so the subsequent network removal and weight-directory deletion aren't
        # blocked by running processes holding bind mounts open.
        with step("Stopping deployments", spinner=docker_spinner) as s:
            deploys_removed = _remove_tt_studio_network_containers(has_docker_access)
            s.detail(f"{deploys_removed} container(s)")
    else:
        with step("Preserving deployments", spinner=False) as s:
            s.detail("use --cleanup-all to remove")

    docker_compose_cmd = build_docker_compose_command(
        dev_mode=args.dev, show_hardware_info=False, quiet=True)
    docker_compose_cmd.extend(["down", "-v"])
    with step("Stopping containers", spinner=docker_spinner) as s:
        try:
            run_docker_command(docker_compose_cmd, use_sudo=not has_docker_access, capture_output=True)
        except Exception:
            s.skip("nothing to stop")

    # Skip explicit network removal when deployments are preserved — they stay
    # attached to ``tt_studio_network`` and need it for DNS resolution so the
    # backend can reconnect after restart. ``compose down`` also tries to
    # remove the network and fails silently when external containers hold it.
    if full_cleanup:
        with step("Removing network", spinner=docker_spinner) as s:
            try:
                run_docker_command(["docker", "network", "rm", "tt_studio_network"],
                                    use_sudo=not has_docker_access, capture_output=True)
            except Exception:
                s.skip("not present")

    with step("Stopping FastAPI server", spinner=False):
        cleanup_fastapi_server(no_sudo=args.no_sudo)

    with step("Stopping Docker Control", spinner=False):
        cleanup_docker_control_service(no_sudo=args.no_sudo)
