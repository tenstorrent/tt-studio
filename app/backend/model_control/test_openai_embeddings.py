# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for OpenAIEmbeddingsView.
"""

import os
import pytest
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from rest_framework.test import APIRequestFactory

from model_control.views import OpenAIEmbeddingsView


@patch("model_control.views.LITELLM_UPSTREAM_KEY", "")
class TestOpenAIEmbeddingsView:
    @patch("model_control.views.embed_text")
    @patch("model_control.views.find_deployed_embedding_model")
    def test_single_string_input(self, mock_find, mock_embed):
        mock_find.return_value = {"internal_url": "x:8000/v1/embeddings"}
        mock_embed.return_value = {"data": [{"embedding": [0.1, 0.2]}]}

        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/embeddings",
            {"model": "bge-m3", "input": "hello world"},
            format="json",
        )
        response = OpenAIEmbeddingsView.as_view()(request)

        assert response.status_code == 200
        assert mock_embed.call_count == 1
        assert response.data["data"] == [
            {"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}
        ]

    @patch("model_control.views.embed_text")
    @patch("model_control.views.find_deployed_embedding_model")
    def test_batched_list_input_is_fanned_out(self, mock_find, mock_embed):
        # The underlying TT inference server only accepts one string per
        # request; a RAG app's multi-chunk batch must become one call per chunk.
        mock_find.return_value = {"internal_url": "x:8000/v1/embeddings"}
        mock_embed.side_effect = [
            {"data": [{"embedding": [0.1]}]},
            {"data": [{"embedding": [0.2]}]},
            {"data": [{"embedding": [0.3]}]},
        ]

        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/embeddings",
            {"model": "bge-m3", "input": ["chunk one", "chunk two", "chunk three"]},
            format="json",
        )
        response = OpenAIEmbeddingsView.as_view()(request)

        assert response.status_code == 200
        assert mock_embed.call_count == 3
        assert [call.args[1] for call in mock_embed.call_args_list] == [
            "chunk one",
            "chunk two",
            "chunk three",
        ]
        assert response.data["data"] == [
            {"object": "embedding", "index": 0, "embedding": [0.1]},
            {"object": "embedding", "index": 1, "embedding": [0.2]},
            {"object": "embedding", "index": 2, "embedding": [0.3]},
        ]

    @patch("model_control.views.find_deployed_embedding_model")
    def test_missing_input_is_rejected(self, mock_find):
        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/embeddings", {"model": "bge-m3"}, format="json"
        )
        response = OpenAIEmbeddingsView.as_view()(request)
        assert response.status_code == 400
        mock_find.assert_not_called()

    @patch("model_control.views.find_deployed_embedding_model")
    def test_non_string_list_items_are_rejected(self, mock_find):
        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/embeddings",
            {"model": "bge-m3", "input": ["ok", 5]},
            format="json",
        )
        response = OpenAIEmbeddingsView.as_view()(request)
        assert response.status_code == 400
        mock_find.assert_not_called()

    @patch("model_control.views.find_deployed_embedding_model")
    def test_unknown_model_is_404(self, mock_find):
        mock_find.return_value = None
        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/embeddings",
            {"model": "not-deployed", "input": "hello"},
            format="json",
        )
        response = OpenAIEmbeddingsView.as_view()(request)
        assert response.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
