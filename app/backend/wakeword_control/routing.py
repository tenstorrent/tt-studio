# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.urls import path

from .consumers import WakeWordConsumer

websocket_urlpatterns = [
    path("ws/wakeword/", WakeWordConsumer.as_asgi()),
]
