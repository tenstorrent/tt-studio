# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import threading
import time
from django.utils import timezone
from shared_config.logger_config import get_logger
from docker_control.models import ModelDeployment
from docker_control.docker_control_client import get_docker_client

logger = get_logger(__name__)

# Global variable to track if monitoring is running
_monitoring_thread = None
_stop_monitoring = False


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


def check_container_health():
    """Check for containers that died unexpectedly and clean up stale records"""
    try:
        # Clean up stale pending records that block chip slots
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
                # Check if it's a 404 (container not found)
                error_msg = str(e).lower()
                if "not found" in error_msg or "404" in error_msg:
                    # Container doesn't exist anymore - it died
                    if not deployment.stopped_by_user:
                        logger.warning(f"Container {deployment.container_name} not found - marking as dead")
                        deployment.status = "dead"
                        deployment.stopped_at = timezone.now()
                        deployment.save()

                        # TODO: Emit event for frontend notification
                        logger.info(f"Updated deployment record for missing container: {deployment.container_name}")
                else:
                    logger.error(f"Error checking container {deployment.container_id}: {e}")
                
    except Exception as e:
        logger.error(f"Error in check_container_health: {e}")


def health_monitoring_loop():
    """Background thread that continuously monitors container health"""
    global _stop_monitoring
    
    logger.info("Starting container health monitoring service")
    
    while not _stop_monitoring:
        try:
            check_container_health()
        except Exception as e:
            logger.error(f"Error in health monitoring loop: {e}")
        
        # Wait 60 seconds before next check
        time.sleep(60)
    
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

