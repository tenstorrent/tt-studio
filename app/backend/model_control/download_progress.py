# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Live download-progress helper for the in-container HuggingFace snapshot_download
call at .artifacts/tt-inference-server/vllm-tt-metal/src/run_vllm_api_server.py:312-314.

Reads bytes via `docker exec du -sb <weights_path>` against the running container,
fetches total size from the HF model tree API (cached per repo), and maintains
per-deploy EMA speed + ETA in module-level state. Pure mechanism — wiring lives
in `model_control.views._get_startup_phase`.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Dict, Optional

import docker
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

# `original/**` is excluded from `snapshot_download` for some repos (matches
# tt-inference-server's exclude list). Keep both included files and an exclude
# prefix list so the total matches what actually lands on disk.
_HF_EXCLUDE_PREFIXES = ("original/",)


def _docker_client() -> Optional[docker.DockerClient]:
    try:
        return docker.from_env()
    except Exception as exc:
        logger.debug("download_progress: docker.from_env() failed: %s", exc)
        return None


def _exec_du_bytes(deploy_id: str, container_path: str) -> Optional[int]:
    """Return recursive byte count of `container_path` inside the running deploy.

    Uses `du -sb` so it works on any layout (HF cache hub/blobs, flat local_dir,
    partial .incomplete files alongside finals — du sums them all).
    """
    if not deploy_id or not container_path:
        return None
    client = _docker_client()
    if client is None:
        return None
    try:
        container = client.containers.get(deploy_id)
    except docker.errors.NotFound:
        logger.debug("download_progress: container %s not found", deploy_id[:12])
        return None
    except Exception as exc:
        logger.debug("download_progress: get(%s) failed: %s", deploy_id[:12], exc)
        return None

    # `du -sb <path>`: byte total, with stderr discarded so a transient ENOENT
    # (path being created mid-download) returns "" instead of failing.
    cmd = ["sh", "-c", f"du -sb {_shell_quote(container_path)} 2>/dev/null | cut -f1"]
    try:
        result = container.exec_run(cmd, demux=False, stream=False, tty=False)
    except Exception as exc:
        logger.debug("download_progress: exec_run failed for %s: %s", deploy_id[:12], exc)
        return None

    output = result.output if hasattr(result, "output") else None
    if isinstance(output, bytes):
        text = output.decode("utf-8", errors="ignore").strip()
    elif isinstance(output, str):
        text = output.strip()
    else:
        return None
    if not text:
        return 0
    first = text.splitlines()[0].strip()
    return int(first) if first.isdigit() else 0


def _shell_quote(s: str) -> str:
    """Minimal single-quote escape for `sh -c` arguments."""
    return "'" + s.replace("'", "'\\''") + "'"


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
                path = entry.get("path") or ""
                if any(path.startswith(pfx) for pfx in _HF_EXCLUDE_PREFIXES):
                    continue
                size = entry.get("size")
                if isinstance(size, int) and size > 0:
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

    if not container_path:
        return out

    downloaded = _exec_du_bytes(deploy_id, container_path)
    if downloaded is None:
        return out
    out["downloaded_bytes"] = int(downloaded)

    total = _fetch_total_bytes(repo) if repo else None
    if total is not None:
        out["total_bytes"] = int(total)

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
