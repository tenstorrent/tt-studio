from datetime import datetime
from itertools import batched
from typing import List

import chromadb
from chromadb import ClientAPI
from chromadb.config import Settings
from chromadb.types import Collection
from chromadb.utils import embedding_functions

from shared_config.logger_config import get_logger

chromadb_client = None

logger = get_logger(__name__)


def get_chroma_client(host: str, port: int, username=None, password=None):
    global chromadb_client
    logger.info(f"Attempting to connect to ChromaDB at {host}:{port}")
    if not chromadb_client:
        chromadb_client = chromadb.HttpClient(host=host, port=port,
                                              settings=Settings())
    return chromadb_client


def list_collections(chroma_client: ClientAPI, filter_func=None):
    chroma_collections = chroma_client.list_collections()
    if filter_func:
        return filter(filter_func, chroma_collections)
    return chroma_collections


def get_collection(chroma_client: ClientAPI, collection_name: str, embedding_func_name: str):
    embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=embedding_func_name
    )
    return chroma_client.get_collection(name=collection_name, embedding_function=embedding_func)


def create_collection(chroma_client: ClientAPI, collection_name: str, embedding_func_name: str,
                      metadata=None, distance_func_name: str = "cosine"):
    # Metadata could be used in the future to filter our collections.
    # For instance - ` metadata = { 'target_models' : "X, Y, Z" }
    embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=embedding_func_name
    )
    metadata = metadata or {}
    metadata.update({"hnsw:space": distance_func_name, "embedding_func_name": embedding_func_name})
    metadata.update({"created_at": datetime.now()})
    return chroma_client.create_collection(name=collection_name, embedding_function=embedding_func, metadata=metadata)


def delete_collection(chroma_client: ClientAPI, collection_name: str):
    if not chroma_client.get_collection(collection_name):
        raise ValueError('Collection does not exist')
    chroma_client.delete_collection(collection_name)


def query_collection(chroma_client: ClientAPI, collection_name: str, embedding_func_name: str,
                     query_texts: List[str]):
    embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=embedding_func_name
    )
    target_collection = chroma_client.get_collection(name=collection_name, embedding_function=embedding_func)
    return target_collection.query(query_texts=query_texts)


def serialize_collection(collection: Collection):
    return {
        "id": str(collection.id),
        "metadata": collection.metadata,
        "name": collection.name,
    }


def insert_to_chroma_collection(
        chroma_client: ClientAPI,
        collection_name: str,
        embedding_func_name: str,
        ids: list[str],
        documents: list[str],
        metadatas: list[dict],

):
    embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=embedding_func_name
    )

    target_collection = chroma_client.get_collection(
        name=collection_name,
        embedding_function=embedding_func,
    )

    document_indices = list(range(len(documents)))

    for batch in batched(document_indices, 166):
        start_idx = batch[0]
        end_idx = batch[-1] + 1
        metadatas = metadatas[start_idx:end_idx] if metadatas and len(metadatas) else None
        target_collection.add(
            ids=ids[start_idx:end_idx],
            documents=documents[start_idx:end_idx],
            metadatas=metadatas,
        )
