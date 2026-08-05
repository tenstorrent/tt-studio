# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from shared_config.model_type_config import ModelTypes
from training_control.views import _base_url, _find_training_container


def _entry(model_type=ModelTypes.TRAINING, internal_url="training-host:7000/v1/jobs"):
    return {
        "model_impl": Mock(model_type=model_type),
        "internal_url": internal_url,
    }


class FindTrainingContainerTests(SimpleTestCase):
    @patch("training_control.views.get_deploy_cache")
    def test_deploy_id_found(self, cache_mock):
        entry = _entry()
        cache_mock.return_value = {"dep-1": entry}
        found, err = _find_training_container("dep-1")
        self.assertIs(found, entry)
        self.assertIsNone(err)

    @patch("training_control.views.get_deploy_cache")
    def test_unknown_deploy_id_is_404(self, cache_mock):
        cache_mock.return_value = {}
        found, err = _find_training_container("nope")
        self.assertIsNone(found)
        self.assertEqual(err.status_code, 404)

    @patch("training_control.views.get_deploy_cache")
    def test_non_training_deploy_id_is_400(self, cache_mock):
        cache_mock.return_value = {"dep-1": _entry(model_type=ModelTypes.CHAT)}
        found, err = _find_training_container("dep-1")
        self.assertIsNone(found)
        self.assertEqual(err.status_code, 400)

    @patch("training_control.views.get_deploy_cache")
    def test_no_deploy_id_picks_first_training_entry(self, cache_mock):
        training = _entry()
        cache_mock.return_value = {
            "dep-chat": _entry(model_type=ModelTypes.CHAT),
            "dep-train": training,
        }
        found, err = _find_training_container()
        self.assertIs(found, training)
        self.assertIsNone(err)

    @patch("training_control.views.get_deploy_cache")
    def test_no_training_container_is_404(self, cache_mock):
        cache_mock.return_value = {"dep-chat": _entry(model_type=ModelTypes.CHAT)}
        found, err = _find_training_container()
        self.assertIsNone(found)
        self.assertEqual(err.status_code, 404)


class BaseUrlTests(SimpleTestCase):
    def test_strips_route_from_internal_url(self):
        self.assertEqual(
            _base_url({"internal_url": "container:7000/v1/jobs"}),
            "http://container:7000",
        )

    def test_plain_host_port(self):
        self.assertEqual(
            _base_url({"internal_url": "container:7000"}),
            "http://container:7000",
        )


class TrainingJobsRouteTests(SimpleTestCase):
    """Exercises api/urls.py -> training_control/urls.py -> views end to end."""

    def setUp(self):
        self.client = APIClient()

    @patch("training_control.views.get_deploy_cache", return_value={})
    def test_no_training_container_returns_404_json(self, _cache_mock):
        response = self.client.get("/training/jobs/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.json()["error"], "No running training container found."
        )

    @patch("training_control.views.requests.get")
    @patch("training_control.views.get_deploy_cache")
    def test_unreachable_container_returns_502(self, cache_mock, get_mock):
        import requests

        cache_mock.return_value = {"dep-train": _entry()}
        get_mock.side_effect = requests.ConnectionError("boom")
        response = self.client.get("/training/jobs/")
        self.assertEqual(response.status_code, 502)
        self.assertIn("not reachable", response.json()["error"])
        get_mock.assert_called_once()
        self.assertTrue(
            get_mock.call_args.args[0].startswith("http://training-host:7000")
        )
