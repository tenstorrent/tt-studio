# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from datetime import datetime
from itertools import batched
from typing import List

from chromadb.types import Collection

# your_app/singleton.py
from shared_config.logger_config import get_logger

logger = get_logger(__name__)
from vector_db_control.singletons import ChromaClient, get_embedding_function


def list_collections(filter_func=None):
    chroma_collections = ChromaClient().list_collections()
    if filter_func:
        return filter(filter_func, chroma_collections)
    return chroma_collections


def delete_collection(collection_name: str):
    ChromaClient().delete_collection(name=collection_name)


def get_collection(collection_name: str, embedding_func_name: str):
    embedding_func = get_embedding_function(model_name=embedding_func_name)
    return ChromaClient().get_collection(
        name=collection_name, embedding_function=embedding_func
    )


def create_collection(
    collection_name: str,
    embedding_func_name: str,
    metadata=None,
    distance_func_name: str = "cosine",
):
    # Metadata could be used in the future to filter our collections.
    # For instance - ` metadata = { 'target_models' : "X, Y, Z" }
    embedding_func = get_embedding_function(model_name=embedding_func_name)
    metadata = metadata or {}
    metadata.update(
        {"hnsw:space": distance_func_name, "embedding_func_name": embedding_func_name}
    )
    metadata.update({"created_at": datetime.now()})
    return ChromaClient().create_collection(
        name=collection_name, embedding_function=embedding_func, metadata=metadata
    )


def delete_collection(collection_name: str):
    if not ChromaClient().get_collection(collection_name):
        raise ValueError("Collection does not exist")
    ChromaClient().delete_collection(collection_name)


def query_collection(
    collection_name: str, embedding_func_name: str, query_texts: List[str]
):
    embedding_func = get_embedding_function(model_name=embedding_func_name)
    target_collection = ChromaClient().get_collection(
        name=collection_name, embedding_function=embedding_func
    )
    return target_collection.query(query_texts=query_texts)


def serialize_collection(collection: Collection):
    return {
        "id": str(collection.id),
        "metadata": collection.metadata,
        "name": collection.name,
    }


def insert_to_chroma_collection(
    collection_name: str,
    embedding_func_name: str,
    ids: list[str],
    documents: list[str],
    metadatas: list[dict],
):
    embedding_func = get_embedding_function(model_name=embedding_func_name)

    target_collection = ChromaClient().get_collection(
        name=collection_name,
        embedding_function=embedding_func,
    )

    document_indices = list(range(len(documents)))

    for batch in batched(document_indices, 166):
        start_idx = batch[0]
        end_idx = batch[-1] + 1
        metadatas = (
            metadatas[start_idx:end_idx] if metadatas and len(metadatas) else None
        )
        target_collection.add(
            ids=ids[start_idx:end_idx],
            documents=documents[start_idx:end_idx],
            metadatas=metadatas,
        )
