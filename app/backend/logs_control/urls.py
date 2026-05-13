# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.urls import path
from .views import (
    ListLogsView,
    GetLogView,
    FastAPILogsView,
    TtInferenceLogsView,
    BugReportDataView,
    BugReportDownloadView,
    GitHubIssueView,
)

urlpatterns = [
    # Specific endpoints must come BEFORE the catch-all file endpoint
    path("fastapi/", FastAPILogsView.as_view(), name="fastapi_logs"),
    path("tt-inference/", TtInferenceLogsView.as_view(), name="tt_inference_logs"),
    path("bug-report/", BugReportDataView.as_view(), name="bug_report_data"),
    path("bug-report/download/", BugReportDownloadView.as_view(), name="bug_report_download"),
    path("github-issue/", GitHubIssueView.as_view(), name="github_issue"),
    path("", ListLogsView.as_view(), name="list_logs"),
    path("<path:filename>/", GetLogView.as_view(), name="get_log"),  # catch-all
]
