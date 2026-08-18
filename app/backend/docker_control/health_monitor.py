# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import threading
import time
from django.utils import timezone
from shared_config.logger_config import get_logger
from docker_control.models import ModelDeployment
from docker_control.docker_control_client import (
    ContainerNotFound,
    get_docker_client,
    http_status_of,
    is_service_unreachable,
)

logger = get_logger(__name__)

# Global variable to track if monitoring is running
_monitoring_thread = None
_stop_monitoring = False

# Whether the last poll found docker-control-service unreachable. Used purely to
# log the outage once on each transition instead of once per container per poll
# (a 5s poll over an overnight outage produced ~16k identical ERROR lines).
_service_unreachable = False


def _cleanup_stale_starting_records():
    """Remove stale 'starting' records that permanently block chip slots.

    Two categories are handled:

    1. pending_* records (created before the FastAPI /run call is made, e.g.
       when a non-CHAT deployment fails early): cleaned up after 10 minutes.

    2. FastAPI job_id records (CHAT models): the deployment_sync background
       thread normally transitions these to 'running' or 'stopped' within
       seconds.  As a final safety net, any that survive 35 minutes are marked
       'failed' here.  35 minutes gives the sync thread ample time to retry
       and avoids racing with legitimate long-running weight downloads.
    """
    try:
        now = timezone.now()
        pending_cutoff = now - timezone.timedelta(minutes=10)
        jobid_cutoff = now - timezone.timedelta(minutes=35)

        starting_deployments = ModelDeployment.objects.filter(status="starting")
        for dep in starting_deployments:
            if dep.deployed_at is None:
                continue

            if dep.container_id.startswith("pending_"):
                # Legacy pending placeholder — clean up after 10 minutes
                if dep.deployed_at < pending_cutoff:
                    logger.info(
                        f"Cleaning up stale pending 'starting' record: {dep.model_name} "
                        f"(id={dep.id}, deployed_at={dep.deployed_at})"
                    )
                    dep.status = "failed"
                    dep.stopped_at = now
                    dep.save()
            else:
                # FastAPI job_id record that the sync thread did not resolve —
                # mark failed after 35 minutes and stop the container if it exists.
                if dep.deployed_at < jobid_cutoff:
                    logger.warning(
                        f"Cleaning up long-stale 'starting' record: {dep.model_name} "
                        f"(id={dep.id}, container_id={dep.container_id}, "
                        f"deployed_at={dep.deployed_at})"
                    )
                    try:
                        from docker_control.docker_utils import stop_container
                        stop_container(dep.container_id)
                    except Exception as stop_err:
                        logger.debug(
                            f"Could not stop container {dep.container_id} during timeout cleanup: {stop_err}"
                        )
                    dep.status = "failed"
                    dep.stopped_at = now
                    dep.save()
    except Exception as e:
        logger.error(f"Error cleaning up stale starting records: {e}")


def _service_is_back():
    """Probe docker-control-service — only called while an outage is already known.

    This adds no polling in the healthy case: reachability is learned for free
    from the container lookups the loop already performs, and this probe runs
    only once ``_service_unreachable`` is set. During an outage it replaces one
    failing lookup *per deployment* with a single cheap unauthenticated GET, so
    an outage costs less traffic than it did before, not more.

    Only a transport-level outage keeps us out. Any other failure returns True so
    monitoring resumes: the per-container logic already acts only on definitive
    signals, and reporting a real crash late is worse than tolerating an odd
    health response. Note ``/api/v1/health`` answers 200 even when it reports
    ``unhealthy``/``degraded`` in its body, and that body is deliberately ignored
    — the question is only whether the service answered at all.
    """
    try:
        get_docker_client().health()
    except Exception as e:
        if is_service_unreachable(e):
            return False
        logger.error(f"docker-control-service health check failed: {e}")
        return True
    _note_service_reachable()
    return True


def _note_service_unreachable(exc):
    """Log a docker-control-service outage once per transition into the outage."""
    global _service_unreachable
    if not _service_unreachable:
        _service_unreachable = True
        logger.warning(
            "docker-control-service is unreachable (%s). Container statuses cannot "
            "be determined and will be left untouched until it responds again; "
            "deployment records keep their last known status.",
            exc,
        )


def _note_service_reachable():
    """Log recovery once, the first time the service answers after an outage."""
    global _service_unreachable
    if _service_unreachable:
        _service_unreachable = False
        logger.info(
            "docker-control-service is reachable again; resuming container health checks"
        )


