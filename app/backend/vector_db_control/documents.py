# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

"""Two-stage chunking pipeline for RAG ingestion.

Stage 1 (structure-aware): a document becomes *parent* sections — markdown/HTML
heading sections, PDF pages, or whole small files — capped at PARENT_CHUNK_SIZE.
Stage 2: each parent is split into small *child* chunks that get embedded. Only
children are stored; each carries its parent's clean text in metadata so
retrieval can return the wider section (small-to-big). Child text is prefixed
with a contextual header (document name, section, page) so chunks embed with
their provenance instead of as orphaned sentences.
"""

import hashlib
import os

from langchain_core.documents import Document

from .document_processor import LANGUAGE_BY_EXTENSION, DocumentProcessor

DEFAULT_CHUNK_SIZE = 750
DEFAULT_CHUNK_OVERLAP = 100
PARENT_CHUNK_SIZE = 4000
HEADER_TEMPLATE_VERSION = 1
PIPELINE_VERSION = 2


def _resolve_chunk_params(chunk_size, chunk_overlap):
    """Fill None params from Django settings, or module defaults outside Django."""
    if chunk_size is None or chunk_overlap is None:
        try:
            from django.conf import settings

            chunk_size = chunk_size if chunk_size is not None else settings.RAG_CHUNK_SIZE
            chunk_overlap = (
                chunk_overlap if chunk_overlap is not None else settings.RAG_CHUNK_OVERLAP
            )
        except Exception:
            chunk_size = chunk_size if chunk_size is not None else DEFAULT_CHUNK_SIZE
            chunk_overlap = (
                chunk_overlap if chunk_overlap is not None else DEFAULT_CHUNK_OVERLAP
            )
    return chunk_size, chunk_overlap


def _sha16(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def make_chunk_header(source: str, section: str = None, page=None) -> str:
    header = f"Document: {source}"
    if section:
        header += f" — Section: {section}"
    if page is not None:
        header += f" — Page {page}"
    return header


def deterministic_chunk_id(filename: str, index: int) -> str:
    """Stable per-file chunk id so re-uploading a file replaces its chunks."""
    return f"doc_{_sha16(filename)}_{index:05d}"


def parent_id_for(parent_text: str) -> str:
    return f"p_{_sha16(parent_text)}"


def chunking_fingerprint(chunk_size=None, chunk_overlap=None) -> str:
    """Identifies the chunking configuration; a change reseeds the internal corpus."""
    chunk_size, chunk_overlap = _resolve_chunk_params(chunk_size, chunk_overlap)
    return (
        f"pipe{PIPELINE_VERSION}-cs{chunk_size}-co{chunk_overlap}"
        f"-p{PARENT_CHUNK_SIZE}-h{HEADER_TEMPLATE_VERSION}"
    )


def _cap_parents(documents):
    """Split any oversized parent so parent_text stays within PARENT_CHUNK_SIZE."""
    capped = []
    for document in documents:
        if len(document.page_content) <= PARENT_CHUNK_SIZE:
            capped.append(document)
            continue
        pieces = DocumentProcessor.chunk_documents(
            [document], chunk_size=PARENT_CHUNK_SIZE, chunk_overlap=0
        )
        capped.extend(pieces)
    return capped


def _build_children(parents, chunk_size, chunk_overlap, language=None):
    """Stage 2: split parents into embedded child chunks with headers + lineage."""
    children = []
    chunk_index = 0
    for parent in parents:
        parent_text = parent.page_content
        meta = parent.metadata or {}
        source = meta.get("title") or meta.get("source") or ""
        section = meta.get("section")
        page = meta.get("page")
        header = make_chunk_header(source, section=section, page=page)
        pid = parent_id_for(parent_text)
        for child in DocumentProcessor.chunk_documents(
            [parent], chunk_size=chunk_size, chunk_overlap=chunk_overlap, language=language
        ):
            child_metadata = dict(child.metadata or {})
            child_metadata.update(
                {
                    "parent_id": pid,
                    "parent_text": parent_text,
                    "chunk_index": chunk_index,
                    "header_version": HEADER_TEMPLATE_VERSION,
                }
            )
            children.append(
                Document(
                    page_content=f"{header}\n\n{child.page_content}",
                    metadata=child_metadata,
                )
            )
            chunk_index += 1
    return children


def chunk_document(
    file_path: str,
    metadata: dict,
    chunk_size: int = None,
    chunk_overlap: int = None,
):
    """
    Process and chunk a document based on its file type.

    Args:
        file_path (str): Path to the document file
        metadata (dict): Metadata to attach to the document
        chunk_size (int): Size of each child chunk (None = settings default)
        chunk_overlap (int): Overlap between child chunks (None = settings default)

    Returns:
        List[Document]: Child chunks ready for embedding
    """
    chunk_size, chunk_overlap = _resolve_chunk_params(chunk_size, chunk_overlap)
    parents = DocumentProcessor.process_document(file_path, metadata)
    parents = _cap_parents(parents)
    extension = os.path.splitext(file_path)[1].lower()
    return _build_children(
        parents,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        language=LANGUAGE_BY_EXTENSION.get(extension),
    )


def chunk_texts(
    texts,
    metadatas=None,
    chunk_size: int = None,
    chunk_overlap: int = None,
):
    """
    Chunk a list of in-memory markdown strings (e.g. INTERNAL_KNOWLEDGE) into
    Documents ready for embedding. Without this, large documents are embedded
    whole and the embedding model silently truncates them, so only the first
    part is searchable.

    Args:
        texts (list[str]): Raw text documents to chunk.
        metadatas (list[dict] | None): Optional metadata per text, parallel to ``texts``.
        chunk_size (int): Size of each child chunk (None = settings default).
        chunk_overlap (int): Overlap between child chunks (None = settings default).

    Returns:
        List[Document]: Child chunks, each carrying its source text's metadata.
    """
    chunk_size, chunk_overlap = _resolve_chunk_params(chunk_size, chunk_overlap)
    parents = []
    for i, text in enumerate(texts):
        metadata = dict(metadatas[i]) if metadatas else {}
        parents.extend(DocumentProcessor.split_markdown_sections(text, metadata))
    parents = _cap_parents(parents)
    return _build_children(parents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
