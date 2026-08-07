# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Low-level resource-removal + inventory helpers for cleanup: docker objects,
host paths, byte accounting, daemon/port probes. Pure operations — no console
output beyond plain warnings, no orchestration."""

import os
import subprocess
import time
import shutil
import json
import re
import fnmatch
from tt_setup.constants import *
from tt_setup.constants import _CLEANUP_IMAGE_REFS, _CLEANUP_VOLUME_PREFIX


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


def _remove_path_with_docker(path):
    """Remove a path via an ephemeral root container, using the user's Docker
    access instead of host sudo. Handles files left owned by container users
    (root / uid 1000). Returns True if the path is gone afterward.
    """
    if not os.path.exists(path) and not os.path.islink(path):
        return True
    abs_path = os.path.abspath(path)
    parent, name = os.path.dirname(abs_path), os.path.basename(abs_path)
    # Guard against root-ish paths: an empty basename would turn
    # `rm -rf /target/{name}` into wiping the entire mounted parent.
    if abs_path in ("", os.path.sep) or not parent or name in ("", ".", ".."):
        print(f"{C_YELLOW}⚠️  Refusing to remove root/suspicious path via cleanup container: {abs_path}{C_RESET}")
        return False
    try:
        subprocess.run(
            ["docker", "run", "--rm", "-v", f"{parent}:/target",
             "alpine", "rm", "-rf", f"/target/{name}"],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or str(e)).strip()
        print(f"{C_YELLOW}⚠️  Container cleanup failed for {path}: {detail}{C_RESET}")
        return False
    except FileNotFoundError:
        print(f"{C_YELLOW}⚠️  Container cleanup failed for {path}: docker not found on PATH{C_RESET}")
        return False
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Container cleanup failed for {path}: {e}{C_RESET}")
        return False
    return not os.path.exists(path)


def _remove_path(path, no_sudo=False):
    """Remove a file or directory, falling back to a cleanup container on
    PermissionError (files left owned by a container user).

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
        return _remove_path_with_docker(path)
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


def _container_pycache_dirs():
    """__pycache__ dirs that the backend/agent containers compiled into the
    bind-mounted source tree in older installs (often root-owned; issue #1154).
    Containers now set PYTHONDONTWRITEBYTECODE, so these only exist as
    leftovers from previous versions."""
    dirs = []
    for rel in (("app", "backend"), ("app", "agent")):
        root = os.path.join(TT_STUDIO_ROOT, *rel)
        for cur, subdirs, _files in os.walk(root):
            if "__pycache__" in subdirs:
                dirs.append(os.path.join(cur, "__pycache__"))
                subdirs.remove("__pycache__")
    return sorted(dirs)


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


def _docker_volume_names(has_docker_access):
    """Names of the docker named volumes that hold model weights (volume_id_*).
    Read-only counterpart of `_remove_tt_studio_model_volumes` — same listing
    and prefix re-check, no removal. Returns [] on any error."""
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "volume", "ls", "--filter",
                           f"name={_CLEANUP_VOLUME_PREFIX}", "-q"],
            capture_output=True, text=True, check=False,
        )
        return [n for n in (line.strip() for line in result.stdout.splitlines())
                if n.startswith(_CLEANUP_VOLUME_PREFIX)]
    except Exception:
        return []


def _docker_object_sizes(has_docker_access):
    """Per-object sizes from `docker system df -v`: ({volume_name: bytes},
    {"repo:tag": bytes}). Best-effort — empty dicts if docker is unavailable."""
    volumes, images = {}, {}
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "system", "df", "-v", "--format", "json"],
            capture_output=True, text=True, check=False,
        )
        data = json.loads(result.stdout)
    except Exception:
        return volumes, images
    for vol in data.get("Volumes") or []:
        name = vol.get("Name", "")
        if name:
            volumes[name] = _parse_size_to_bytes(vol.get("Size", ""))
    for img in data.get("Images") or []:
        repo, tag = img.get("Repository", ""), img.get("Tag", "")
        if repo and tag:
            images[f"{repo}:{tag}"] = _parse_size_to_bytes(img.get("Size", ""))
    return volumes, images


def _remove_docker_containers(ids, has_docker_access):
    """Force-remove specific containers (+ their anonymous volumes). Accepts
    names or ids; already-gone containers are harmless. Returns count requested."""
    ids = [i for i in ids if i]
    if not ids:
        return 0
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        subprocess.run(
            sudo_prefix + ["docker", "rm", "-fv", *ids],
            capture_output=True, check=False,
        )
        return len(ids)
    except Exception:
        return 0


def _remove_docker_volumes(names, has_docker_access):
    """Force-remove specific named volumes. Returns (removed_names, in_use_names):
    a volume still attached to a running container fails with "in use" and is
    reported so callers can tell the user to stop the deployment first."""
    names = [n for n in names if n]
    removed, in_use = [], []
    sudo_prefix = ["sudo"] if not has_docker_access else []
    for name in names:
        try:
            result = subprocess.run(
                sudo_prefix + ["docker", "volume", "rm", "-f", name],
                capture_output=True, text=True, check=False,
            )
            if result.returncode == 0:
                removed.append(name)
            elif "in use" in (result.stderr or "").lower():
                in_use.append(name)
        except Exception:
            continue
    return removed, in_use


def _remove_image_ref(repo_tag, has_docker_access):
    """Remove the image matching one exact repo:tag reference. Unlike
    `_remove_local_tt_studio_images` this never uses the `_CLEANUP_IMAGE_REFS`
    globs — model images are shared across models, so purge-model callers must
    reference-count first and pass only tags no kept model still needs.
    Returns True if an image was removed."""
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "image", "ls", "--filter",
                           f"reference={repo_tag}", "-q"],
            capture_output=True, text=True, check=False,
        )
        ids = list(dict.fromkeys(
            line.strip() for line in result.stdout.splitlines() if line.strip()))
        if not ids:
            return False
        subprocess.run(
            sudo_prefix + ["docker", "image", "rm", "-f", *ids],
            capture_output=True, check=False,
        )
        return True
    except Exception:
        return False


def _port_owned_by_root(port):
    """Best-effort: True if the process LISTENing on `port` is owned by root (so
    stopping it will need sudo). Returns False on any error — never raises."""
    try:
        pids = subprocess.run(
            ["lsof", "-ti", f":{port}", "-sTCP:LISTEN"],
            capture_output=True, text=True, timeout=5,
        )
        pid = (pids.stdout or "").strip().split("\n")[0].strip()
        if not pid:
            return False
        owner = subprocess.run(
            ["ps", "-o", "user=", "-p", pid],
            capture_output=True, text=True, timeout=5,
        )
        return owner.stdout.strip() == "root"
    except Exception:
        return False


def _docker_daemon_status():
    """Classify Docker availability so teardown can react without leaking the raw
    'Cannot connect to the Docker daemon' error:
      'ok'      — `docker info` works (daemon reachable, no sudo)
      'sudo'    — permission denied (daemon likely up; needs sudo)
      'down'    — daemon not reachable / not running
      'missing' — docker not installed
    """
    if not shutil.which("docker"):
        return "missing"
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
    except Exception:
        return "down"
    if r.returncode == 0:
        return "ok"
    err = (r.stderr or "").lower()
    if "permission denied" in err:
        return "sudo"
    return "down"  # cannot connect / connection refused / daemon not running / etc.
