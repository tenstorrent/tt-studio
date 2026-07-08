# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for DeploymentHistoryView status reconciliation.

The history endpoint must report the same truth as the Models Deployed page:
"running" only when a live container backs the record, "unknown" when Docker
liveness can't be verified. Run inside the backend container/image:

    pytest docker_control/test_deployment_history_view.py -v
"""

import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")

import django
import docker_control.health_monitor as health_monitor

# Keep the background health monitor from racing the tests' store writes.
health_monitor.start_health_monitoring = lambda: None

django.setup()

from django.test import RequestFactory  # noqa: E402

from docker_control import deployment_store  # noqa: E402
from docker_control.models import ModelDeployment  # noqa: E402
from docker_control.views import DeploymentHistoryView  # noqa: E402

_GET_CONTAINER_STATUS = "docker_control.docker_utils.get_container_status"


def _use_store(tmp_path):
    deployment_store._STORE_PATH = tmp_path / "deployments.json"


def _get_history():
    request = RequestFactory().get("/docker/deployment-history/")
    return DeploymentHistoryView.as_view()(request)


def _create(status="running", **kwargs):
    defaults = dict(
        container_id="cid-1234567890ab",
        container_name="test-history-model",
        model_name="test-history-model",
        device="p150",
        status=status,
        port=7000,
        # Set so the view's lazy workflow-log backfill doesn't scan the host.
        workflow_log_path="/dev/null",
    )
    defaults.update(kwargs)
    return ModelDeployment.objects.create(**defaults)


def test_running_with_no_live_container_reconciles_to_stopped(tmp_path):
    _use_store(tmp_path)
    _create(status="running")
    with patch(_GET_CONTAINER_STATUS, return_value={}):
        response = _get_history()
    assert response.status_code == 200
    assert response.data["docker_state"] == "ok"
    assert response.data["deployments"][0]["status"] == "stopped"
    assert response.data["deployments"][0]["stopped_at"] is not None
    # Reconcile persisted the correction to the store.
    assert ModelDeployment.objects.all()[0].status == "stopped"


def test_running_with_live_container_stays_running(tmp_path):
    _use_store(tmp_path)
    dep = _create(status="running")
    live = {
        dep.container_id: {
            "name": dep.container_name,
            "status": "running",
            "image_id": "sha256:abc",
            "image_name": "test-image:latest",
            "port_bindings": {},
            "networks": {},
            "env_vars": {},
        }
    }
    with patch(_GET_CONTAINER_STATUS, return_value=live):
        response = _get_history()
    assert response.data["docker_state"] == "ok"
    assert response.data["deployments"][0]["status"] == "running"
    assert ModelDeployment.objects.all()[0].status == "running"


def test_docker_unreachable_reports_unknown_without_persisting(tmp_path):
    _use_store(tmp_path)
    _create(status="running")
    with patch(
        _GET_CONTAINER_STATUS,
        side_effect=RuntimeError("docker-control-service unreachable"),
    ):
        response = _get_history()
    assert response.status_code == 200
    assert response.data["docker_state"] == "unavailable"
    assert response.data["deployments"][0]["status"] == "unknown"
    # The store keeps the last verified status — "unknown" is response-only.
    assert ModelDeployment.objects.all()[0].status == "running"


def test_docker_unreachable_keeps_terminal_statuses(tmp_path):
    _use_store(tmp_path)
    _create(status="stopped", container_id="cid-a", stopped_by_user=True)
    _create(status="exited", container_id="cid-b")
    with patch(_GET_CONTAINER_STATUS, side_effect=RuntimeError("down")):
        response = _get_history()
    assert response.data["docker_state"] == "unavailable"
    statuses = {
        d["container_id"]: d["status"] for d in response.data["deployments"]
    }
    assert statuses == {"cid-a": "stopped", "cid-b": "exited"}


def test_docker_unreachable_keeps_starting_within_grace(tmp_path):
    _use_store(tmp_path)
    _create(status="starting")  # deployed_at = now, inside the 60s grace
    with patch(_GET_CONTAINER_STATUS, side_effect=RuntimeError("down")):
        response = _get_history()
    assert response.data["deployments"][0]["status"] == "starting"


def test_docker_unreachable_marks_stale_starting_unknown(tmp_path):
    _use_store(tmp_path)
    dep = _create(status="starting")
    dep.deployed_at = datetime.now(timezone.utc) - timedelta(hours=2)
    dep.save()
    with patch(_GET_CONTAINER_STATUS, side_effect=RuntimeError("down")):
        response = _get_history()
    assert response.data["deployments"][0]["status"] == "unknown"
