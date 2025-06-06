# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.urls import path
from . import views

urlpatterns = [
    # System resource endpoints
    path("status/", views.SystemStatusView.as_view(), name="system-status"),
    path("footer-data/", views.FooterDataView.as_view(), name="footer-data"),
    path("telemetry/", views.DeviceTelemetryView.as_view(), name="device-telemetry"),
    
    # Hardware snapshot endpoints
    path("snapshots/", views.HardwareSnapshotView.as_view(), name="hardware-snapshots"),
    
    # Alert endpoints
    path("alerts/", views.HardwareAlertsView.as_view(), name="hardware-alerts"),
    path("alerts/<int:alert_id>/resolve/", views.HardwareAlertsView.as_view(), name="resolve-alert"),
] 