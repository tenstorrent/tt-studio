# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from api.views import _mask


class MaskTests(SimpleTestCase):
    def test_none_and_empty(self):
        self.assertIsNone(_mask(None))
        self.assertIsNone(_mask(""))

    def test_short_secret_fully_masked(self):
        # Short secrets must not leak most of their characters.
        masked = _mask("hf_shorty")  # 9 chars
        self.assertEqual(masked, "*" * len("hf_shorty"))
        self.assertNotIn("hf_", masked)

    def test_long_secret_shows_only_edges(self):
        masked = _mask("hf_" + "a" * 30 + "_end")
        self.assertTrue(masked.startswith("hf_a"))
        self.assertIn("****", masked)


class SettingsViewPostTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_empty_body_is_noop_success(self):
        response = self.client.post("/settings/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated"], [])
        self.assertFalse(response.data["requires_redeploy"])

    @patch("api.views.save_user_config")
    def test_hf_token_requires_redeploy(self, save_mock):
        response = self.client.post(
            "/settings/", {"hf_token": "hf_new"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["requires_redeploy"])
        self.assertEqual(response.data["updated"], ["hf_token"])
        save_mock.assert_called_once()

    @patch("api.views.save_user_config")
    def test_tavily_does_not_require_redeploy(self, save_mock):
        response = self.client.post(
            "/settings/", {"tavily_api_key": "tvly-x"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["requires_redeploy"])
        self.assertEqual(response.data["updated"], ["tavily_api_key"])

    def test_jwt_secret_is_rejected(self):
        response = self.client.post(
            "/settings/", {"jwt_secret": "hax"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_tts_api_key_is_rejected(self):
        response = self.client.post(
            "/settings/", {"tts_api_key": "hax"}, format="json"
        )
        self.assertEqual(response.status_code, 400)


@patch("api.views.is_setup_complete", return_value=True)
@patch("api.views.get_artifact_info", return_value={"branch": None, "version": "v0.0.0"})
@patch("api.views.get_tts_api_key", return_value=None)
@patch("api.views.get_tavily_api_key", return_value=None)
@patch("api.views.get_hf_token", return_value="hf_" + "a" * 30)
@patch("api.views.load_user_config", return_value={})
@patch("api.views.get_jwt_secret", return_value="jwt-secret-value-123")
class SettingsViewGetTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_editable_secret_includes_plaintext_value(self, *_mocks):
        response = self.client.get("/settings/")
        self.assertEqual(response.status_code, 200)
        field = response.data["hf_token"]
        self.assertTrue(field["set"])
        self.assertEqual(field["value"], "hf_" + "a" * 30)
        self.assertIn("****", field["masked"])

    def test_unset_secret_has_null_value(self, *_mocks):
        response = self.client.get("/settings/")
        self.assertIsNone(response.data["tavily_api_key"]["value"])
        self.assertFalse(response.data["tavily_api_key"]["set"])

    def test_jwt_secret_is_never_returned_in_plaintext(self, *_mocks):
        response = self.client.get("/settings/")
        jwt = response.data["jwt_secret"]
        self.assertTrue(jwt["set"])
        self.assertIsNone(jwt["value"])
        self.assertNotEqual(jwt["masked"], "jwt-secret-value-123")

    def test_tts_api_key_is_read_only(self, *_mocks):
        # Auto-managed like the JWT secret: shown but never editable or in plaintext.
        response = self.client.get("/settings/")
        tts = response.data["tts_api_key"]
        self.assertFalse(tts["editable"])
        self.assertIsNone(tts["value"])


@patch("api.views.get_hf_token", return_value="")
class HfCheckViewNoTokenTests(SimpleTestCase):
    """With no token saved, explicit repos are still checked anonymously so
    public (ungated) models don't get falsely blocked from deploying."""

    def setUp(self):
        self.client = APIClient()

    @patch("api.hf_access._check_repo", return_value=200)
    def test_public_repo_is_granted_without_token(self, _repo_mock, _token_mock):
        response = self.client.post(
            "/settings/hf-check/", {"repos": ["Qwen/Qwen3.5-9B"]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertEqual(response.data["results"][0]["status"], "granted")

    @patch("api.hf_access._check_repo", return_value=401)
    def test_gated_repo_reads_no_token_not_auth_failed(self, _repo_mock, _token_mock):
        # Anonymous 401 means "gated and no token saved", not a bad credential.
        response = self.client.post(
            "/settings/hf-check/",
            {"repos": ["meta-llama/Llama-3.1-8B-Instruct"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["ok"])
        self.assertEqual(response.data["results"][0]["status"], "no_token")

    def test_default_gated_set_short_circuits_without_network(self, _token_mock):
        # No repos requested: keep the old behavior — the default set is all
        # gated, so answer no_token for each without calling Hugging Face.
        with patch("api.hf_access._check_repo") as repo_mock:
            response = self.client.post("/settings/hf-check/", {}, format="json")
        repo_mock.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["ok"])
        self.assertTrue(
            all(r["status"] == "no_token" for r in response.data["results"])
        )
