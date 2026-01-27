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


def check_container_health():
    """Check for containers that died unexpectedly"""
    try:
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

