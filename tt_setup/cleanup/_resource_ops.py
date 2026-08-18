# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Low-level resource-removal + inventory helpers for cleanup: docker objects,
host paths, byte accounting, daemon/port probes. Pure operations — no console
output beyond plain warnings, no orchestration."""

import os
import shlex
import subprocess
import time
import shutil
import json
import re
import fnmatch
from tt_setup.constants import *
from tt_setup.constants import (
    _CLEANUP_APP_VOLUME_PREFIX,
    _CLEANUP_APP_VOLUME_SUFFIX,
    _CLEANUP_IMAGE_REFS,
    _CLEANUP_VOLUME_PREFIX,
)


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


def _hf_cache_hub_dir():
    """HuggingFace hub cache dir TT Studio downloads model weights into — mirrors
    inference-api's _default_hf_home: HOST_HF_HOME → HF_HOME → ~/.cache/huggingface."""
    from tt_setup.env_config import get_env_var
    base = os.path.normpath(
        get_env_var("HOST_HF_HOME") or get_env_var("HF_HOME")
        or os.path.expanduser("~/.cache/huggingface")
    )
    # HF_HOME points at the cache root (hub lives under it); tolerate it already
    # pointing at the hub dir so we don't append a second /hub.
    return base if os.path.basename(base) == "hub" else os.path.join(base, "hub")


