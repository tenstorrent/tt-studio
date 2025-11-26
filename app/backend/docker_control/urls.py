# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# docker_control/urls.py
from django.urls import path
from . import views
from .views import (
    StopView,
    ContainersView,
    StatusView,
    DeployView,
    DeploymentProgressView,
    DeploymentLogsView,
    DeploymentProgressStreamView,
    RedeployView,
    ResetBoardView,
    ImageStatusView,
    PullImageView,
    ModelCatalogView,
    CancelPullView,
    BoardInfoView,
    DockerServiceLogsView,
    ContainerEventsView,
    DeploymentHistoryView,
    WorkflowLogStreamView,
)

urlpatterns = [
    path("get_containers/", views.ContainersView.as_view()),
    path("deploy/", views.DeployView.as_view()),
    path("deploy/progress/<str:job_id>/", views.DeploymentProgressView.as_view(), name="deployment-progress"),
    path("deploy/logs/<str:job_id>/", views.DeploymentLogsView.as_view(), name="deployment-logs"),
    path("deploy/progress/stream/<str:job_id>/", views.DeploymentProgressStreamView.as_view(), name="deployment-progress-stream"),
    path("stop/", views.StopView.as_view()),
    path("status/", views.StatusView.as_view()),
    path("redeploy/", views.RedeployView.as_view()),
    path("reset_board/", views.ResetBoardView.as_view()),
    path("docker/image_status/<str:model_id>/", views.ImageStatusView.as_view(), name="docker-image-status"),
    path("docker/pull_image/", views.PullImageView.as_view(), name="docker-pull-image"),
    path("docker/cancel_pull/", views.CancelPullView.as_view(), name="docker-cancel-pull"),
    path("catalog/", views.ModelCatalogView.as_view(), name="model_catalog"),
    path("board-info/", views.BoardInfoView.as_view(), name="board-info"),
    path("service-logs/", views.DockerServiceLogsView.as_view(), name="docker-service-logs"),
    path("container-events/", views.ContainerEventsView.as_view(), name="container-events"),
    path("deployment-history/", views.DeploymentHistoryView.as_view(), name="deployment-history"),
    path("workflow-logs/<int:deployment_id>/", views.WorkflowLogStreamView.as_view(), name="workflow-logs"),
]
