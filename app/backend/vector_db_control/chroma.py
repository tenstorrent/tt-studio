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
    collection_name: str,
    embedding_func_name: str,
    query_texts: List[str],
    n_results: int = 10,
    distance_threshold: float = None,
    min_documents: int = None
):
    """
    Query a collection with optional confidence filtering.

    Args:
        collection_name: Name of the collection to query
        embedding_func_name: Name of the embedding function to use
        query_texts: List of query texts
        n_results: Maximum number of results to return
        distance_threshold: Maximum distance to consider (lower is better, typical range 0-2)
                          Results with distance > threshold will be filtered out
        min_documents: Minimum number of documents required to pass threshold after filtering

    Returns:
        dict: Query results with additional metadata:
            - documents: List of document texts
            - metadatas: List of metadata dicts
            - distances: List of distance scores
            - ids: List of document IDs
            - is_answerable: Boolean indicating if query has sufficient confident results
            - confidence_level: String indicating confidence ('high', 'medium', 'low', 'insufficient')
            - filtered_count: Number of results that passed the threshold
    """
    embedding_func = get_embedding_function(model_name=embedding_func_name)
    target_collection = ChromaClient().get_collection(
        name=collection_name, embedding_function=embedding_func
    )

    # Get raw results from ChromaDB
    raw_results = target_collection.query(query_texts=query_texts, n_results=n_results)

    # If no threshold filtering requested, return raw results with metadata
    if distance_threshold is None:
        raw_results['is_answerable'] = True
        raw_results['confidence_level'] = 'high'
        raw_results['filtered_count'] = len(raw_results.get('distances', [[]])[0])
        return raw_results

    # Apply distance threshold filtering
    filtered_results = {
        'documents': [[]],
        'metadatas': [[]],
        'distances': [[]],
        'ids': [[]]
    }

    # Process first query (batch index 0)
    if raw_results.get('distances') and len(raw_results['distances']) > 0:
        for i, distance in enumerate(raw_results['distances'][0]):
            if distance <= distance_threshold:
                filtered_results['documents'][0].append(raw_results['documents'][0][i])
                filtered_results['metadatas'][0].append(raw_results['metadatas'][0][i])
                filtered_results['distances'][0].append(distance)
                filtered_results['ids'][0].append(raw_results['ids'][0][i])

    # Determine if query is answerable based on filtered results
    filtered_count = len(filtered_results['distances'][0])
    min_docs = min_documents if min_documents is not None else 0
    is_answerable = filtered_count >= min_docs

    # Calculate confidence level based on distances and count
    if filtered_count == 0:
        confidence_level = 'insufficient'
    elif filtered_count < min_docs:
        confidence_level = 'insufficient'
    else:
        # Use the best (lowest) distance to determine confidence
        best_distance = min(filtered_results['distances'][0]) if filtered_results['distances'][0] else float('inf')
        if best_distance <= 0.5:
            confidence_level = 'high'
        elif best_distance <= 0.8:
            confidence_level = 'medium'
        else:
            confidence_level = 'low'

    # Add metadata to results
    filtered_results['is_answerable'] = is_answerable
    filtered_results['confidence_level'] = confidence_level
    filtered_results['filtered_count'] = filtered_count
    filtered_results['raw_count'] = len(raw_results.get('distances', [[]])[0])
    filtered_results['threshold_used'] = distance_threshold
    filtered_results['min_documents_required'] = min_docs

    logger.info(
        f"Query filtering: {filtered_count}/{filtered_results['raw_count']} results "
        f"passed threshold {distance_threshold}, answerable={is_answerable}, "
        f"confidence={confidence_level}"
    )

    return filtered_results


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
