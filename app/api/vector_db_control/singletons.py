# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from threading import Lock
from typing import Optional

from chromadb import HttpClient, Settings, ClientAPI
from chromadb.utils import embedding_functions

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# Dictionary to store singleton instances
_instances = {}
# Lock for thread safety during initialization
_lock = Lock()


def get_embedding_function(model_name: str):
    """
    Returns the singleton instance of the SentenceTransformer model.
    Ensures that the model is loaded only once in a thread-safe manner.
    """

    # Check if the model instance already exists
    if model_name not in _instances:
        with _lock:  # Ensure that only one thread can initialize the model
            # Double-check pattern to avoid race condition
            if model_name not in _instances:
                _instances[model_name] = (
                    embedding_functions.SentenceTransformerEmbeddingFunction(
                        model_name=model_name
                    )
                )

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
