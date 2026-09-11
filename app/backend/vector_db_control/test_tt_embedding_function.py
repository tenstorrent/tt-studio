# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for TTDeployedEmbeddingFunction and its dispatch through get_embedding_function.
"""

from unittest.mock import patch

import pytest

from vector_db_control.singletons import get_embedding_function
from vector_db_control.tt_embedding_function import TT_EMBED_PREFIX, TTDeployedEmbeddingFunction


class TestTTDeployedEmbeddingFunction:
    @patch("model_control.model_utils.embed_text")
    @patch("model_control.model_utils.find_deployed_embedding_model")
    def test_embeds_each_input_via_the_deployed_model(self, mock_find, mock_embed):
        mock_find.return_value = {"internal_url": "x:8000/v1/embeddings"}
        mock_embed.side_effect = [
            {"data": [{"embedding": [0.1, 0.2]}]},
            {"data": [{"embedding": [0.3, 0.4]}]},
        ]

        fn = TTDeployedEmbeddingFunction("Qwen/Qwen3-Embedding-4B")
        result = fn(["a", "b"])

        assert result == [[0.1, 0.2], [0.3, 0.4]]
        mock_find.assert_called_with("Qwen/Qwen3-Embedding-4B")

    @patch("model_control.model_utils.find_deployed_embedding_model")
    def test_raises_clearly_when_model_not_deployed(self, mock_find):
        mock_find.return_value = None
        fn = TTDeployedEmbeddingFunction("Qwen/Qwen3-Embedding-4B")
        with pytest.raises(RuntimeError, match="not currently deployed"):
            fn(["a"])


class TestGetEmbeddingFunctionDispatch:
    def test_tt_embed_prefix_returns_tt_deployed_function(self):
        fn = get_embedding_function(f"{TT_EMBED_PREFIX}Qwen/Qwen3-Embedding-4B")
        assert isinstance(fn, TTDeployedEmbeddingFunction)
        assert fn.model_identifier == "Qwen/Qwen3-Embedding-4B"

    def test_repeated_calls_return_the_same_instance(self):
        first = get_embedding_function(f"{TT_EMBED_PREFIX}bge-m3")
        second = get_embedding_function(f"{TT_EMBED_PREFIX}bge-m3")
        assert first is second
