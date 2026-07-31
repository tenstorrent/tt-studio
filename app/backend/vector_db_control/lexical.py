# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""In-process BM25 lexical search over Chroma collections.

Dense embeddings from a small model miss exact terms (part numbers, API names,
error strings), so retrieval fuses these BM25 results with the vector results.
Indexes are built on demand from the collection contents and cached per
process. Staleness is detected by comparing the collection's document count
(one cheap Chroma call) plus a TTL — required because the backend runs several
uvicorn workers and in-process invalidation cannot reach sibling processes.
"""

import re
import threading
import time
from dataclasses import dataclass

from rank_bm25 import BM25Okapi

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# Collections larger than this skip BM25 rather than hold a huge index in RAM.
_MAX_INDEXABLE_CHUNKS = 50_000
_CACHE_TTL_SECONDS = 300.0


@dataclass
class _BM25Entry:
    bm25: BM25Okapi
    ids: list
    texts: list
    metadatas: list
    doc_count: int
    built_at: float


_cache: dict[str, _BM25Entry] = {}
_lock = threading.Lock()


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def invalidate(collection_name: str) -> None:
    with _lock:
        _cache.pop(collection_name, None)


def get_index(collection_name: str, embedding_func_name: str):
    """Return a fresh-enough BM25 index for the collection, or None."""
    from vector_db_control.singletons import ChromaClient, get_embedding_function

    embedding_func = get_embedding_function(model_name=embedding_func_name)
    collection = ChromaClient().get_collection(
        name=collection_name, embedding_function=embedding_func
    )
    count = collection.count()
    if count == 0 or count > _MAX_INDEXABLE_CHUNKS:
        if count > _MAX_INDEXABLE_CHUNKS:
            logger.warning(
                f"Collection {collection_name} has {count} chunks; skipping BM25 indexing"
            )
        return None

    entry = _cache.get(collection_name)
    now = time.monotonic()
    if entry and entry.doc_count == count and now - entry.built_at < _CACHE_TTL_SECONDS:
        return entry

    data = collection.get(include=["documents", "metadatas"])
    texts = data.get("documents") or []
    if not texts:
        return None
    entry = _BM25Entry(
        bm25=BM25Okapi([tokenize(t) for t in texts]),
        ids=data.get("ids") or [],
        texts=texts,
        metadatas=data.get("metadatas") or [None] * len(texts),
        doc_count=count,
        built_at=now,
    )
    with _lock:
        _cache[collection_name] = entry
    return entry


def bm25_query(
    collection_name: str,
    embedding_func_name: str,
    query_text: str,
    n_results: int = 30,
) -> list:
    """Rank the collection's chunks lexically against the query."""
    from vector_db_control.retrieval import RetrievedChunk

    entry = get_index(collection_name, embedding_func_name)
    if entry is None:
        return []
    tokens = tokenize(query_text)
    if not tokens:
        return []
    scores = entry.bm25.get_scores(tokens)
    ranked = sorted(
        (i for i, s in enumerate(scores) if s > 0),
        key=lambda i: scores[i],
        reverse=True,
    )[:n_results]
    return [
        RetrievedChunk(
            id=entry.ids[i],
            text=entry.texts[i],
            collection=collection_name,
            metadata=entry.metadatas[i],
            lexical_rank=rank + 1,
        )
        for rank, i in enumerate(ranked)
    ]
