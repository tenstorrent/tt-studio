# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for EmbeddingInferenceView.
"""

import pytest
from unittest.mock import Mock, patch
from rest_framework.test import APIRequestFactory

from model_control.views import EmbeddingInferenceView


class TestEmbeddingInferenceView:
    @patch('model_control.serializers.get_deploy_cache')
    @patch('model_control.views.get_deploy_cache')
    @patch('model_control.views.requests.post')
    def test_payload_uses_hf_model_id_not_short_model_name(self, mock_post, mock_cache, mock_serializer_cache):
        """tt-media-server's embedding runners validate "model" against the HF
        org/repo id (e.g. "Qwen/Qwen3-Embedding-4B"), not the catalog's short
        model_name (e.g. "Qwen3-Embedding-4B") -- sending the short name gets a
        500 "Model ... is not supported" from the runner. Verified live against
        a running Qwen3-Embedding-4B container."""
        mock_impl = Mock()
        mock_impl.model_name = "Qwen3-Embedding-4B"
        mock_impl.hf_model_id = "Qwen/Qwen3-Embedding-4B"
        mock_impl.inference_engine = "forge"

        deploy_cache = {
            "test_deploy_id": {
                "internal_url": "qwen-embed:8000/v1/embeddings",
                "model_impl": mock_impl,
            }
        }
        mock_cache.return_value = deploy_cache
        mock_serializer_cache.return_value = deploy_cache

        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "object": "list",
            "data": [{"object": "embedding", "embedding": [0.1, 0.2], "index": 0}],
            "model": "Qwen/Qwen3-Embedding-4B",
        }
        mock_post.return_value = mock_resp

        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/embedding/",
            {"deploy_id": "test_deploy_id", "input": "Hello world"},
            format="json",
        )
        response = EmbeddingInferenceView.as_view()(request)

        assert response.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert sent_payload["model"] == "Qwen/Qwen3-Embedding-4B"

    @patch('model_control.serializers.get_deploy_cache')
    @patch('model_control.views.get_deploy_cache')
    @patch('model_control.views.requests.post')
    def test_falls_back_to_model_name_when_hf_model_id_missing(self, mock_post, mock_cache, mock_serializer_cache):
        mock_impl = Mock()
        mock_impl.model_name = "some-embedder"
        mock_impl.hf_model_id = None
        mock_impl.inference_engine = "media"

        deploy_cache = {
            "test_deploy_id": {
                "internal_url": "some-embedder:8000/v1/embeddings",
                "model_impl": mock_impl,
            }
        }
        mock_cache.return_value = deploy_cache
        mock_serializer_cache.return_value = deploy_cache

        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"object": "list", "data": []}
        mock_post.return_value = mock_resp

        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/embedding/",
            {"deploy_id": "test_deploy_id", "input": "Hello world"},
            format="json",
        )
        response = EmbeddingInferenceView.as_view()(request)

        assert response.status_code == 200
        sent_payload = mock_post.call_args.kwargs["json"]
        assert sent_payload["model"] == "some-embedder"

    @patch('model_control.serializers.get_deploy_cache')
    @patch('model_control.views.get_deploy_cache')
    def test_missing_input_is_rejected(self, mock_cache, mock_serializer_cache):
        deploy_cache = {
            "test_deploy_id": {"internal_url": "x:8000/v1/embeddings", "model_impl": Mock()}
        }
        mock_cache.return_value = deploy_cache
        mock_serializer_cache.return_value = deploy_cache

        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/embedding/", {"deploy_id": "test_deploy_id"}, format="json"
        )
        response = EmbeddingInferenceView.as_view()(request)
        assert response.status_code == 400


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
