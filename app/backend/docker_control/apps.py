# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.apps import AppConfig
from shared_config.logger_config import get_logger

logger = get_logger(__name__)

class DockerControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "docker_control"

    def ready(self):
        """Initialize docker control services"""
        logger.info("Docker control app is ready")

        # Log how many deployments are already tracked
        try:
            from docker_control.models import ModelDeployment
            count = ModelDeployment.objects.count()
            logger.info(f"Deployment store loaded. Existing records: {count}")
        except Exception as e:
            logger.warning(f"Could not read deployment store: {e}")

        # Start container health monitoring service
        try:
            from docker_control.health_monitor import start_health_monitoring
            start_health_monitoring()
            logger.info("Container health monitoring service started")
        except Exception as e:
            logger.error(f"Failed to start health monitoring service: {e}")

        # Recover any 'starting' CHAT deployment records left behind by a
        # previous crash or restart.  Must run after health monitoring is up
        # so the deployment store is fully initialized.
        try:
            from docker_control.deployment_sync import recover_orphaned_starting_records
            recover_orphaned_starting_records()
        except Exception as e:
            logger.warning(f"Could not run startup deployment recovery: {e}")