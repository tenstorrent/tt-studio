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
