# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the Chroma embedding function singleton.

These guard the properties that let existing collections stay queryable after
the switch from sentence-transformers to ChromaDB's ONNX embedding function:
384 dimensions, L2-normalized output, and stable vectors for a known input.
"""

import math
from unittest.mock import patch

import pytest

from vector_db_control import singletons
from vector_db_control.singletons import ONNX_EMBED_MODEL, get_embedding_function

# all-MiniLM-L6-v2 output for "Tenstorrent builds AI accelerators.". Pinned so a
# ChromaDB upgrade that swaps the underlying model is caught rather than silently
# invalidating every stored collection.
GOLDEN_TEXT = "Tenstorrent builds AI accelerators."
GOLDEN_PREFIX = [
    -0.096202,
    -0.021495,
    0.010587,
    -0.028868,
    -0.019990,
    -0.022619,
    -0.086542,
    0.032919,
]


@pytest.fixture(scope="module")
def embedding_function():
    return get_embedding_function(model_name=ONNX_EMBED_MODEL)


class TestEmbeddingFunction:
    """Test the embedding function's output shape and stability."""

    def test_returns_384_normalized_dimensions(self, embedding_function):
        """Vectors must be 384-dimensional and L2-normalized to match stored ones."""
        vector = embedding_function(["hello world"])[0]

        assert len(vector) == 384
        norm = math.sqrt(sum(float(x) ** 2 for x in vector))
        assert norm == pytest.approx(1.0, abs=1e-5)

    def test_known_input_embeds_to_known_vector(self, embedding_function):
        """A pinned input must keep embedding to the same vector."""
        vector = embedding_function([GOLDEN_TEXT])[0]

        for actual, expected in zip(vector, GOLDEN_PREFIX):
            assert float(actual) == pytest.approx(expected, abs=1e-5)

    def test_input_longer_than_the_token_limit_embeds(self, embedding_function):
        """The model truncates at 256 tokens; long chunks must not raise."""
        vector = embedding_function([" ".join(["accelerator"] * 2000)])[0]

        assert len(vector) == 384

    def test_batch_embeds_each_document(self, embedding_function):
        """A batch must return one vector per document, in order."""
        docs = ["first document", "second document", "third document"]

        vectors = embedding_function(docs)

        assert len(vectors) == len(docs)
        single = embedding_function([docs[1]])[0]
        for actual, expected in zip(vectors[1], single):
            assert float(actual) == pytest.approx(float(expected), abs=1e-5)


class TestEmbeddingFunctionSingleton:
    """Test the caching and unsupported-model handling in get_embedding_function."""

    def test_repeated_calls_return_the_same_instance(self):
        """Callers hit this per request; a new instance each time would rebuild
        the ONNX inference session."""
        first = get_embedding_function(model_name=ONNX_EMBED_MODEL)
        second = get_embedding_function(model_name=ONNX_EMBED_MODEL)

        assert first is second

    def test_unsupported_model_warns_and_still_embeds(self):
        """An unsupported CHROMA_DB_EMBED_MODEL must warn, not raise, so the
        backend still boots."""
        # The backend's loggers don't propagate, so patch this one rather than
        # relying on caplog's root handler.
        with patch.object(singletons.logger, "warning") as mock_warning:
            function = get_embedding_function(model_name="all-mpnet-base-v2")

        assert mock_warning.called
        assert "not supported" in mock_warning.call_args.args[0]
        assert len(function(["hello world"])[0]) == 384
