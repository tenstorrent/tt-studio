# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Live download-progress helper for the in-container HuggingFace snapshot_download
call at .artifacts/tt-inference-server/vllm-tt-metal/src/run_vllm_api_server.py:312-314.

Reads bytes via the docker-control-service `dir-size` endpoint (which runs
`du -sb` inside the running container), fetches total size from the HF model
tree API (cached per repo), and maintains per-deploy EMA speed + ETA in
module-level state. Pure mechanism — wiring lives in
`model_control.views._get_startup_phase`.

The backend container does NOT have /var/run/docker.sock mounted; all docker
operations route through docker-control-service via DockerControlClient.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Dict, Optional

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# Module-level per-deploy_id state for EMA / ETA smoothing. Sized by however
# many concurrent deploys are warming up at once — typically 1-2, so unbounded
# is fine. Entries are pruned by `prune_state(active_deploy_ids)` from the caller.
_state: Dict[str, Dict[str, float]] = {}
_state_lock = threading.Lock()

# total_bytes per repo is constant for a given main revision; cache it.
_total_bytes_cache: Dict[str, Optional[int]] = {}
_total_bytes_lock = threading.Lock()

# Tunables — keep in sync with inference-api/api.py:_weights_progress_monitor.
_MIN_SPEED_BPS = 64 * 1024          # ignore jitter under 64 KB/s when updating EMA
_EMA_ALPHA_INITIAL = 0.35           # faster convergence on first sample
_EMA_ALPHA_LATER = 0.15
_ETA_SMOOTH_ALPHA = 0.3             # how much new raw ETA influences smoothed ETA
_EXEC_TIMEOUT_SECONDS = 4           # bound how long du can run before we give up

# Media (tt-media-inference-server) logs only the repo, not a target path.
# Weights land in the HF hub cache under HF_HOME, which is set to
# ${CACHE_ROOT}/huggingface by app/backend/shared_config/model_config.py:76-78.
_MEDIA_HF_CACHE_PREFIX = "/home/container_app_user/cache_root/huggingface/hub/models--"


def _media_container_path(repo: Optional[str]) -> Optional[str]:
    """Derive the in-container HF hub cache path for a media download.

    Mirrors huggingface_hub's repo→path convention (slashes become "--").
    Returns None for invalid repo strings.
    """
    if not repo or "/" not in repo:
        return None
    return _MEDIA_HF_CACHE_PREFIX + repo.replace("/", "--")


def _container_dir_size(deploy_id: str, container_path: str) -> Optional[int]:
    """Return recursive byte count of `container_path` inside the running deploy.

    Routes through docker-control-service so it works from inside the backend
    container (which has no docker socket). Returns 0 when the path exists
    but is empty / not-yet-created; None on transport failure.
    """
    if not deploy_id or not container_path:
        return None
    try:
        from docker_control.docker_control_client import get_docker_client
        client = get_docker_client()
    except Exception as exc:
        logger.debug("download_progress: get_docker_client failed: %s", exc)
        return None
    return client.dir_size(deploy_id, container_path, timeout=_EXEC_TIMEOUT_SECONDS)


