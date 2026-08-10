# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for the pure retrieval-pipeline helpers (no Chroma, no network)."""

from rank_bm25 import BM25Okapi

from vector_db_control.lexical import tokenize
from vector_db_control.retrieval import (
    RetrievedChunk,
    apply_rerank_threshold,
    approx_token_count,
    dense_result_to_chunks,
    expand_to_parents,
    filter_by_distance,
    rrf_fuse,
    trim_to_token_budget,
)
from vector_db_control.rewrite import build_rewrite_messages


def make_chunk(chunk_id, collection="c", **kwargs):
    defaults = {"text": f"text {chunk_id}", "metadata": {}}
    defaults.update(kwargs)
    return RetrievedChunk(id=chunk_id, collection=collection, **defaults)


class TestRrfFuse:
    def test_orders_by_reciprocal_rank(self):
        # "both" is ranked first in two lists; the others lead only one list.
        dense = [
            make_chunk("both", dense_rank=1),
            make_chunk("dense-only", dense_rank=2),
        ]
        lexical = [
            make_chunk("both", lexical_rank=1),
            make_chunk("lex-only", lexical_rank=2),
        ]
        fused = rrf_fuse([dense, lexical])
        assert fused[0].id == "both"
        assert {c.id for c in fused} == {"both", "dense-only", "lex-only"}

    def test_dedupes_and_merges_signals(self):
        dense = [make_chunk("x", dense_rank=1, distance=0.3)]
        lexical = [make_chunk("other", lexical_rank=1), make_chunk("x", lexical_rank=2)]
        fused = rrf_fuse([dense, lexical], k=60)
        assert len(fused) == 2
        merged = next(c for c in fused if c.id == "x")
        assert merged.dense_rank == 1
        assert merged.lexical_rank == 2
        assert merged.distance == 0.3
        assert merged.rrf_score == (1 / 61) + (1 / 62)

    def test_same_id_in_different_collections_stays_separate(self):
        fused = rrf_fuse(
            [[make_chunk("x", collection="a"), make_chunk("x", collection="b")]]
        )
        assert len(fused) == 2


class TestFilterByDistance:
    def test_drops_far_dense_hits(self):
        chunks = [make_chunk("near", distance=0.2), make_chunk("far", distance=1.5)]
        assert [c.id for c in filter_by_distance(chunks, 1.0)] == ["near"]

    def test_keeps_lexical_only_chunks(self):
        chunks = [make_chunk("lex", distance=None), make_chunk("far", distance=1.5)]
        assert [c.id for c in filter_by_distance(chunks, 1.0)] == ["lex"]

    def test_none_threshold_keeps_everything(self):
        chunks = [make_chunk("far", distance=9.9)]
        assert filter_by_distance(chunks, None) == chunks


class TestExpandToParents:
    def test_children_of_same_parent_collapse_to_best(self):
        best = make_chunk(
            "c1",
            metadata={"parent_id": "p1", "parent_text": "PARENT"},
            rerank_score=0.9,
        )
        worse = make_chunk(
            "c2",
            metadata={"parent_id": "p1", "parent_text": "PARENT"},
            rerank_score=0.5,
        )
        expanded = expand_to_parents([best, worse])
        assert len(expanded) == 1
        assert expanded[0].id == "c1"
        assert expanded[0].text == "PARENT"

    def test_legacy_chunks_pass_through(self):
        legacy = make_chunk("old", metadata=None, text="original")
        expanded = expand_to_parents([legacy])
        assert expanded[0].text == "original"

    def test_distinct_parents_all_survive(self):
        chunks = [
            make_chunk("a", metadata={"parent_id": "p1", "parent_text": "P1"}),
            make_chunk("b", metadata={"parent_id": "p2", "parent_text": "P2"}),
        ]
        assert len(expand_to_parents(chunks)) == 2


class TestApplyRerankThreshold:
    def make_ranked(self, *scores):
        # apply_rerank_threshold expects reranker.rerank's descending order.
        return [
            make_chunk(str(i), rerank_score=s)
            for i, s in enumerate(sorted(scores, reverse=True))
        ]

    def test_drops_below_threshold_when_enough_pass(self):
        ranked = self.make_ranked(0.9, 0.8, 0.01)
        kept = apply_rerank_threshold(ranked, min_score=0.05, floor=2)
        assert [c.rerank_score for c in kept] == [0.9, 0.8]

    def test_backfills_to_floor_when_all_score_low(self):
        ranked = self.make_ranked(0.04, 0.03, 0.01)
        kept = apply_rerank_threshold(ranked, min_score=0.05, floor=2)
        assert [c.rerank_score for c in kept] == [0.04, 0.03]

    def test_floor_larger_than_candidates_keeps_everything(self):
        ranked = self.make_ranked(0.01)
        assert len(apply_rerank_threshold(ranked, min_score=0.05, floor=3)) == 1

    def test_survivors_above_floor_are_untouched(self):
        ranked = self.make_ranked(0.9, 0.8, 0.7)
        assert len(apply_rerank_threshold(ranked, min_score=0.05, floor=1)) == 3


class TestTokenBudget:
    def test_approx_token_count(self):
        assert approx_token_count("abcd" * 10) == 10
        assert approx_token_count("") == 1

    def test_trim_respects_budget(self):
        chunks = [
            make_chunk(str(i), text="a" * 400) for i in range(10)
        ]  # 100 tokens each
        assert len(trim_to_token_budget(chunks, 250)) == 2

    def test_trim_keeps_at_least_one_chunk(self):
        oversized = [make_chunk("big", text="a" * 40000)]
        assert len(trim_to_token_budget(oversized, 10)) == 1


class TestDenseResultToChunks:
    def test_unwraps_chroma_shape(self):
        result = {
            "ids": [["i1", "i2"]],
            "documents": [["d1", "d2"]],
            "metadatas": [[{"source": "f.md"}, None]],
            "distances": [[0.1, 0.2]],
        }
        chunks = dense_result_to_chunks(result, "mycoll")
        assert [c.id for c in chunks] == ["i1", "i2"]
        assert chunks[0].dense_rank == 1
        assert chunks[0].source == "f.md"
        assert chunks[1].distance == 0.2
        assert all(c.collection == "mycoll" for c in chunks)

    def test_empty_result(self):
        assert dense_result_to_chunks({}, "c") == []


class TestLexical:
    def test_tokenize_lowercases_and_splits_punctuation(self):
        assert tokenize("HF_TOKEN=abc, n150!") == ["hf", "token", "abc", "n150"]

    def test_bm25_ranks_exact_term_match_first(self):
        corpus = [
            "the n150 board needs a firmware update",
            "general overview of tenstorrent products",
            "how to bake bread at home",
        ]
        bm25 = BM25Okapi([tokenize(t) for t in corpus])
        scores = bm25.get_scores(tokenize("n150 firmware"))
        assert scores.argmax() == 0


class TestBuildRewriteMessages:
    def test_truncates_history_and_sets_system_prompt(self):
        history = [{"role": "user", "content": f"turn {i}"} for i in range(10)]
        messages = build_rewrite_messages("how do I configure it?", history)
        assert messages[0]["role"] == "system"
        # 1 system + 6 history + 1 final user turn
        assert len(messages) == 8
        assert messages[1]["content"] == "turn 4"
        assert messages[-1] == {"role": "user", "content": "how do I configure it?"}

    def test_skips_malformed_turns(self):
        history = [
            {"role": "tool", "content": "x"},
            {"role": "user"},
            {"role": "user", "content": "hi"},
        ]
        messages = build_rewrite_messages("q", history)
        assert len(messages) == 3  # system + "hi" + final
