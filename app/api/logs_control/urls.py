# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.urls import path
from .views import ListLogsView, GetLogView

urlpatterns = [
    path('', ListLogsView.as_view(), name='list_logs'), 
    path('<str:filename>/', GetLogView.as_view(), name='get_log'), 
]