def _fetch_total_bytes(repo: str) -> Optional[int]:
    """Sum file sizes from the HF model tree (best-effort; cached per repo)."""
    if not repo or "/" not in repo:
        return None
    with _total_bytes_lock:
        if repo in _total_bytes_cache:
            return _total_bytes_cache[repo]

    url = f"https://huggingface.co/api/models/{repo}/tree/main?recursive=true"
    headers = {"User-Agent": "tt-studio/download-progress"}
    token = os.getenv("HF_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            entries = json.loads(resp.read().decode("utf-8"))
        if not isinstance(entries, list):
            total: Optional[int] = None
        else:
            total = 0
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                if entry.get("type") != "file":
                    continue
                # Prefer `lfs.size` over top-level `size` for LFS-tracked files.
                # Currently both are the resolved blob size, but historic HF API
                # responses returned the pointer size at the top level.
                lfs = entry.get("lfs")
                size: Optional[int] = None
                if isinstance(lfs, dict):
                    lfs_size = lfs.get("size")
                    if isinstance(lfs_size, int) and lfs_size > 0:
                        size = lfs_size
                if size is None:
                    top_size = entry.get("size")
                    if isinstance(top_size, int) and top_size > 0:
                        size = top_size
                if size is not None:
                    total += size
            if total <= 0:
                total = None
    except urllib.error.HTTPError as e:
        logger.debug("download_progress: HF total-bytes HTTP %s for %s", e.code, repo)
        total = None
    except Exception as e:
        logger.debug("download_progress: HF total-bytes fetch for %s: %s", repo, e)
        total = None

    with _total_bytes_lock:
        _total_bytes_cache[repo] = total
    return total


def compute_download_progress(
    deploy_id: str,
    repo: Optional[str],
    container_path: Optional[str],
    cached: bool,
) -> Dict[str, Optional[float]]:
    """Return a snapshot of download progress for this deploy.

    Always returns a dict — the caller merges it into the StartupPhase response.
    Missing values are None so the frontend can fall back gracefully.

    When `cached=True`, the in-container script logged "Weights already exist at"
    and skipped snapshot_download. We still report downloaded_bytes (which should
    equal total_bytes) so the bar pins at 100% briefly before the phase advances.
    """
    out: Dict[str, Optional[float]] = {
        "downloaded_bytes": None,
        "total_bytes": None,
        "speed_bps": None,
        "eta_seconds": None,
        "weights_repo": repo,
        "weights_cached": cached,
    }

    # Media-server logs only the repo, not a target path. Derive the canonical
    # HF hub cache path so we can du -sb it via the existing endpoint.
    if not container_path and repo:
        container_path = _media_container_path(repo)

    if not container_path:
        return out

    downloaded = _container_dir_size(deploy_id, container_path)
    if downloaded is None:
        return out
    out["downloaded_bytes"] = int(downloaded)

    total = _fetch_total_bytes(repo) if repo else None
    if total is not None:
        out["total_bytes"] = int(total)

    # If the cache directory already holds (nearly) all the bytes the HF API
    # claims, the weights are effectively cached — even if no explicit
    # "cached" log line fired (the media runners' transformers.from_pretrained
    # path emits the same `Loading HuggingFace model:` line for both cases).
    # Threshold at 95% to tolerate harmless extras like .lock/.metadata files
    # not counted by the HF tree API.
    if not cached and total is not None and total > 0 and downloaded >= total * 0.95:
        cached = True
        out["weights_cached"] = True

    if cached:
        # Skip the speed/ETA dance — the file just appeared. Pin to 100%.
        if total is not None:
            out["downloaded_bytes"] = int(total)
        out["speed_bps"] = None
        out["eta_seconds"] = 0
        return out

    now = time.time()
    with _state_lock:
        st = _state.get(deploy_id)
        if st is None:
            st = {
                "last_bytes": float(downloaded),
                "last_t": now,
                "ema_speed_bps": 0.0,
                "stable_speed_bps": 0.0,
                "stagnant_polls": 0,
                "eta_smoothed": 0.0,
            }
            _state[deploy_id] = st

        dt = max(1e-3, now - st["last_t"])
        delta = downloaded - st["last_bytes"]

        if delta > _MIN_SPEED_BPS:
            inst_speed = delta / dt
            alpha = _EMA_ALPHA_INITIAL if st["ema_speed_bps"] <= 0 else _EMA_ALPHA_LATER
            ema = (
                inst_speed
                if st["ema_speed_bps"] <= 0
                else alpha * inst_speed + (1 - alpha) * st["ema_speed_bps"]
            )
            st["ema_speed_bps"] = ema
            st["stable_speed_bps"] = ema
            st["last_bytes"] = float(downloaded)
            st["last_t"] = now
            st["stagnant_polls"] = 0
        else:
            st["stagnant_polls"] += 1
            # Brief shard-verify pauses are normal — hold the previous speed.
            if st["stagnant_polls"] < 15:
                st["ema_speed_bps"] = st["stable_speed_bps"]
            else:
                # Decay slowly instead of cliff-dropping.
                st["ema_speed_bps"] *= 0.92

        if st["ema_speed_bps"] > 0:
            out["speed_bps"] = float(st["ema_speed_bps"])

        if total is not None and total > downloaded and st["ema_speed_bps"] > 0:
            raw_eta = (total - downloaded) / st["ema_speed_bps"]
            smoothed = (
                raw_eta
                if st["eta_smoothed"] <= 0
                else (1 - _ETA_SMOOTH_ALPHA) * st["eta_smoothed"] + _ETA_SMOOTH_ALPHA * raw_eta
            )
            st["eta_smoothed"] = smoothed
            out["eta_seconds"] = float(smoothed)
        elif total is not None and downloaded >= total:
            out["eta_seconds"] = 0

    return out


def prune_state(active_deploy_ids: set[str]) -> None:
    """Drop EMA state for deploys that are no longer in the active set.

    Caller is the health view, which knows the current `get_deploy_cache()`
    membership. Keeps `_state` bounded across restarts of individual deploys.
    """
    with _state_lock:
        for dep in list(_state.keys()):
            if dep not in active_deploy_ids:
                _state.pop(dep, None)
