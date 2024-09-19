# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter


def chunk_pdf_document(loaded_document, extraction_mode="plain", chunk_size=1000, chunk_overlap=100):
    loaded_documents = []
    metadata = loaded_document.metadata
    for page in loaded_document.pages:
        loaded_documents.append(
            Document(page_content=page.extract_text(extraction_mode=extraction_mode), metadata=metadata))
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    chunked_document = text_splitter.split_documents(loaded_documents)
    return chunked_document
