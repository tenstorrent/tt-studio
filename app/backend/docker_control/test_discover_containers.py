# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for telling model servers apart from other containers at discovery."""

from unittest.mock import patch, MagicMock
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory
import requests

from docker_control.chip_allocator import _detect_device_ids_from_mounts
from docker_control import views
from docker_control.views import DiscoverContainersView, _model_server_signal


def _signal(container):
    return _model_server_signal(container, _detect_device_ids_from_mounts(container))


class ModelServerSignalTests(SimpleTestCase):
    def test_bound_chips_mark_a_model_whatever_its_image(self):
        # Locally built bundles show only an image hash.
        container = {
            "HostConfig": {"Devices": [{"PathOnHost": "/dev/tenstorrent/0"}]},
            "Config": {"Image": "4ee43e47ad5d"},
        }
        self.assertEqual(_signal(container), "Tenstorrent devices bound")

    def test_a_whole_device_mount_counts(self):
        container = {"HostConfig": {"Devices": [{"PathOnHost": "/dev/tenstorrent"}]}}
        self.assertIsNotNone(_signal(container))

    def test_a_privileged_container_counts(self):
        self.assertEqual(
            _signal({"HostConfig": {"Privileged": True}}), "privileged container"
        )

    def test_tt_launch_arguments_count(self):
        container = {"Config": {"Cmd": ["vllm", "serve", "--tt-device", "p150"]}}
        self.assertEqual(_signal(container), "Tenstorrent launch settings")

    def test_a_mesh_env_counts(self):
        container = {"Config": {"Env": ["MESH_DEVICE=P300x2"]}}
        self.assertEqual(_signal(container), "Tenstorrent launch settings")

    def test_a_model_server_image_counts(self):
        container = {"Config": {"Image": "ghcr.io/tenstorrent/tt-media-inference-server:0.2.0"}}
        self.assertEqual(_signal(container), "model server image")

    def test_an_unrelated_container_has_no_signal(self):
        container = {
            "HostConfig": {"Devices": []},
            "Config": {"Image": "ghcr.io/open-webui/open-webui:main", "Env": ["PORT=8080"]},
        }
        self.assertIsNone(_signal(container))


class DiscoverContainersViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = DiscoverContainersView.as_view()
        views._discovery_outage_logged = False

    def tearDown(self):
        views._discovery_outage_logged = False

    @patch("docker_control.views.get_docker_client")
    def test_unreachable_service_returns_empty_list_200_ok(self, mock_get_client):
        """When docker-control-service cannot be reached, return 200 OK with an empty list."""
        mock_client = MagicMock()
        mock_client.list_containers.side_effect = requests.exceptions.ConnectionError("Connection refused")
        mock_get_client.return_value = mock_client

        request = self.factory.get("/docker/discover-containers/")
        response = self.view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    @patch("docker_control.views.get_docker_client")
    def test_unconfigured_service_returns_empty_list_200_ok(self, mock_get_client):
        """When docker-control-service client is unconfigured (missing URL), return 200 OK with an empty list."""
        mock_get_client.side_effect = ValueError("DOCKER_CONTROL_SERVICE_URL environment variable is required")

        request = self.factory.get("/docker/discover-containers/")
        response = self.view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    @patch("docker_control.views.logger")
    @patch("docker_control.views.get_docker_client")
    def test_outage_logging_dampened_across_consecutive_polls(self, mock_get_client, mock_logger):
        """Warning is logged once upon transition into outage; subsequent polls log debug and reset on recovery."""
        mock_client = MagicMock()
        mock_client.list_containers.side_effect = requests.exceptions.ConnectionError("Connection refused")
        mock_get_client.return_value = mock_client

        request = self.factory.get("/docker/discover-containers/")

        # 1st poll: Transition to outage -> logs warning
        resp1 = self.view(request)
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp1.data, [])
        mock_logger.warning.assert_called_once()
        self.assertFalse(mock_logger.error.called)
        self.assertTrue(views._discovery_outage_logged)

        # 2nd poll: Same outage continues -> logs debug, no new warning or error
        mock_logger.warning.reset_mock()
        resp2 = self.view(request)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data, [])
        self.assertFalse(mock_logger.warning.called)
        self.assertFalse(mock_logger.error.called)
        mock_logger.debug.assert_called_once()
        self.assertTrue(views._discovery_outage_logged)

        # 3rd poll: Service recovers -> list succeeds and resets outage flag
        mock_client.list_containers.side_effect = None
        mock_client.list_containers.return_value = {"containers": []}
        resp3 = self.view(request)
        self.assertEqual(resp3.status_code, 200)
        self.assertEqual(resp3.data, [])
        self.assertFalse(views._discovery_outage_logged)

    @patch("docker_control.views.logger")
    @patch("docker_control.views.get_docker_client")
    def test_unexpected_error_returns_500(self, mock_get_client, mock_logger):
        """Unexpected internal exceptions (non-transport) continue to log error and return 500."""
        mock_client = MagicMock()
        mock_client.list_containers.side_effect = RuntimeError("Fatal internal memory corruption")
        mock_get_client.return_value = mock_client

        request = self.factory.get("/docker/discover-containers/")
        response = self.view(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data.get("status"), "error")
        mock_logger.error.assert_called_once()

    @patch("docker_control.views.logger")
    @patch("docker_control.views.get_docker_client")
    def test_http_error_from_service_returns_500(self, mock_get_client, mock_logger):
        """HTTP errors from docker-control (e.g. 401 or 500) must return 500 and not be swallowed."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 401
        http_error = requests.exceptions.HTTPError("401 Client Error: Unauthorized", response=mock_response)
        mock_client.list_containers.side_effect = http_error
        mock_get_client.return_value = mock_client

        request = self.factory.get("/docker/discover-containers/")
        response = self.view(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data.get("status"), "error")
        mock_logger.error.assert_called_once()

    @patch("docker_control.models.ModelDeployment.objects.filter")
    @patch("docker_control.views.get_docker_client")
    def test_normal_discovery_flow_preserved(self, mock_get_client, mock_dep_filter):
        """Normal discovery returns valid model candidate containers."""
        mock_dep_filter.return_value = []
        mock_client = MagicMock()
        mock_client.list_containers.return_value = {
            "containers": [
                {
                    "id": "container_abc_123",
                    "name": "tt_model_server",
                    "Config": {
                        "Image": "ghcr.io/tenstorrent/tt-media-inference-server:0.2.0",
                    },
                    "status": "running",
                    "NetworkSettings": {"Ports": {}, "Networks": {}},
                    "HostConfig": {"Devices": []},
                }
            ]
        }
        mock_get_client.return_value = mock_client

        request = self.factory.get("/docker/discover-containers/")
        response = self.view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], "container_abc_123")
        self.assertEqual(response.data[0]["name"], "tt_model_server")
