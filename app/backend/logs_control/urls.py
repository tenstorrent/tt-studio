# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.urls import path
from .views import ListLogsView, GetLogView, FastAPILogsView

urlpatterns = [
    path("", ListLogsView.as_view(), name="list_logs"),
    path(
        "<path:filename>/", GetLogView.as_view(), name="get_log"
    ),  # Use <path:filename> for multi-directory paths
    path("fastapi/", FastAPILogsView.as_view(), name="fastapi_logs"),
]
