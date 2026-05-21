# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.urls import path

from . import views

urlpatterns = [
    path("", views.WorkflowListCreateView.as_view(), name="workflow-list-create"),
    path(
        "templates/",
        views.WorkflowTemplateListView.as_view(),
        name="workflow-templates",
    ),
    path(
        "runs/<uuid:run_id>/",
        views.WorkflowRunDetailView.as_view(),
        name="workflow-run-detail",
    ),
    path(
        "<uuid:pk>/",
        views.WorkflowDetailView.as_view(),
        name="workflow-detail",
    ),
    path(
        "<uuid:pk>/run/",
        views.WorkflowRunView.as_view(),
        name="workflow-run",
    ),
]