def check_container_health():
    """Check for containers that died unexpectedly and clean up stale records.

    A record is only ever demoted on a definitive signal from a
    docker-control-service that actually answered:

    * it reported a non-running Docker status (``exited``, ``dead``, …), or
    * it answered 404, meaning the container no longer exists (the normal case
      for the ``--rm`` containers TT Inference Server launches).

    Both are detected on the very next poll, so a genuine crash is still
    reported within ``_HEALTH_POLL_INTERVAL_SECONDS``. Anything else — most
    importantly the service being unreachable — carries no information about the
    container and must never change a record's status.
    """
    try:
        # Nothing to conclude about, so don't even probe — keeps an idle system
        # from issuing a health request every poll.
        if not ModelDeployment.objects.filter(status__in=["starting", "running"]).exists():
            return

        # Already known to be down — one cheap probe to see if it's back beats one
        # failing lookup per deployment. In the healthy case this is skipped
        # entirely, so the poll costs exactly what it did before.
        if _service_unreachable and not _service_is_back():
            return

        # Clean up stale pending records that block chip slots. Safe during an
        # outage: both branches decide purely on record age, never on a Docker
        # lookup, and the stop_container attempt is already best-effort.
        _cleanup_stale_starting_records()

        # Get all running deployments from database
        running_deployments = ModelDeployment.objects.filter(status="running")

        if not running_deployments.exists():
            return

        logger.debug(f"Checking health of {running_deployments.count()} running deployments")

        # Check actual Docker container status via docker-control-service
        docker_client = get_docker_client()

        for deployment in running_deployments:
            try:
                # Get container info from docker-control-service
                container_info = docker_client.get_container(deployment.container_id)
                _note_service_reachable()
                actual_status = container_info.get("status", "unknown")  # running, exited, dead, etc.

                # If container is not running but we didn't mark it as stopped by user
                if actual_status not in ["running", "restarting"] and not deployment.stopped_by_user:
                    # Container died unexpectedly!
                    logger.warning(f"Container {deployment.container_name} died unexpectedly. Status: {actual_status}")

                    deployment.status = actual_status  # exited, dead, etc.
                    deployment.stopped_at = timezone.now()
                    deployment.save()

                    # TODO: Emit event for frontend notification
                    logger.info(f"Updated deployment record for unexpected death: {deployment.container_name}")

            except Exception as e:
                # A 404 is the definitive "container is gone" answer, and is the
                # normal outcome for the --rm containers TT Inference Server
                # launches. Accept it either pre-translated by the client or as a
                # raw 404 response, so detecting a real death never hinges on one
                # translation point.
                if isinstance(e, ContainerNotFound) or http_status_of(e) == 404:
                    _note_service_reachable()
                    if not deployment.stopped_by_user:
                        logger.warning(f"Container {deployment.container_name} not found - marking as dead")
                        deployment.status = "dead"
                        deployment.stopped_at = timezone.now()
                        deployment.save()

                        # TODO: Emit event for frontend notification
                        logger.info(f"Updated deployment record for missing container: {deployment.container_name}")

                # No definitive answer about this container — leave the record
                # alone. Demoting it here would report a false death for a model
                # that is still happily serving.
                elif is_service_unreachable(e):
                    _note_service_unreachable(e)
                else:
                    logger.error(f"Error checking container {deployment.container_id}: {e}")

    except Exception as e:
        logger.error(f"Error in check_container_health: {e}")


_HEALTH_POLL_INTERVAL_SECONDS = 5


def health_monitoring_loop():
    """Background thread that continuously monitors container health.

    Polls every _HEALTH_POLL_INTERVAL_SECONDS (5 s by default). Read-time
    reconciliation in get_canonical_deployments now catches dead containers on the next status fetch regardless of this loop, so this thread is the persistence layer (writing status="dead" / etc. to the store) rather than the sole detection path. 
    A 5s interval keeps the persistent store roughly current at negligible CPU cost.
    """
    global _stop_monitoring

    logger.info(
        "Starting container health monitoring service (interval=%ss)",
        _HEALTH_POLL_INTERVAL_SECONDS,
    )

    while not _stop_monitoring:
        try:
            check_container_health()
        except Exception as e:
            logger.error(f"Error in health monitoring loop: {e}")

        time.sleep(_HEALTH_POLL_INTERVAL_SECONDS)

    logger.info("Container health monitoring service stopped")


def start_health_monitoring():
    """Start the health monitoring background thread"""
    global _monitoring_thread, _stop_monitoring
    
    if _monitoring_thread is not None and _monitoring_thread.is_alive():
        logger.info("Health monitoring is already running")
        return
    
    _stop_monitoring = False
    _monitoring_thread = threading.Thread(target=health_monitoring_loop, daemon=True)
    _monitoring_thread.start()
    logger.info("Health monitoring thread started")


def stop_health_monitoring():
    """Stop the health monitoring background thread"""
    global _stop_monitoring, _monitoring_thread
    
    _stop_monitoring = True
    if _monitoring_thread:
        _monitoring_thread.join(timeout=5)
    logger.info("Health monitoring stopped")

