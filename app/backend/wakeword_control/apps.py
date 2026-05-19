# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.apps import AppConfig


class WakeWordConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wakeword_control"
