# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

"""
URL configuration for api project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from api.views import UpStatusView
from django.urls import include, path
from model_control.views import OpenAIAudioSpeechView

urlpatterns = [
    path("up/", UpStatusView.as_view()),
    path("docker/", include("docker_control.urls")),
    path("models/", include("model_control.urls")),
    path("reset_board/", include("docker_control.urls")),
    path("collections/", include("vector_db_control.urls")),
    path("logs/", include("logs_control.urls")),
    path("board/", include("board_control.urls")),
    # OpenAI-compatible audio endpoint
    path("v1/audio/speech", OpenAIAudioSpeechView.as_view()),
]
