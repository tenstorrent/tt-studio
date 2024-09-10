# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.apps import AppConfig


class DockerControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "docker_control"
