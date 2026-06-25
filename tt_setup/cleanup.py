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
from rich.table import Table
from tt_setup.console import console, kept_panel, notice_panel, step
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
    """Best-effort size of the Docker objects --purge-all removes.

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


def _deployed_model_names(has_docker_access):
    """Names of currently-running model deployment containers (vLLM / YOLO / TTS …),
    i.e. tt-inference-server / media-inference-server images — distinct from the
    frontend/backend/agent/chroma app stack. Read-only.

    Runs `docker ps` WITHOUT sudo so just showing a count never triggers a password
    prompt. Returns None if docker is inaccessible (so callers show "preserved"
    rather than a misleading "none"), [] if nothing is running, else the names.
    """
    if not has_docker_access:
        return None
    model_globs = ("*tt-inference-server*", "*tt-media-inference-server*")
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode != 0:
            return None
        names = []
        for line in result.stdout.splitlines():
            if "\t" not in line:
                continue
            name, image = line.split("\t", 1)
            if any(fnmatch.fnmatch(image, g) for g in model_globs):
                names.append(name.strip())
        return names
    except Exception:
        return None


def _print_preserved_summary(has_docker_access):
    """Panel summarising what a plain --stop leaves in place, with a clear
    next-step for wiping it — so users aren't left guessing what survived."""
    names = _deployed_model_names(has_docker_access)
    if names is None:
        models = "[muted]left running (not checked)[/muted]"
    elif not names:
        models = "[muted]none running[/muted]"
    else:
        more = "…" if len(names) > 1 else ""
        models = f"[accent]{len(names)} still running[/accent][muted] · {names[0]}{more}[/muted]"

    rows = [
        ("Model deployments", models),
        ("Config & secrets", "app/.env"),
        ("Saved data", "model weights, chat history, RAG"),
    ]
    footer = ["[muted]Remove these too →[/muted]  [accent]python run.py --purge-all[/accent]"]
    console.print()
    console.print(kept_panel("[bold]Preserved[/bold]", rows, footer))


