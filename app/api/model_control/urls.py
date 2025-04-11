# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("inference/", views.InferenceView.as_view()),
    path("agent/", views.AgentView.as_view()),
    path("deployed/", views.DeployedModelsView.as_view()),
    path("model_weights/", views.ModelWeightsView.as_view()),
    path("image-generation/", views.ImageGenerationInferenceView.as_view()),
    path("object-detection/", views.ObjectDetectionInferenceView.as_view()),
    path("object-detection-cloud/", views.ObjectDetectionInferenceCloudView.as_view()),
    path("health/", views.ModelHealthView.as_view()),
    path("inference_cloud/", views.InferenceCloudView.as_view()),
]
