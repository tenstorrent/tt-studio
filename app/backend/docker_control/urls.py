# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# docker_control/urls.py
from django.urls import path
from . import views
from .views import (
    StopView,
    StopStreamView,
    ContainersView,
    StatusView,
    ChipStatusView,
    DeployView,
    DeploymentProgressView,
    DeploymentLogsView,
    DeploymentProgressStreamView,
    RedeployView,
    ResetBoardView,
    ResetDeviceView,
    ImageStatusView,
    ModelCatalogView,
    BoardInfoView,
    DockerServiceLogsView,
    ContainerEventsView,
    DeploymentHistoryView,
    WorkflowLogStreamView,
    DiscoverContainersView,
    RegisterExternalModelView,
    AvailableDevicesView,
    DetectModelFromLogsView,
)

urlpatterns = [
    path("get_containers/", views.ContainersView.as_view()),
    path("deploy/", views.DeployView.as_view()),
    path("deploy/progress/<str:job_id>/", views.DeploymentProgressView.as_view(), name="deployment-progress"),
    path("deploy/logs/<str:job_id>/", views.DeploymentLogsView.as_view(), name="deployment-logs"),
    path("deploy/progress/stream/<str:job_id>/", views.DeploymentProgressStreamView.as_view(), name="deployment-progress-stream"),
    path("stop/", views.StopView.as_view()),
    path("stop/stream/<str:container_id>/", views.StopStreamView.as_view(), name="stop-stream"),
    path("status/", views.StatusView.as_view()),
    path("chip-status/", views.ChipStatusView.as_view(), name="chip-status"),
    path("redeploy/", views.RedeployView.as_view()),
    path("reset_board/", views.ResetBoardView.as_view()),
    path("reset_device/<int:device_id>/", views.ResetDeviceView.as_view(), name="reset-device"),
    path("docker/image_status/<str:model_id>/", views.ImageStatusView.as_view(), name="docker-image-status"),
    path("catalog/", views.ModelCatalogView.as_view(), name="model_catalog"),
    path("board-info/", views.BoardInfoView.as_view(), name="board-info"),
    path("service-logs/", views.DockerServiceLogsView.as_view(), name="docker-service-logs"),
    path("container-events/", views.ContainerEventsView.as_view(), name="container-events"),
    path("deployment-history/", views.DeploymentHistoryView.as_view(), name="deployment-history"),
    path("workflow-logs/<int:deployment_id>/", views.WorkflowLogStreamView.as_view(), name="workflow-logs"),
    path("discover-containers/", views.DiscoverContainersView.as_view(), name="discover-containers"),
    path("register-external/", views.RegisterExternalModelView.as_view(), name="register-external"),
    path("available-devices/", views.AvailableDevicesView.as_view(), name="available-devices"),
    path("detect-model/<str:container_id>/", views.DetectModelFromLogsView.as_view(), name="detect-model"),
]
