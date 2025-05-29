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
    RedeployView,
    ResetBoardView,
    ImageStatusView,
    PullImageView,
    ModelCatalogView,
)

urlpatterns = [
    path("get_containers/", views.ContainersView.as_view()),
    path("deploy/", views.DeployView.as_view()),
    path("stop/", views.StopView.as_view()),
    path("status/", views.StatusView.as_view()),
    path("redeploy/", views.RedeployView.as_view()),
    path("reset_board/", views.ResetBoardView.as_view()),
    path("docker/image_status/<str:model_id>/", views.ImageStatusView.as_view(), name="docker-image-status"),
    path("docker/pull_image/", views.PullImageView.as_view(), name="docker-pull-image"),
    path("docker/cancel_pull/", views.ModelCatalogView.as_view(), name="docker-cancel-pull"),
    path("catalog/", views.ModelCatalogView.as_view(), name="model_catalog"),
]
