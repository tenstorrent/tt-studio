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


# Characters reserved for the title line prepended to every chunk.
_TITLE_BUDGET = 120
# Transient metadata key carrying a document's title through the splitter.
_TITLE_KEY = "_source_title"


def _document_title(text: str) -> str:
    """The document's own name — its first markdown heading, else its first line."""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            return line.lstrip("#").strip()[:_TITLE_BUDGET]
        # Scraped pages open with a "# Title" line, but fall back to the first
        # sentence-ish line for anything that doesn't.
        return line[:_TITLE_BUDGET]
    return ""


def _prepend_titles(chunks):
    """Stamp each chunk with the title of the document it came from.

    Without this, a chunk taken from the middle of a document carries no clue which
    product it describes. The TT-QuietBox 2 specification table is the motivating
    case: the chunk holding "128 GB GDDR6" began at "User-supplied: keyboard, mouse"
    and never said "QuietBox", so a question about QB2 memory retrieved a Wormhole
    card comparison table ("12 GB GDDR6 | 24 GB GDDR6") instead and the model
    answered with the wrong product's numbers.

    Only affects the in-memory corpus seeded by chunk_texts; uploaded files go
    through chunk_document.
    """
    for chunk in chunks:
        # Set per source document before splitting; the splitter copies metadata onto
        # every chunk it produces. Popped so it isn't stored in the vector DB.
        title = chunk.metadata.pop(_TITLE_KEY, "")
        if not title:
            continue
        # The first chunk of a document already opens with its heading.
        if title.lower() in chunk.page_content[: len(title) + 40].lower():
            continue
        chunk.page_content = f"{title}\n\n{chunk.page_content}"
    return chunks


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
    documents = []
    for i, text in enumerate(texts):
        metadata = dict(metadatas[i]) if metadatas else {}
        metadata[_TITLE_KEY] = _document_title(text)
        documents.append(Document(page_content=text, metadata=metadata))

    chunks = DocumentProcessor.chunk_documents(
        documents,
        # Leave room for the title line prepended below without pushing content past
        # the embedding model's input window.
        chunk_size=max(chunk_size - _TITLE_BUDGET, chunk_size // 2),
        chunk_overlap=chunk_overlap
    )
    return _prepend_titles(chunks)
