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