def cleanup_resources(args):
    """Clean up TT Studio Docker resources, and (with --purge-all) all persistent state."""
    full_cleanup = bool(getattr(args, "cleanup_all", False))
    assume_yes = bool(getattr(args, "yes", False))

    if not full_cleanup:
        console.print("\n[bold]🧹 Cleaning up TT Studio[/bold]")
        has_access = check_docker_access()
        _cleanup_runtime(args, has_access)

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

        _print_preserved_summary(has_access)
        console.print("\n[bold success]✓ Cleanup complete[/bold success]")
        return

    # --- --purge-all: build full inventory and ask once ---
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
        ("📜", logs_dir, "host-side logs & PID files"),
    ]
    log_items += [
        ("📜", os.path.join(TT_STUDIO_ROOT, name), "legacy host log")
        for name in (
            "model_run.log", "model_run_logs",
            "fastapi.log", "fastapi.pid", "fastapi_logs",
            "startup.log", "docker-control-service.log", "docker-control-service.pid",
        )
    ]

    items = [
        ("📁", host_persistent_volume,
         "HF token, deploy history, RAG DB, model weights"),
        ("⚙️ ", ENV_FILE_PATH,
         "config & secrets (Django key, tokens)"),
        ("🔧", artifacts_root,
         "inference-server download + tarball"),
        *log_items,
        ("⚙️ ", PREFS_FILE_PATH, "CLI preferences"),
        ("⚙️ ", SETUP_CONFIG_FILE_PATH, "quick-setup snapshot"),
        ("⚙️ ", LEGACY_SETUP_CONFIG_FILE_PATH, "legacy setup snapshot"),
        ("🎙️ ", os.path.join(TT_STUDIO_ROOT, "output.wav"), "TTS scratch"),
        ("🎙️ ", os.path.join(TT_STUDIO_ROOT, "speech.wav"), "STT scratch"),
        ("🐍", os.path.join(INFERENCE_API_DIR, ".venv"),
         "inference-api virtualenv"),
        ("🐍", os.path.join(DOCKER_CONTROL_SERVICE_DIR, ".venv"),
         "docker-control virtualenv"),
        ("🐍", os.path.join(TT_STUDIO_ROOT, ".workflow_venvs"),
         "workflow virtualenvs"),
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

    # --- Danger header ---
    console.print()
    console.print(notice_panel(
        "[bold]⚠  --purge-all · full reset[/bold]",
        [
            "Resets TT Studio to a fresh-clone state.",
            "[bold]Everything below is permanently deleted — this cannot be undone.[/bold]",
        ],
        border_style="error",
    ))

    def _table():
        t = Table(box=None, show_header=False, padding=(0, 2), pad_edge=False)
        t.add_column(no_wrap=True)                                       # icon
        t.add_column(no_wrap=True)                                       # name
        t.add_column(justify="right", no_wrap=True, style="muted")       # size
        t.add_column(style="muted", overflow="fold")                    # description
        return t

    # --- Files on disk ---
    console.print("\n[bold]Files on disk[/bold]")
    if existing:
        files = _table()
        for emoji, path, desc, size in existing:
            rel = os.path.relpath(path, TT_STUDIO_ROOT)
            files.add_row(emoji, rel, _format_bytes(size) if size > 0 else "—", desc)
        console.print(files)
    else:
        console.print("  [muted]none found[/muted]")

    # --- Docker objects ---
    def _dsize(key):
        return f"~{_format_bytes(docker_sizes[key])}" if docker_sizes[key] > 0 else ""

    console.print("\n[bold]Docker[/bold]")
    docker = _table()
    docker.add_row("🐳", "Deployment containers", "", "vLLM, YOLO, … on tt_studio_network")
    docker.add_row("💾", "Model-weight volumes", _dsize("model_volumes"), f"{_CLEANUP_VOLUME_PREFIX}*")
    docker.add_row("💾", "Anonymous volumes", _dsize("anon_volumes"), "dangling (dev node_modules, …)")
    docker.add_row("🐳", "Local images", _dsize("images"), "tt-studio, tt-inference-server, chroma")
    console.print(docker)

    # --- Browser ---
    console.print("\n[bold]Browser[/bold]")
    console.print("  🌐 [muted]chat history, theme, login — cleared on next page load[/muted]")

    # --- Reclaim total + final warning ---
    if total_bytes > 0:
        console.print(f"\n[bold]Reclaims ≈ {_format_bytes(total_bytes)}[/bold] [error]· cannot be undone[/error]")
    else:
        console.print("\n[error]This cannot be undone.[/error]")

    if not assume_yes:
        while True:
            try:
                confirm = console.input("\n[warning]Proceed with full reset?[/warning] [muted](y/yes or n/no)[/muted] ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                console.print("\n[warning]🛑 Aborted — nothing was deleted.[/warning]")
                return
            if confirm in ("y", "yes"):
                break
            if confirm in ("n", "no", ""):
                console.print("\n[info]🛑 Aborted — nothing was deleted.[/info]")
                return
            console.print("[muted]Please answer y/yes or n/no.[/muted]")
    else:
        console.print("\n[muted]--yes passed; proceeding without prompt.[/muted]")

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
    (vLLM, TTS, STT, …) survive a plain ``--stop`` so loaded models keep
    serving across a TT Studio restart; ``--purge-all`` still removes them
    as part of the full reset."""
    full_cleanup = bool(getattr(args, "cleanup_all", False))

    # Collapse the whole teardown into one step that resolves to a single line
    # listing what was stopped. spinner=False because stopping host services may
    # trigger a sudo password prompt (660 sockets / root-owned PID files), which
    # a live spinner would clash with.
    with step("Stopping services", spinner=False) as s:
        stopped = []

        # Plain --stop preserves deployments (summarised in the Preserved
        # panel afterwards); --purge-all removes them first so the later
        # network removal / weight deletion isn't blocked by running processes.
        if full_cleanup:
            removed = _remove_tt_studio_network_containers(has_docker_access)
            if removed:
                stopped.append(f"{removed} deployment(s)")

        docker_compose_cmd = build_docker_compose_command(
            dev_mode=args.dev, show_hardware_info=False, quiet=True)
        docker_compose_cmd.extend(["down", "-v"])
        try:
            run_docker_command(docker_compose_cmd, use_sudo=not has_docker_access, capture_output=True)
            stopped.append("containers")
        except Exception:
            pass

        # Only --purge-all removes the network — preserved deployments stay
        # attached to it for DNS so the backend can reconnect after a restart.
        if full_cleanup:
            try:
                run_docker_command(["docker", "network", "rm", "tt_studio_network"],
                                    use_sudo=not has_docker_access, capture_output=True)
                stopped.append("network")
            except Exception:
                pass

        cleanup_fastapi_server(no_sudo=args.no_sudo)
        cleanup_docker_control_service(no_sudo=args.no_sudo)
        stopped += ["FastAPI", "Docker Control"]

        s.detail(" · ".join(stopped))