def _tt_studio_hf_repo_ids():
    """HF repo ids TT Studio can deploy, read from the backend model catalog."""
    catalog = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config",
        "models_from_inference_server.json",
    )
    try:
        with open(catalog) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    ids, stack = set(), [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            hid = node.get("hf_model_id")
            if isinstance(hid, str) and "/" in hid:
                ids.add(hid)
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return sorted(ids)


def _hf_cache_model_dirs():
    """(repo_id, path, size) for each catalog model present in the HF hub cache.

    Scoped to TT Studio's catalog so --purge-all clears the models it downloaded
    without touching the user's other HuggingFace-cached models (the same way it
    only removes `volume_id_*` volumes, not every Docker volume)."""
    hub = _hf_cache_hub_dir()
    if not os.path.isdir(hub):
        return []
    out = []
    for repo_id in _tt_studio_hf_repo_ids():
        path = os.path.join(hub, "models--" + repo_id.replace("/", "--"))
        if os.path.isdir(path):
            out.append((repo_id, path, _path_size(path)))
    return out


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


def _write_file_with_docker(path, content):
    """Overwrite `path` with `content` via an ephemeral root container, for
    files the host user can't write (left owned by a container user — e.g. the
    backend's deployments.json). Write-then-rename inside the container keeps
    the same atomic-replace behavior as the direct path. Returns True on
    success."""
    abs_path = os.path.abspath(path)
    parent, name = os.path.dirname(abs_path), os.path.basename(abs_path)
    if not parent or name in ("", ".", ".."):
        return False
    target, tmp = shlex.quote(f"/target/{name}"), shlex.quote(f"/target/{name}.tmp")
    try:
        subprocess.run(
            ["docker", "run", "--rm", "-i", "-v", f"{parent}:/target",
             "alpine", "sh", "-c", f"cat > {tmp} && mv {tmp} {target}"],
            input=content, text=True, check=True, capture_output=True,
        )
        return True
    except Exception as e:
        detail = getattr(e, "stderr", "") or str(e)
        print(f"{C_YELLOW}⚠️  Container write failed for {path}: {detail.strip()}{C_RESET}")
        return False


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
      - `volume_id_*` model-weight volumes (`_remove_tt_studio_model_volumes`),
        `tt_studio_*_data` app volumes (`_remove_marketplace_app_volumes`),
        plus dangling anonymous volumes (`_prune_anonymous_volumes`).
    Build cache is intentionally excluded — cleanup-all does not prune it.
    Returns {"images", "model_volumes", "app_volumes", "anon_volumes"} byte
    counts; zeros if docker is unavailable, so the reclaim total degrades to the
    host-side paths just like before.
    """
    zero = {"images": 0, "model_volumes": 0, "app_volumes": 0, "anon_volumes": 0}
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
        if _is_model_volume(name):
            sizes["model_volumes"] += _parse_size_to_bytes(vol.get("Size", ""))
        elif _is_marketplace_app_volume(name):
            sizes["app_volumes"] += _parse_size_to_bytes(vol.get("Size", ""))
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
    return _remove_named_volumes(has_docker_access, _is_model_volume,
                                 _CLEANUP_VOLUME_PREFIX)


def _remove_marketplace_app_volumes(has_docker_access):
    """Remove the named volumes marketplace apps store their state in.

    Created implicitly by `docker run -v <name>:<path>` from the backend, so they
    are declared in neither docker-compose.yml nor the model-weight naming scheme
    and survive every other sweep. Leaving them behind outlasts the `.env`
    --purge-all deletes, so an app would boot with the old LITELLM_MASTER_KEY
    baked into its own config and fail to reach the gateway. Callers must remove
    the app containers first or `volume rm` will fail with "in use".
    Returns count removed.
    """
    return _remove_named_volumes(has_docker_access, _is_marketplace_app_volume,
                                 _CLEANUP_APP_VOLUME_PREFIX)


def _is_model_volume(name):
    """True for a model-weight volume (`volume_id_*`)."""
    return name.startswith(_CLEANUP_VOLUME_PREFIX)


def _is_marketplace_app_volume(name):
    """True for a marketplace app state volume (`tt_studio_*_data`)."""
    return (name.startswith(_CLEANUP_APP_VOLUME_PREFIX)
            and name.endswith(_CLEANUP_APP_VOLUME_SUFFIX)
            and len(name) > len(_CLEANUP_APP_VOLUME_PREFIX) + len(_CLEANUP_APP_VOLUME_SUFFIX))


def _remove_named_volumes(has_docker_access, matches, name_filter):
    """Force-remove every docker volume `matches` accepts. Returns count removed.

    `name_filter` only narrows what the daemon lists — it is a substring match,
    so `matches` is re-applied in Python and an unrelated volume that merely
    contains the filter mid-name is never deleted.
    """
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "volume", "ls", "--filter", f"name={name_filter}", "-q"],
            capture_output=True, text=True, check=False,
        )
        names = [n for n in (line.strip() for line in result.stdout.splitlines())
                 if matches(n)]
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


def _running_container_names(has_docker_access):
    """Names of ALL running containers, no image filter — used to verify
    deployment records against reality (a record's `status: "running"` may be
    stale if a purge or crash couldn't write the store back). Runs `docker ps`
    WITHOUT sudo so it never triggers a password prompt. Returns None if docker
    can't be queried, so callers fall back to trusting the records."""
    if not has_docker_access:
        return None
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode != 0:
            return None
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]
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


def _docker_volume_mountpoints(names, has_docker_access):
    """{volume name: host mountpoint} via `docker volume inspect`, so listings
    can show WHERE a named volume's data actually lives (usually under
    /var/lib/docker/volumes/<name>/_data). Best-effort: {} on any error."""
    names = [n for n in names if n]
    if not names:
        return {}
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "volume", "inspect", "--format",
                           "{{.Name}}\t{{.Mountpoint}}", *names],
            capture_output=True, text=True, check=False,
        )
        points = {}
        for line in result.stdout.splitlines():
            if "\t" in line:
                name, mountpoint = line.split("\t", 1)
                if name.strip() and mountpoint.strip():
                    points[name.strip()] = mountpoint.strip()
        return points
    except Exception:
        return {}


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
    names or ids; already-gone containers are harmless. Returns the count
    actually removed (docker echoes each removed container on stdout), so
    callers never report stopping containers that no longer existed."""
    ids = [i for i in ids if i]
    if not ids:
        return 0
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "rm", "-fv", *ids],
            capture_output=True, text=True, check=False,
        )
        return len([line for line in result.stdout.splitlines() if line.strip()])
    except Exception:
        return 0


def _containers_using_volume(name, has_docker_access):
    """Ids of ALL containers — running or stopped — that mount the named
    volume. Read-only. Returns [] on any error."""
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "ps", "-aq", "--filter", f"volume={name}"],
            capture_output=True, text=True, check=False,
        )
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]
    except Exception:
        return []


def _remove_docker_volumes(names, has_docker_access):
    """Force-remove specific named volumes. `docker volume rm` refuses while
    ANY container references the volume — stopped/exited ones included — so on
    "in use" the referencing containers are force-removed (anything mounting a
    purged model's weight volume is a deployment container for that model) and
    the rm is retried once. Returns (removed_names, in_use_names); in_use
    means the retry still failed."""
    names = [n for n in names if n]
    removed, in_use = [], []
    sudo_prefix = ["sudo"] if not has_docker_access else []

    def volume_rm(name):
        result = subprocess.run(
            sudo_prefix + ["docker", "volume", "rm", "-f", name],
            capture_output=True, text=True, check=False,
        )
        return result.returncode == 0, (result.stderr or "").lower()

    for name in names:
        try:
            ok, err = volume_rm(name)
            if not ok and "in use" in err:
                holders = _containers_using_volume(name, has_docker_access)
                if holders:
                    subprocess.run(
                        sudo_prefix + ["docker", "rm", "-fv", *holders],
                        capture_output=True, check=False,
                    )
                    ok, err = volume_rm(name)
            if ok:
                removed.append(name)
            elif "in use" in err:
                in_use.append(name)
        except Exception:
            continue
    return removed, in_use


def _image_present(repo_tag, has_docker_access):
    """Whether an image with this exact repo:tag exists locally. The catalog's
    docker_image is what a model WOULD run, not proof it was ever pulled — a
    purge inventory must only offer images that are actually on disk."""
    sudo_prefix = ["sudo"] if not has_docker_access else []
    try:
        result = subprocess.run(
            sudo_prefix + ["docker", "image", "ls", "--filter",
                           f"reference={repo_tag}", "-q"],
            capture_output=True, text=True, check=False,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


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
        result = subprocess.run(
            sudo_prefix + ["docker", "image", "rm", "-f", *ids],
            capture_output=True, check=False,
        )
        return result.returncode == 0
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
