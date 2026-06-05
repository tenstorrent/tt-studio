# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Pre-pull-then-deploy orchestration.

When a model is deployed and its Docker image is not yet cached, we pull the image
ourselves (host-side, via docker-control-service's streamed pull) so the UI can show
real byte-level progress, then trigger the actual deployment. Because every component
shares one host Docker daemon, the inference server's own `docker pull` during /run is
then a cache hit (instant).

This module owns the in-memory progress store keyed by a caller-supplied ``pull_id`` and
a background worker that:
  1. starts the streamed pull via docker-control-service,
  2. mirrors progress (adding speed/ETA computed from byte deltas) into the store,
  3. once the image is ready, runs the supplied ``deploy_fn`` to trigger the real
     deployment and records the resulting inference ``job_id``.

DeploymentProgressView reads this store: while pulling it reports a ``pulling_image``
stage; once ``real_job_id`` is set it hands off to the normal FastAPI progress proxy.

Design rule: this feature must NEVER block a deploy. Any pull failure still proceeds to
``deploy_fn`` (the inference server will pull as it does today) — the user merely loses
the progress bar for that deploy.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Dict, Optional, Tuple

from shared_config.logger_config import get_logger
from docker_control.docker_control_client import get_docker_client

logger = get_logger(__name__)

# pull_id -> snapshot dict (see _new_entry)
_image_pull_jobs: Dict[str, dict] = {}
_lock = threading.Lock()

_POLL_INTERVAL_SECONDS = 1.5
_PULL_TIMEOUT_SECONDS = 2 * 60 * 60  # 2h hard cap; large multi-GB images
_ENTRY_TTL_SECONDS = 3600            # evict finished entries after an hour
# A pull can run for many minutes — longer than the canonical "starting" grace
# window — so we periodically refresh the placeholder deployment record's
# timestamp (via heartbeat_fn) to keep it alive and its chip slot reserved.
_HEARTBEAT_INTERVAL_SECONDS = 30

# deploy_fn returns (real_job_id, error_message). Exactly one is non-None.
DeployFn = Callable[[], Tuple[Optional[str], Optional[str]]]


def _new_entry(image_ref: str) -> dict:
    now = time.time()
    return {
        "status": "pulling",          # pulling | success | error
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "speed_bps": None,
        "eta_seconds": None,
        "layers_done": 0,
        "layers_total": 0,
        "peak_progress": 0,           # running max of reported %, to keep progress monotonic
        "message": "Preparing to pull image…",
        "image_ref": image_ref,
        "real_job_id": None,
        "error": None,
        "started_at": now,
        "updated_at": now,
    }


def get_pull_job(pull_id: str) -> Optional[dict]:
    """Return a copy of the pull-job snapshot, or None if not tracked."""
    with _lock:
        entry = _image_pull_jobs.get(pull_id)
        return dict(entry) if entry is not None else None


def _update(pull_id: str, **changes) -> None:
    with _lock:
        entry = _image_pull_jobs.get(pull_id)
        if entry is None:
            return
        entry.update(changes)
        entry["updated_at"] = time.time()


def clamp_progress_pct(pull_id: str, pct: int) -> int:
    """Return a non-decreasing progress percent for this pull.

    The raw percent is downloaded/total, but Docker reveals layers incrementally so
    ``total`` (the denominator) grows mid-pull — a big layer's size enters the sum
    once it starts downloading, before its bytes arrive. ``downloaded`` only ever
    increases, so this denominator growth is the sole reason the raw ratio can dip.
    We clamp to the running peak so the reported percent never goes backwards
    (mirroring the single-deploy bar's client-side ``maxPctRef`` clamp). Scoped per
    pull_id, so each deploy starts fresh.
    """
    with _lock:
        entry = _image_pull_jobs.get(pull_id)
        if entry is None:
            return pct
        peak = max(int(entry.get("peak_progress") or 0), pct)
        entry["peak_progress"] = peak
        return peak


def _evict_stale_locked() -> None:
    now = time.time()
    stale = [
        pid for pid, e in _image_pull_jobs.items()
        if e["status"] != "pulling" and now - e["updated_at"] > _ENTRY_TTL_SECONDS
    ]
    for pid in stale:
        _image_pull_jobs.pop(pid, None)


def start_prepull_and_deploy(
    *,
    pull_id: str,
    image_name: str,
    image_tag: str,
    image_ref: str,
    deploy_fn: DeployFn,
    heartbeat_fn: Optional[Callable[[], None]] = None,
) -> None:
    """Register a pull job and spawn the background pull→deploy worker.

    heartbeat_fn (optional) is invoked periodically while the pull runs — used to
    keep the placeholder deployment record fresh so it isn't reconciled away.
    """
    with _lock:
        _evict_stale_locked()
        _image_pull_jobs[pull_id] = _new_entry(image_ref)

    thread = threading.Thread(
        target=_worker,
        kwargs=dict(
            pull_id=pull_id,
            image_name=image_name,
            image_tag=image_tag,
            deploy_fn=deploy_fn,
            heartbeat_fn=heartbeat_fn,
        ),
        daemon=True,
        name=f"prepull-{pull_id[:12]}",
    )
    thread.start()
    logger.info(f"[image_pull] started pre-pull worker for {image_ref} (pull_id={pull_id})")


def _worker(
    *,
    pull_id: str,
    image_name: str,
    image_tag: str,
    deploy_fn: DeployFn,
    heartbeat_fn: Optional[Callable[[], None]] = None,
) -> None:
    def beat():
        if heartbeat_fn is None:
            return
        try:
            heartbeat_fn()
        except Exception as e:
            logger.debug(f"[image_pull] heartbeat failed for {pull_id}: {e}")

    try:
        client = get_docker_client()

        # Kick off the streamed pull. If this fails, skip straight to deploy
        pull_started = False
        try:
            client.start_image_pull(image_name, image_tag, pull_id)
            pull_started = True
        except Exception as e:
            logger.warning(f"[image_pull] could not start streamed pull for {pull_id}: {e}")

        # Mirror progress until the pull reaches a terminal state.
        if pull_started:
            deadline = time.time() + _PULL_TIMEOUT_SECONDS
            last_t: Optional[float] = None
            last_bytes: Optional[int] = None
            last_heartbeat = 0.0
            while time.time() < deadline:
                # Keep the placeholder deployment record alive during pulls.
                if time.time() - last_heartbeat >= _HEARTBEAT_INTERVAL_SECONDS:
                    last_heartbeat = time.time()
                    beat()

                snap = client.get_image_pull_progress(pull_id)
                if snap is None:
                    time.sleep(_POLL_INTERVAL_SECONDS)
                    continue

                downloaded = int(snap.get("downloaded_bytes") or 0)
                total = int(snap.get("total_bytes") or 0)

                # Speed/ETA from byte deltas between successive polls.
                now = time.time()
                speed: Optional[float] = None
                eta: Optional[float] = None
                if last_t is not None and last_bytes is not None and now > last_t:
                    dt = now - last_t
                    db = downloaded - last_bytes
                    if dt > 0 and db > 0:
                        speed = db / dt
                        if total > downloaded and speed > 0:
                            eta = (total - downloaded) / speed
                last_t, last_bytes = now, downloaded

                _update(
                    pull_id,
                    downloaded_bytes=downloaded,
                    total_bytes=total,
                    layers_done=int(snap.get("layers_done") or 0),
                    layers_total=int(snap.get("layers_total") or 0),
                    message=snap.get("message") or "Pulling image…",
                    speed_bps=speed,
                    eta_seconds=eta,
                )

                if snap.get("status") in ("success", "error"):
                    if snap.get("status") == "error":
                        logger.warning(
                            f"[image_pull] streamed pull failed for {pull_id}: "
                            f"{snap.get('error')}; proceeding to deploy anyway"
                        )
                    break
                time.sleep(_POLL_INTERVAL_SECONDS)

        # Trigger the real deployment (image is now cached, or we fall back to letting the inference server pull
        _update(pull_id, message="Image ready — starting container…")
        real_job_id, err = deploy_fn()
        if err or not real_job_id:
            logger.error(f"[image_pull] deploy_fn failed for {pull_id}: {err}")
            _update(
                pull_id,
                status="error",
                error=err or "Deployment did not start",
                message=err or "Deployment failed to start",
            )
            return

        _update(pull_id, real_job_id=real_job_id, status="success")
        logger.info(f"[image_pull] {pull_id} handed off to inference job {real_job_id}")

    except Exception as e:
        logger.error(f"[image_pull] worker crashed for {pull_id}: {e}", exc_info=True)
        _update(pull_id, status="error", error=str(e), message=f"Deployment failed: {e}")
    finally:
        # Release this thread's DB connection.
        try:
            from django.db import connection
            connection.close()
        except Exception:
            pass
