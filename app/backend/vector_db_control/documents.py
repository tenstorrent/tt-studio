# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from .document_processor import DocumentProcessor

def chunk_document(
    file_path: str,
    metadata: dict,
    chunk_size: int = 1000,
    chunk_overlap: int = 100
):
    """
    Process and chunk a document based on its file type.
    
    Args:
        file_path (str): Path to the document file
        metadata (dict): Metadata to attach to the document
        chunk_size (int): Size of each chunk
        chunk_overlap (int): Overlap between chunks
        
    Returns:
        List[Document]: List of chunked documents
    """
    # Process the document based on its type
    documents = DocumentProcessor.process_document(file_path, metadata)

    # Chunk the processed documents
    return DocumentProcessor.chunk_documents(
        documents,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap
    )


def chunk_texts(
    texts,
    metadatas=None,
    chunk_size: int = 1000,
    chunk_overlap: int = 100
):
    """
    Chunk a list of in-memory text strings (e.g. INTERNAL_KNOWLEDGE) into Documents
    ready for embedding. Without this, large documents are embedded whole and the
    embedding model silently truncates them, so only the first part is searchable.

    Args:
        texts (list[str]): Raw text documents to chunk.
        metadatas (list[dict] | None): Optional metadata per text, parallel to ``texts``.
        chunk_size (int): Size of each chunk.
        chunk_overlap (int): Overlap between chunks.

    Returns:
        List[Document]: Chunked documents, each carrying its source text's metadata.
    """
    documents = [
        Document(
            page_content=text,
            metadata=dict(metadatas[i]) if metadatas else {},
        )
        for i, text in enumerate(texts)
    ]
    return DocumentProcessor.chunk_documents(
        documents,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap
    )
