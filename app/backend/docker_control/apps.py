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
        
        # Verify database migrations are applied
        try:
            from django.db import connection
            
            # Check if ModelDeployment table exists
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name='docker_control_modeldeployment'
                """)
                table_exists = cursor.fetchone() is not None
            
            if not table_exists:
                logger.warning(
                    "ModelDeployment table not found. Database migrations may not be applied. "
                    "Run: python manage.py migrate docker_control"
                )
            else:
                # Count existing deployment records
                from docker_control.models import ModelDeployment
                count = ModelDeployment.objects.count()
                logger.info(f"Deployment history table verified. Existing records: {count}")
        except Exception as e:
            logger.warning(f"Could not verify deployment history table: {e}")
        
        # Start container health monitoring service
        try:
            from docker_control.health_monitor import start_health_monitoring
            start_health_monitoring()
            logger.info("Container health monitoring service started")
        except Exception as e:
            logger.error(f"Failed to start health monitoring service: {e}")