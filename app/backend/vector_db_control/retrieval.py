# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Retrieval orchestration for the /collections/retrieve endpoint.

Combines dense (Chroma) and lexical (BM25) candidates with reciprocal-rank
fusion, optionally reranks them with a cross-encoder, expands child chunks to
their parent sections, and trims the result to a token budget. The pure
helpers here are unit-tested without a running Chroma instance.
"""

from dataclasses import dataclass, field

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

RRF_K = 60
DEFAULT_OVER_FETCH = 30
# BM25 stage names accepted in disable_stages (eval ablations).
STAGES = ("hybrid", "rerank", "threshold", "parents")


@dataclass
class RetrievedChunk:
    id: str
    text: str
    collection: str
    metadata: dict | None = None
    distance: float | None = None
    dense_rank: int | None = None
    lexical_rank: int | None = None
    rrf_score: float = 0.0
    rerank_score: float | None = None
    signals: dict = field(default_factory=dict)

    @property
    def source(self) -> str | None:
        return (self.metadata or {}).get("source")

    @property
    def final_score(self) -> float:
        return self.rerank_score if self.rerank_score is not None else self.rrf_score


def approx_token_count(text: str) -> int:
    # Rough chars/4 heuristic; good enough for budgeting without a tokenizer dep.
    return max(1, len(text) // 4)


def dense_result_to_chunks(
    chroma_result: dict, collection_name: str
) -> list[RetrievedChunk]:
    """Unwrap the Chroma single-query shape into ranked RetrievedChunks."""
    ids = (chroma_result.get("ids") or [[]])[0]
    documents = (chroma_result.get("documents") or [[]])[0]
    metadatas = (chroma_result.get("metadatas") or [[]])[0]
    distances = (chroma_result.get("distances") or [[]])[0]
    chunks = []
    for rank, chunk_id in enumerate(ids):
        chunks.append(
            RetrievedChunk(
                id=chunk_id,
                text=documents[rank] if rank < len(documents) else "",
                collection=collection_name,
                metadata=metadatas[rank] if rank < len(metadatas) else None,
                distance=distances[rank] if rank < len(distances) else None,
                dense_rank=rank + 1,
            )
        )
    return chunks


def rrf_fuse(
    ranked_lists: list[list[RetrievedChunk]], k: int = RRF_K
) -> list[RetrievedChunk]:
    """Reciprocal-rank fusion across candidate lists.

    The same chunk (keyed by collection + id) appearing in several lists gets
    its scores summed and its dense/lexical signals merged onto one object.
    """
    fused: dict[tuple[str, str], RetrievedChunk] = {}
    for ranked in ranked_lists:
        for rank, chunk in enumerate(ranked, start=1):
            key = (chunk.collection, chunk.id)
            existing = fused.get(key)
            if existing is None:
                chunk.rrf_score += 1.0 / (k + rank)
                fused[key] = chunk
            else:
                existing.rrf_score += 1.0 / (k + rank)
                if existing.dense_rank is None:
                    existing.dense_rank = chunk.dense_rank
                if existing.lexical_rank is None:
                    existing.lexical_rank = chunk.lexical_rank
                if existing.distance is None:
                    existing.distance = chunk.distance
    return sorted(fused.values(), key=lambda c: c.rrf_score, reverse=True)


def filter_by_distance(
    chunks: list[RetrievedChunk], max_distance: float | None
) -> list[RetrievedChunk]:
    """Drop dense hits beyond the distance ceiling; lexical-only hits survive."""
    if max_distance is None:
        return chunks
    return [c for c in chunks if c.distance is None or c.distance <= max_distance]


def expand_to_parents(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
    """Small-to-big expansion: swap child chunks for their parent section.

    Children of the same parent collapse into one entry — the best-scored child
    wins and its text is replaced with the stored parent text. Legacy chunks
    without parent metadata pass through unchanged.
    """
    seen: set[tuple[str, str]] = set()
    expanded = []
    for chunk in chunks:
        meta = chunk.metadata or {}
        parent_id = meta.get("parent_id")
        key = (chunk.collection, parent_id or chunk.id)
        if key in seen:
            continue
        seen.add(key)
        parent_text = meta.get("parent_text")
        if parent_id and parent_text:
            chunk.text = parent_text
        expanded.append(chunk)
    return expanded


def apply_rerank_threshold(
    reranked: list[RetrievedChunk], min_score: float, floor: int
) -> list[RetrievedChunk]:
    """Drop low-scoring reranked chunks, but keep at least `floor` of the best.

    On niche corpora the cross-encoder can score every candidate below the
    threshold; a few weak chunks ground the answer better than none. Expects
    `reranked` sorted by rerank_score descending (reranker.rerank's order).
    """
    kept = [c for c in reranked if (c.rerank_score or 0.0) >= min_score]
    if len(kept) >= floor:
        return kept
    return reranked[:floor]


def trim_to_token_budget(
    chunks: list[RetrievedChunk], budget_tokens: int
) -> list[RetrievedChunk]:
    """Keep chunks until the cumulative approx token count exceeds the budget.

    Always keeps at least the first chunk so an oversized best hit still grounds
    the answer.
    """
    kept = []
    total = 0
    for chunk in chunks:
        cost = approx_token_count(chunk.text)
        if kept and total + cost > budget_tokens:
            break
        kept.append(chunk)
        total += cost
    return kept


def retrieve(
    query_text: str,
    collection_names: list[str],
    embedding_func_name: str,
    *,
    top_k: int = 5,
    over_fetch: int = DEFAULT_OVER_FETCH,
    max_distance: float | None = None,
    where: dict | None = None,
    token_budget: int = 2000,
    use_rerank: bool = True,
    rerank_min_score: float = 0.05,
    rerank_floor: int = 2,
    disable_stages: tuple = (),
) -> dict:
    """Run the full retrieval pipeline over the given collections.

    Per-collection failures are recorded and skipped; the caller decides what to
    do when every collection failed.
    """
    from vector_db_control import lexical, reranker
    from vector_db_control.chroma import query_collection

    candidate_lists: list[list[RetrievedChunk]] = []
    collection_errors: dict[str, str] = {}

    for name in collection_names:
        try:
            dense = query_collection(
                collection_name=name,
                embedding_func_name=embedding_func_name,
                query_texts=[query_text],
                n_results=over_fetch,
                where=where,
            )
            dense_chunks = dense_result_to_chunks(dense, name)
            if "threshold" not in disable_stages:
                dense_chunks = filter_by_distance(dense_chunks, max_distance)
            candidate_lists.append(dense_chunks)
        except Exception as e:
            logger.warning(f"Dense retrieval failed for collection {name}: {e}")
            collection_errors[name] = str(e)
            continue

        if "hybrid" not in disable_stages:
            try:
                lexical_chunks = lexical.bm25_query(
                    collection_name=name,
                    embedding_func_name=embedding_func_name,
                    query_text=query_text,
                    n_results=over_fetch,
                )
                if lexical_chunks:
                    candidate_lists.append(lexical_chunks)
            except Exception as e:
                # Lexical channel is best-effort; dense results still stand.
                logger.warning(f"BM25 retrieval failed for collection {name}: {e}")

    fused = rrf_fuse(candidate_lists)

    reranker_used = False
    if fused and use_rerank and "rerank" not in disable_stages:
        reranked, reranker_used = reranker.rerank(query_text, fused[:over_fetch])
        if reranker_used:
            fused = apply_rerank_threshold(reranked, rerank_min_score, rerank_floor)

    if "parents" not in disable_stages:
        fused = expand_to_parents(fused)

    fused = fused[:top_k]
    fused = trim_to_token_budget(fused, token_budget)

    return {
        "chunks": fused,
        "reranker_used": reranker_used,
        "collection_errors": collection_errors,
    }
