# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Background sync thread for CHAT model deployment lifecycle management.

CHAT models are deployed asynchronously via the TT Inference Server (FastAPI).
Django immediately creates a ModelDeployment record with status='starting' and
container_id=<fastapi_job_id> as a placeholder.  The real Docker container ID
and the 'running' status are only known once FastAPI reports the job as
'completed'.

Previously this transition was driven entirely by frontend polling of
DeploymentProgressView.  The Voice Agent pipeline never polls, so its CHAT
records would stay 'starting' forever and block the device slot.

This module gives Django full ownership of the transition:
  - start_deployment_sync(job_id): spawn a per-job daemon thread that polls
    FastAPI every 5 s and calls _do_sync() on status change.
  - recover_orphaned_starting_records(): called at Django startup to handle
    any 'starting' records left behind by a previous crash or restart.
"""

import threading
import time

import requests as _requests

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_FASTAPI_BASE_URL = "http://172.18.0.1:8001"
_POLL_INTERVAL_SECONDS = 5
_SYNC_TIMEOUT_SECONDS = 30 * 60  # 30 minutes

# Registry of active sync threads keyed by job_id.
# Prevents spawning duplicate threads for the same job.
_active_syncs: dict = {}
_active_syncs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal sync logic
# ---------------------------------------------------------------------------

def _do_sync(job_id: str, progress_data: dict) -> None:
    """Apply a FastAPI progress update to the corresponding ModelDeployment record.

    On 'completed': swap the job_id placeholder container_id for the real Docker
    container_id, mark status 'running', refresh the deploy cache.
    On terminal failure: mark the record 'stopped' so the slot is freed.
    """
    job_status = progress_data.get("status")
    try:
        from docker_control.models import ModelDeployment
        from model_control.model_utils import update_deploy_cache

        dep = ModelDeployment.objects.filter(container_id=job_id).first()
        if dep is None:
            return

        if job_status == "completed":
            real_container_id = progress_data.get("container_id")
            real_container_name = progress_data.get("container_name")
            if real_container_id:
                dep.container_id = real_container_id
                if real_container_name:
                    dep.container_name = real_container_name
                dep.status = "running"
                dep.save()
                logger.info(
                    f"[deployment_sync] Updated ModelDeployment for {dep.model_name}: "
                    f"container_id={real_container_id}, status=running"
                )
                try:
                    update_deploy_cache()
                except Exception as e:
                    logger.warning(f"[deployment_sync] Could not refresh deploy cache: {e}")
            else:
                logger.warning(
                    f"[deployment_sync] Job {job_id} completed but no container_id in response; "
                    f"leaving record as-is"
                )

        elif job_status in ("error", "failed", "cancelled", "timeout", "not_found"):
            dep.status = "stopped"
            dep.save()
            logger.info(
                f"[deployment_sync] Marked ModelDeployment for {dep.model_name} as stopped "
                f"(FastAPI job status: {job_status})"
            )

    except Exception as e:
        logger.warning(f"[deployment_sync] _do_sync failed for job {job_id}: {e}")


def _poll_and_sync(job_id: str) -> None:
    """Background thread body: poll FastAPI until the job reaches a terminal state."""
    deadline = time.time() + _SYNC_TIMEOUT_SECONDS
    logger.info(f"[deployment_sync] Started sync thread for job {job_id}")

    try:
        while time.time() < deadline:
            try:
                resp = _requests.get(
                    f"{_FASTAPI_BASE_URL}/run/progress/{job_id}",
                    timeout=5,
                )
                if resp.status_code == 200:
                    progress = resp.json()
                    status = progress.get("status", "")

                    if status == "completed":
                        _do_sync(job_id, progress)
                        logger.info(f"[deployment_sync] Job {job_id} completed — sync done")
                        return

                    if status in ("error", "failed", "cancelled", "timeout", "not_found"):
                        _do_sync(job_id, progress)
                        logger.info(
                            f"[deployment_sync] Job {job_id} terminal ({status}) — freeing slot"
                        )
                        return

                    # Still running / starting / retrying — keep polling
                    logger.debug(
                        f"[deployment_sync] Job {job_id} status={status}; will poll again in "
                        f"{_POLL_INTERVAL_SECONDS}s"
                    )

            except _requests.exceptions.RequestException as e:
                logger.debug(
                    f"[deployment_sync] FastAPI unreachable while polling job {job_id}: {e}"
                )

            time.sleep(_POLL_INTERVAL_SECONDS)

        # Timeout reached
        logger.warning(
            f"[deployment_sync] Job {job_id} sync timed out after "
            f"{_SYNC_TIMEOUT_SECONDS // 60} minutes; marking stopped"
        )
        _do_sync(job_id, {"status": "timeout"})

    finally:
        with _active_syncs_lock:
            _active_syncs.pop(job_id, None)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def start_deployment_sync(job_id: str) -> None:
    """Spawn a daemon thread to sync the ModelDeployment record for *job_id*.

    Safe to call multiple times for the same job_id — duplicate threads are
    suppressed via the _active_syncs registry.
    """
    with _active_syncs_lock:
        if job_id in _active_syncs and _active_syncs[job_id].is_alive():
            logger.debug(
                f"[deployment_sync] Sync thread already running for job {job_id}; skipping"
            )
            return
        t = threading.Thread(
            target=_poll_and_sync,
            args=(job_id,),
            daemon=True,
            name=f"deployment-sync-{job_id[:8]}",
        )
        _active_syncs[job_id] = t
        t.start()
        logger.info(f"[deployment_sync] Spawned sync thread for job {job_id}")


def recover_orphaned_starting_records() -> None:
    """Scan all 'starting' ModelDeployment records at startup and recover them.

    Records whose container_id looks like a FastAPI job_id (i.e. does NOT start
    with 'pending_') were created by DeployView for CHAT models and need a sync
    thread.  Records that are clearly terminal (FastAPI confirms failure) are
    marked stopped immediately.

    This is called from DockerControlConfig.ready() so any records left behind
    by a previous crash are handled before new deployments arrive.
    """
    try:
        from docker_control.models import ModelDeployment
    except Exception as e:
        logger.warning(f"[deployment_sync] Could not import ModelDeployment at startup: {e}")
        return

    try:
        starting = list(ModelDeployment.objects.filter(status="starting"))
    except Exception as e:
        logger.warning(f"[deployment_sync] Could not query starting records at startup: {e}")
        return

    # Filter to job_id-style records (not pending_ placeholders — those are
    # handled by health_monitor's _cleanup_stale_starting_records)
    job_id_records = [
        dep for dep in starting
        if dep.container_id and not dep.container_id.startswith("pending_")
    ]

    if not job_id_records:
        logger.info("[deployment_sync] No orphaned CHAT starting records found at startup")
        return

    logger.info(
        f"[deployment_sync] Found {len(job_id_records)} orphaned 'starting' record(s) at startup; "
        f"recovering…"
    )

    for dep in job_id_records:
        job_id = dep.container_id
        # Quick check: is the job still active or terminal?
        try:
            resp = _requests.get(
                f"{_FASTAPI_BASE_URL}/run/progress/{job_id}",
                timeout=3,
            )
            if resp.status_code == 200:
                progress = resp.json()
                status = progress.get("status", "")
                if status == "completed":
                    _do_sync(job_id, progress)
                    logger.info(
                        f"[deployment_sync] Recovered {dep.model_name} ({job_id[:8]}) "
                        f"— already completed"
                    )
                    continue
                if status in ("error", "failed", "cancelled", "timeout", "not_found"):
                    _do_sync(job_id, progress)
                    logger.info(
                        f"[deployment_sync] Recovered {dep.model_name} ({job_id[:8]}) "
                        f"— terminal ({status})"
                    )
                    continue
                # Job still running — spawn sync thread
                start_deployment_sync(job_id)
                continue
        except _requests.exceptions.RequestException:
            pass

        # FastAPI unreachable — spawn sync thread optimistically; it will
        # retry and time out gracefully if FastAPI never comes back
        start_deployment_sync(job_id)
