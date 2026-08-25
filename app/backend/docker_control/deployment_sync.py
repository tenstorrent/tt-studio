# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

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
from typing import Optional, Tuple

import requests as _requests

from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_FASTAPI_BASE_URL = backend_config.tt_inference_api_url
_POLL_INTERVAL_SECONDS = 5
_NO_PROGRESS_TIMEOUT_SECONDS = 5 * 60 * 60  # mirrors DEPLOYMENT_TIMEOUT_SECONDS


def _classify_failure(message: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Classify a FastAPI failure message into (reason_code, raw_message)."""
    if not message:
        return None, None
    m = message.lower()
    if m.startswith("hf_token authentication failed"):
        return "hf_auth", message
    if (
        any(p in m for p in ("gated repo", "access not granted", "gatedrepoerror", "unauthorized"))
        and any(p in m for p in ("huggingface", "hugging face", "hf_token", "token"))
    ):
        return "hf_auth", message
    return "unknown", message

# Registry of active sync threads keyed by job_id.
# Prevents spawning duplicate threads for the same job.
_active_syncs: dict = {}
_active_syncs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal sync logic
# ---------------------------------------------------------------------------

def _warn_if_resurrecting_reaped(dep, job_id: str) -> None:
    """Log loudly when a completing job's record was already reconciled to 'stopped'.

    A job that completes successfully should have been 'starting' the whole way
    through. Finding it 'stopped' (and not stopped by the user) means the canonical
    reconciler reaped it while it was still running, freeing its chip slots — the
    failure mode _heartbeat_starting_record exists to prevent. Silently flipping it
    back to 'running' is what let this hide in production, so make it audible.
    """
    if dep.status == "stopped" and not getattr(dep, "stopped_by_user", False):
        logger.warning(
            f"[deployment_sync] Resurrecting reaped deployment {job_id} "
            f"({dep.model_name}): the record was reconciled to 'stopped' while its "
            f"job was still running, so its chip slots were free during the deploy. "
            f"This should not happen — the starting-record heartbeat has regressed."
        )


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
            # User stopped/deleted this deployment mid-startup: don't resurrect it.
            # Remove the container FastAPI just created and keep the record stopped.
            if getattr(dep, "stopped_by_user", False):
                if real_container_id:
                    try:
                        from docker_control.docker_utils import stop_container
                        stop_container(real_container_id)
                    except Exception as e:
                        logger.warning(
                            f"[deployment_sync] Cleanup of user-stopped job {job_id} failed: {e}"
                        )
                dep.status = "stopped"
                dep.save()
                logger.info(
                    f"[deployment_sync] Job {job_id} completed but was user-stopped; cleaned up"
                )
                return
            if real_container_id:
                _warn_if_resurrecting_reaped(dep, job_id)
                dep.container_id = real_container_id
                if real_container_name:
                    dep.container_name = real_container_name
                dep.status = "running"
                dep.stopped_at = None
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
            from django.utils import timezone as dj_timezone

            reason, raw_msg = _classify_failure(progress_data.get("message"))
            dep.status = "stopped"
            if dep.stopped_at is None:
                dep.stopped_at = dj_timezone.now()
            if dep.failure_reason is None:
                dep.failure_reason = reason
                dep.failure_message = raw_msg
            dep.save()
            logger.info(
                f"[deployment_sync] Marked ModelDeployment for {dep.model_name} as stopped "
                f"(FastAPI job status: {job_status}, failure_reason={dep.failure_reason})"
            )

    except Exception as e:
        logger.warning(f"[deployment_sync] _do_sync failed for job {job_id}: {e}")


def _heartbeat_starting_record(job_id: str) -> None:
    """Refresh a live job's placeholder record so the canonical reconciler leaves it alone.

    get_canonical_deployments() reaps a 'starting' record once it is older than
    _CANONICAL_STARTING_GRACE_SECONDS with no matching Docker container. For a chat
    deploy that condition holds for the whole host-side weights download — the record's
    container_id is a FastAPI job id, and run.py only creates the container after
    `hf download` finishes. Without this heartbeat the record is reaped ~60s in, the
    chip slots are freed while the deploy is still running, and a second deploy can be
    admitted onto a busy board.

    Only 'starting' records are touched: once deployment_sync swaps in the real
    container_id and flips to 'running', Docker itself is the liveness signal.
    """
    from docker_control.models import ModelDeployment

    try:
        # Atomic conditional update: a plain read-mutate-save would rewrite the whole
        # record from a detached copy and could undo a cancel that landed in between.
        ModelDeployment.objects.touch_starting(job_id)
    except Exception as e:
        logger.debug(f"[deployment_sync] heartbeat failed for job {job_id}: {e}")


def _poll_and_sync(job_id: str) -> None:
    """Background thread body: poll FastAPI until the job reaches a terminal state."""
    last_progress_at = time.time()
    last_reported_update = 0.0
    logger.info(f"[deployment_sync] Started sync thread for job {job_id}")

    try:
        while time.time() - last_progress_at < _NO_PROGRESS_TIMEOUT_SECONDS:
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

                    # Non-terminal: the job is alive, so keep its placeholder record
                    # fresh. 'stalled' counts as alive — run.py emits nothing while a
                    # single multi-GB weight shard downloads, which is precisely the
                    # window the reconciler used to reap.
                    _heartbeat_starting_record(job_id)

                    # Only genuine forward progress resets the give-up clock.
                    reported = progress.get("last_updated")
                    if isinstance(reported, (int, float)) and reported > last_reported_update:
                        last_reported_update = reported
                        last_progress_at = time.time()

                    logger.debug(
                        f"[deployment_sync] Job {job_id} status={status}; will poll again in "
                        f"{_POLL_INTERVAL_SECONDS}s"
                    )

            except _requests.exceptions.RequestException as e:
                logger.debug(
                    f"[deployment_sync] FastAPI unreachable while polling job {job_id}: {e}"
                )

            time.sleep(_POLL_INTERVAL_SECONDS)

        # No forward progress for the whole timeout window — treat as wedged.
        logger.warning(
            f"[deployment_sync] Job {job_id} made no progress for "
            f"{_NO_PROGRESS_TIMEOUT_SECONDS // 60} minutes; marking stopped"
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
