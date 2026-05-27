# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from django.urls import path

from . import views

urlpatterns = [
    path("available/", views.AvailableConnectorsView.as_view(), name="connectors-available"),
    path("connections/", views.ConnectionsView.as_view(), name="connectors-connections"),
    path("connect/<str:provider>/", views.ConnectView.as_view(), name="connectors-connect"),
    path("connections/<str:provider>/", views.DisconnectView.as_view(), name="connectors-disconnect"),
    path("oauth/callback/", views.OAuthCallbackView.as_view(), name="connectors-oauth-callback"),
]
