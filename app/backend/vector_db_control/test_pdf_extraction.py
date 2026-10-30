# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""PDF text extraction regression test against a committed two-page fixture.

The fixture (test_data/two_page_sample.pdf) was generated once with reportlab.
Text comparisons collapse whitespace so they hold across pypdf versions, which
differ in how they place spaces and line breaks in extracted text.
"""

import re
from pathlib import Path

import pypdf

from vector_db_control.document_processor import DocumentProcessor

FIXTURE = Path(__file__).parent / "test_data" / "two_page_sample.pdf"

PAGE_TEXT = {
    1: [
        "Getting Started",
        "This sample document has two pages of plain text.",
        "Upload it to a collection to try retrieval.",
        "The quick brown fox jumps over the lazy dog.",
    ],
    2: [
        "Configuration",
        "Set the chunk size before indexing documents.",
        "Each page becomes one document with a page number.",
        "Version 2.0 supports Markdown, HTML and PDF files.",
    ],
}


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


class TestProcessPdfFixture:
    def test_fixture_is_two_pages(self):
        reader = pypdf.PdfReader(str(FIXTURE))
        assert len(reader.pages) == 2
        assert reader.metadata.title == "TT-Studio Sample Document"

    def test_one_document_per_page_with_metadata(self):
        docs = DocumentProcessor.process_pdf(
            str(FIXTURE), {"source": "two_page_sample.pdf", "collection": "c"}
        )
        assert len(docs) == 2
        assert [d.metadata["page"] for d in docs] == [1, 2]
        for doc in docs:
            assert doc.metadata["source"] == "two_page_sample.pdf"
            assert doc.metadata["collection"] == "c"

    def test_input_metadata_is_not_mutated(self):
        metadata = {"source": "two_page_sample.pdf"}
        DocumentProcessor.process_pdf(str(FIXTURE), metadata)
        assert metadata == {"source": "two_page_sample.pdf"}

    def test_expected_text_on_each_page(self):
        docs = DocumentProcessor.process_pdf(str(FIXTURE), {"source": "s.pdf"})
        by_page = {d.metadata["page"]: normalize(d.page_content) for d in docs}
        for page, lines in PAGE_TEXT.items():
            for line in lines:
                assert normalize(line) in by_page[page], (page, line)

    def test_text_stays_on_its_own_page(self):
        docs = DocumentProcessor.process_pdf(str(FIXTURE), {"source": "s.pdf"})
        by_page = {d.metadata["page"]: normalize(d.page_content) for d in docs}
        assert "Configuration" not in by_page[1]
        assert "Getting Started" not in by_page[2]

    def test_process_document_routes_pdf(self):
        docs = DocumentProcessor.process_document(str(FIXTURE), {"source": "s.pdf"})
        assert [d.metadata["page"] for d in docs] == [1, 2]
