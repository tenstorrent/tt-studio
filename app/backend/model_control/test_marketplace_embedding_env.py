# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for marketplace_utils.embedding_model_env's chunk-size sizing --
it must be derived from the picked embedding model's own configured max
sequence length, not a fixed guess that can be many times too large for a
small deployed embedder.
"""

import os
import pytest
from unittest.mock import Mock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from model_control.marketplace_utils import (
    DEFAULT_EMBEDDING_MAX_LENGTH,
    embedding_model_env,
)
from shared_config.marketplace_config import MarketplaceApp, AppKind


def _app(embedding_gateway_env):
    return MarketplaceApp(
        id="test-app",
        name="Test App",
        tagline="",
        category="Chat",
        kind=AppKind.CONTAINER,
        docs_url="https://example.com",
        embedding_gateway_env=embedding_gateway_env,
    )


def _deploy(max_model_length):
    impl = Mock()
    impl.docker_config = {"environment": {"VLLM__MAX_MODEL_LENGTH": str(max_model_length)}}
    return {"model_impl": impl}


class TestEmbeddingModelEnv:
    def test_no_embedding_model_renders_nothing(self):
        app = _app({"X": "{model}"})
        assert embedding_model_env(app, None) == {}

    def test_app_without_embedding_support_renders_nothing(self):
        app = _app({})
        assert embedding_model_env(app, "bge-m3") == {}

    @patch("model_control.model_utils.find_deployed_embedding_model")
    def test_chunk_size_scales_with_small_model(self, mock_find):
        # bge-m3's real deploy: 128-token max sequence length.
        mock_find.return_value = _deploy(128)
        app = _app({
            "CHUNK_TOKENS": "{max_chunk_tokens}",
            "CHUNK_CHARS": "{max_chunk_chars}",
            "OVERLAP": "{chunk_overlap_tokens}",
        })
        rendered = embedding_model_env(app, "bge-m3")
        assert rendered["CHUNK_TOKENS"] == "96"  # 128 * 0.75
        assert rendered["CHUNK_CHARS"] == "384"  # 96 * 4
        assert rendered["OVERLAP"] == "9"

    @patch("model_control.model_utils.find_deployed_embedding_model")
    def test_chunk_size_scales_with_larger_model(self, mock_find):
        mock_find.return_value = _deploy(1024)
        app = _app({"CHUNK_TOKENS": "{max_chunk_tokens}", "CHUNK_CHARS": "{max_chunk_chars}"})
        rendered = embedding_model_env(app, "Qwen3-Embedding-4B")
        assert rendered["CHUNK_TOKENS"] == "768"  # 1024 * 0.75
        assert rendered["CHUNK_CHARS"] == "3072"

    @patch("model_control.model_utils.find_deployed_embedding_model")
    def test_falls_back_to_default_when_model_not_found(self, mock_find):
        mock_find.return_value = None
        app = _app({"CHUNK_TOKENS": "{max_chunk_tokens}"})
        rendered = embedding_model_env(app, "not-deployed")
        assert rendered["CHUNK_TOKENS"] == str(int(DEFAULT_EMBEDDING_MAX_LENGTH * 0.75))

    @patch("model_control.model_utils.find_deployed_embedding_model")
    def test_falls_back_to_default_when_max_length_missing(self, mock_find):
        impl = Mock()
        impl.docker_config = {"environment": {}}
        mock_find.return_value = {"model_impl": impl}
        app = _app({"CHUNK_TOKENS": "{max_chunk_tokens}"})
        rendered = embedding_model_env(app, "bge-m3")
        assert rendered["CHUNK_TOKENS"] == str(int(DEFAULT_EMBEDDING_MAX_LENGTH * 0.75))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
