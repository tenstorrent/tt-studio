# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from threading import Lock
from typing import Optional

from chromadb import HttpClient, Settings, ClientAPI
from chromadb.utils import embedding_functions

from shared_config.logger_config import get_logger
from vector_db_control.tt_embedding_function import TT_EMBED_PREFIX, TTDeployedEmbeddingFunction

logger = get_logger(__name__)

# Dictionary to store singleton instances
_instances = {}
# Lock for thread safety during initialization
_lock = Lock()

# The only model ChromaDB's ONNX embedding function can run.
ONNX_EMBED_MODEL = embedding_functions.ONNXMiniLM_L6_V2.MODEL_NAME


def get_embedding_function(model_name: str):
    """
    Returns the singleton embedding function for `model_name`, thread-safely
    creating it on first use.

    Two families:
    - "tt-embed:<model_identifier>" -- a TT-hardware-deployed embedding model
      (see vector_db_control.tt_embedding_function). The live deploy is
      re-resolved by identity on every call, so nothing is cached beyond the
      wrapper object itself.
    - anything else -- ChromaDB's built-in ONNX all-MiniLM-L6-v2, the default
      for every collection that doesn't opt into a TT-hardware model. Used
      instead of sentence-transformers, which requires torch and pulls in
      ~4.5 GB of CUDA wheels the backend never uses; both run the same weights
      and produce interchangeable 384-dimension vectors.
    """
    if model_name.startswith(TT_EMBED_PREFIX):
        if model_name not in _instances:
            with _lock:
                if model_name not in _instances:
                    _instances[model_name] = TTDeployedEmbeddingFunction(
                        model_name[len(TT_EMBED_PREFIX):]
                    )
        return _instances[model_name]

    # Check if the model instance already exists
    if model_name not in _instances:
        with _lock:  # Ensure that only one thread can initialize the model
            # Double-check pattern to avoid race condition
            if model_name not in _instances:
                if model_name != ONNX_EMBED_MODEL:
                    logger.warning(
                        f"CHROMA_DB_EMBED_MODEL={model_name!r} is not supported; "
                        f"embedding with {ONNX_EMBED_MODEL!r} instead. Collections "
                        f"created under {model_name!r} by an older build may have a "
                        f"different vector dimension and will fail to query."
                    )
                instance = embedding_functions.ONNXMiniLM_L6_V2()
                # The constructor is lazy — the model is loaded on first call.
                # Warm it here so the cost lands at startup (apps.py preloads
                # this singleton) rather than on a user's first query.
                try:
                    instance(["warmup"])
                except Exception:
                    logger.warning(
                        "Embedding model warm-up failed; it will be retried on "
                        "first use.",
                        exc_info=True,
                    )
                _instances[model_name] = instance

    return _instances[model_name]


class ChromaClient:
    _instance: Optional[ClientAPI] = None
    _lock = Lock()

    def __new__(cls, host=None, port=None):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    logger.info(f"Initializing ChromaDB connection {host}:{port}")
                    cls._instance = HttpClient(
                        host=host, port=port, settings=Settings()
                    )
        return cls._instance
