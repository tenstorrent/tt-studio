# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.apps import AppConfig


class BoardControlConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'board_control' 