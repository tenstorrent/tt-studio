# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("inference/", views.InferenceView.as_view()),
    path("deployed/", views.DeployedModelsView.as_view()),
    path("model_weights/", views.ModelWeightsView.as_view()),
]
