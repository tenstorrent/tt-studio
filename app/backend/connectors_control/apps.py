# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from django.apps import AppConfig


class ConnectorsControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "connectors_control"
