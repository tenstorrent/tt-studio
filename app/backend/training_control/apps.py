# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.apps import AppConfig

from shared_config.logger_config import get_logger

logger = get_logger(__name__)


class TrainingControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "training_control"

    def ready(self):
        logger.info("Initializing training control API")
