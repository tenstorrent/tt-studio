# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.apps import AppConfig

from shared_config.model_config import model_implmentations
from shared_config.logger_config import get_logger
from model_control.model_utils import start_cache_updater

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


class ModelControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "model_control"

    def ready(self):
        # run once
        logger.info("Initializing models API")
        for model_id, impl in model_implmentations.items():
            impl.setup()

        # start background cache updater thread 
        start_cache_updater()
