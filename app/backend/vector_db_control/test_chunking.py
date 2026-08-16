# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for the two-stage chunking pipeline (explicit sizes, no Django)."""

import re

from langchain_core.documents import Document

from vector_db_control.data import document_title
from vector_db_control.document_processor import DocumentProcessor
from vector_db_control.documents import (
    PARENT_CHUNK_SIZE,
    _build_children,
    _cap_parents,
    chunk_texts,
    chunking_fingerprint,
    deterministic_chunk_id,
    make_chunk_header,
    parent_id_for,
)

MD_DOC = """# Guide

Intro paragraph.

## Setup

Install the package and set HF_TOKEN.

### Details

Run the server on port 8000.
"""


class TestMarkdownSections:
    def test_sections_carry_heading_path(self):
        parents = DocumentProcessor.split_markdown_sections(MD_DOC, {"source": "g.md"})
        sections = [p.metadata.get("section") for p in parents]
        assert "Guide" in sections
        assert "Guide > Setup" in sections
        assert "Guide > Setup > Details" in sections
        assert all("h1" not in p.metadata for p in parents)

    def test_children_inherit_section_in_header(self):
        chunks = chunk_texts(
            [MD_DOC], metadatas=[{"source": "g.md"}], chunk_size=200, chunk_overlap=0
        )
        setup_chunks = [
            c for c in chunks if c.metadata.get("section") == "Guide > Setup"
        ]
        assert setup_chunks
        assert setup_chunks[0].page_content.startswith(
            "Document: g.md — Section: Guide > Setup"
        )


class TestCodeSplitting:
    def test_functions_stay_intact(self):
        code = "def alpha():\n    return 1\n\n\ndef beta():\n    return 2\n"
        doc = Document(page_content=code, metadata={})
        from langchain_text_splitters import Language

        chunks = DocumentProcessor.chunk_documents(
            [doc], chunk_size=40, chunk_overlap=0, language=Language.PYTHON
        )
        assert len(chunks) == 2
        assert chunks[0].page_content.startswith("def alpha")
        assert chunks[1].page_content.startswith("def beta")


class TestPdfPages:
    def test_pages_get_distinct_metadata_with_page_numbers(self):
        docs = DocumentProcessor.pages_to_documents(
            ["page one text", "", "page three text"], {"source": "x.pdf"}
        )
        assert [d.metadata["page"] for d in docs] == [1, 3]
        assert docs[0].metadata is not docs[1].metadata
        assert all(d.metadata["source"] == "x.pdf" for d in docs)


class TestIdsAndHeaders:
    def test_deterministic_chunk_id_stable_and_distinct(self):
        assert deterministic_chunk_id("a.pdf", 0) == deterministic_chunk_id("a.pdf", 0)
        assert deterministic_chunk_id("a.pdf", 0) != deterministic_chunk_id("a.pdf", 1)
        assert deterministic_chunk_id("a.pdf", 0) != deterministic_chunk_id("b.pdf", 0)
        assert re.fullmatch(
            r"doc_[0-9a-f]{16}_\d{5}", deterministic_chunk_id("a.pdf", 3)
        )

    def test_make_chunk_header_combinations(self):
        assert make_chunk_header("f.md") == "Document: f.md"
        assert (
            make_chunk_header("f.md", section="A > B")
            == "Document: f.md — Section: A > B"
        )
        assert make_chunk_header("f.pdf", page=2) == "Document: f.pdf — Page 2"
        assert (
            make_chunk_header("f.pdf", section="A", page=2)
            == "Document: f.pdf — Section: A — Page 2"
        )

    def test_parent_id_stable_and_content_sensitive(self):
        assert parent_id_for("abc") == parent_id_for("abc")
        assert parent_id_for("abc") != parent_id_for("abd")
        assert parent_id_for("abc").startswith("p_")

    def test_fingerprint_changes_with_params(self):
        assert chunking_fingerprint(750, 100) != chunking_fingerprint(1000, 100)
        assert chunking_fingerprint(750, 100) == chunking_fingerprint(750, 100)


class TestParentChildPipeline:
    def test_oversized_sections_are_capped(self):
        big = Document(page_content="word " * 3000, metadata={"source": "big.txt"})
        parents = _cap_parents([big])
        assert len(parents) >= 3
        assert all(len(p.page_content) <= PARENT_CHUNK_SIZE for p in parents)

    def test_children_carry_parent_lineage(self):
        parent = Document(
            page_content="alpha beta gamma. " * 30, metadata={"source": "notes.txt"}
        )
        children = _build_children([parent], chunk_size=120, chunk_overlap=0)
        assert len(children) > 1
        for i, child in enumerate(children):
            assert child.metadata["parent_id"] == parent_id_for(parent.page_content)
            assert child.metadata["parent_text"] == parent.page_content
            assert child.metadata["chunk_index"] == i
            assert child.page_content.startswith("Document: notes.txt\n\n")

    def test_all_parent_texts_within_cap(self):
        chunks = chunk_texts(
            ["x" * 15000],
            metadatas=[{"source": "big.md"}],
            chunk_size=400,
            chunk_overlap=50,
        )
        assert chunks
        assert all(len(c.metadata["parent_text"]) <= PARENT_CHUNK_SIZE for c in chunks)


class TestDocumentTitle:
    def test_prefers_h1(self):
        assert document_title("# TT-Metal Guide\n\nbody") == "TT-Metal Guide"

    def test_falls_back_to_first_line(self):
        assert document_title("plain opener line\nmore") == "plain opener line"

    def test_empty_doc(self):
        assert document_title("") == "Tenstorrent documentation"
