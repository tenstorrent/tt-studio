# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.apps import AppConfig
from shared_config.logger_config import get_logger

logger = get_logger(__name__)


class WorkflowControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "workflow_control"

    def ready(self):
        logger.info("Workflow control app is ready")
        from django.db.models.signals import post_migrate
        post_migrate.connect(_seed_after_migrate, sender=self)


def _seed_after_migrate(sender, **kwargs):
    """Seed preset workflow templates after migrations have been applied."""
    try:
        from .templates import seed_templates
        seed_templates()
    except Exception as exc:
        logger.warning(f"Could not seed workflow templates: {exc}")
