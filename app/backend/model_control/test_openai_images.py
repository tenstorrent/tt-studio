# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for OpenAI-compatible image generation (Open WebUI's image engine) and the
shared generate_image it drives every image-serving stack through.
"""

import base64
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from rest_framework.test import APIRequestFactory

from model_control.image_generation import ImageGenerationError, generate_image
from model_control.views import OpenAIImagesGenerationsView

PNG = b"\x89PNG fake"


def _post(body):
    request = APIRequestFactory().post(
        "/models/openai/v1/images/generations", body, format="json"
    )
    return OpenAIImagesGenerationsView.as_view()(request)


@patch("model_control.views.LITELLM_UPSTREAM_KEY", "")
class TestOpenAIImagesGenerationsView:
    @patch("model_control.views.generate_image", return_value=(PNG, "image/png"))
    @patch("model_control.views.find_deployed_image_model")
    def test_returns_b64_json_whatever_size_is_asked(self, mock_find, mock_generate):
        # Open WebUI sends its configured size; the served resolution is fixed.
        mock_find.return_value = {"internal_url": "qwen:7000"}
        response = _post(
            {
                "model": "Qwen/Qwen-Image-2.1",
                "prompt": "a fox",
                "n": 1,
                "size": "512x512",
                "response_format": "b64_json",
            }
        )
        assert response.status_code == 200
        assert response.data["data"] == [{"b64_json": base64.b64encode(PNG).decode()}]
        mock_generate.assert_called_once_with(mock_find.return_value, "a fox")

    @patch("model_control.views.generate_image", return_value=(PNG, "image/png"))
    @patch("model_control.views.find_deployed_image_model", return_value={})
    def test_n_images_are_generated(self, _find, mock_generate):
        response = _post({"model": "m", "prompt": "p", "n": 3})
        assert len(response.data["data"]) == 3
        assert mock_generate.call_count == 3

    @patch("model_control.views.find_deployed_image_model", return_value={})
    def test_an_oversized_batch_is_rejected(self, _find):
        assert _post({"model": "m", "prompt": "p", "n": 5}).status_code == 400

    @patch("model_control.views.find_deployed_image_model", return_value=None)
    def test_unknown_model_is_404(self, _find):
        assert _post({"model": "nope", "prompt": "p"}).status_code == 404

    def test_missing_prompt_is_rejected(self):
        assert _post({"model": "m"}).status_code == 400

    @patch(
        "model_control.views.generate_image",
        side_effect=ImageGenerationError(502, "Generation error."),
    )
    @patch("model_control.views.find_deployed_image_model", return_value={})
    def test_a_failed_generation_reports_its_status(self, _find, _generate):
        response = _post({"model": "m", "prompt": "p"})
        assert response.status_code == 502
        assert response.data["error"]["message"] == "Generation error."


def _response(status_code=200, json_body=None, content=b"", headers=None):
    response = MagicMock(
        status_code=status_code, content=content, headers=headers or {}
    )
    response.json.return_value = json_body or {}
    response.raise_for_status.return_value = None
    return response


@patch("model_control.image_generation.get_tts_api_key", return_value="")
class TestGenerateImage:
    def test_a_routeless_predict_server_is_driven_synchronously(self, _key):
        # Qwen-Image-2.1: registered with no route, identified from its OpenAPI.
        openapi = _response(json_body={"paths": {"/health": {}, "/predict": {}}})
        predict = _response(json_body={"image": base64.b64encode(PNG).decode()})
        with patch(
            "model_control.image_generation.requests.get", return_value=openapi
        ), patch(
            "model_control.image_generation.requests.post", return_value=predict
        ) as post:
            image, content_type = generate_image({"internal_url": "qwen:7000"}, "a fox")
        assert (image, content_type) == (PNG, "image/png")
        assert post.call_args.args[0] == "http://qwen:7000/predict"

    def test_a_tt_dit_job_is_polled_then_fetched(self, _key):
        submit = _response(json_body={"job_id": "j1"})
        done = _response(json_body={"status": "done"})
        image = _response(content=PNG, headers={"Content-Type": "image/png"})
        with patch(
            "model_control.image_generation.requests.post", return_value=submit
        ), patch(
            "model_control.image_generation.requests.get", side_effect=[done, image]
        ) as get:
            result = generate_image({"internal_url": "flux2:7000/generate"}, "a fox")
        assert result == (PNG, "image/png")
        assert get.call_args_list[0].args[0] == "http://flux2:7000/jobs/j1"
        assert get.call_args_list[1].args[0] == "http://flux2:7000/jobs/j1/image"

    def test_a_failed_job_raises_with_its_error(self, _key):
        submit = _response(json_body={"job_id": "j1"})
        failed = _response(json_body={"status": "error", "error": "OOM"})
        with patch(
            "model_control.image_generation.requests.post", return_value=submit
        ), patch("model_control.image_generation.requests.get", return_value=failed):
            with pytest.raises(ImageGenerationError) as err:
                generate_image({"internal_url": "flux2:7000/generate"}, "a fox")
        assert (err.value.status_code, err.value.message) == (502, "OOM")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
