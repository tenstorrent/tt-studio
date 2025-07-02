# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
import mimetypes
from typing import List, Optional, Dict, Any
import pypdf
import docx
import markdown
from bs4 import BeautifulSoup
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from shared_config.logger_config import get_logger

logger = get_logger(__name__)

class DocumentProcessor:
    SUPPORTED_EXTENSIONS = {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.md': 'text/markdown',
        '.html': 'text/html',
        '.py': 'text/x-python',
        '.js': 'application/javascript',
        '.ts': 'application/typescript',
        '.tsx': 'application/typescript',
        '.jsx': 'application/javascript',
    }

    @staticmethod
    def get_file_type(file_path: str) -> Optional[str]:
        """Detect file type based on extension and mime type."""
        ext = os.path.splitext(file_path)[1].lower()
        if ext in DocumentProcessor.SUPPORTED_EXTENSIONS:
            return DocumentProcessor.SUPPORTED_EXTENSIONS[ext]
        return None

    @staticmethod
    def process_pdf(file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process PDF files."""
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = pypdf.PdfReader(file)
                documents = []
                for page in pdf_reader.pages:
                    documents.append(
                        Document(
                            page_content=page.extract_text(),
                            metadata=metadata
                        )
                    )
                return documents
        except Exception as e:
            logger.error(f"Error processing PDF file {file_path}: {str(e)}")
            raise

    @staticmethod
    def process_text(file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process text files."""
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                content = file.read()
                return [Document(page_content=content, metadata=metadata)]
        except UnicodeDecodeError:
            # Try with different encoding if UTF-8 fails
            with open(file_path, 'r', encoding='latin-1') as file:
                content = file.read()
                return [Document(page_content=content, metadata=metadata)]

    @staticmethod
    def process_docx(file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process Word documents."""
        try:
            doc = docx.Document(file_path)
            content = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
            return [Document(page_content=content, metadata=metadata)]
        except Exception as e:
            logger.error(f"Error processing DOCX file {file_path}: {str(e)}")
            raise

    @staticmethod
    def process_markdown(file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process Markdown files."""
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                content = file.read()
                # Convert markdown to plain text
                html = markdown.markdown(content)
                soup = BeautifulSoup(html, 'html.parser')
                text = soup.get_text()
                return [Document(page_content=text, metadata=metadata)]
        except Exception as e:
            logger.error(f"Error processing Markdown file {file_path}: {str(e)}")
            raise

    @staticmethod
    def process_html(file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process HTML files."""
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                content = file.read()
                soup = BeautifulSoup(content, 'html.parser')
                # Remove script and style elements
                for script in soup(["script", "style"]):
                    script.decompose()
                text = soup.get_text(separator='\n')
                return [Document(page_content=text, metadata=metadata)]
        except Exception as e:
            logger.error(f"Error processing HTML file {file_path}: {str(e)}")
            raise

    @staticmethod
    def process_code(file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process code files."""
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                content = file.read()
                return [Document(page_content=content, metadata=metadata)]
        except Exception as e:
            logger.error(f"Error processing code file {file_path}: {str(e)}")
            raise

    @classmethod
    def process_document(cls, file_path: str, metadata: Dict[str, Any]) -> List[Document]:
        """Process document based on file type."""
        file_type = cls.get_file_type(file_path)
        if not file_type:
            raise ValueError(f"Unsupported file type: {file_path}")

        processors = {
            'application/pdf': cls.process_pdf,
            'text/plain': cls.process_text,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': cls.process_docx,
            'text/markdown': cls.process_markdown,
            'text/html': cls.process_html,
        }

        # Handle code files
        if file_type.startswith('text/x-') or file_type.startswith('application/'):
            if file_type in ['application/javascript', 'application/typescript']:
                return cls.process_code(file_path, metadata)

        if file_type not in processors:
            raise ValueError(f"No processor available for file type: {file_type}")

        return processors[file_type](file_path, metadata)

    @staticmethod
    def chunk_documents(documents: List[Document], chunk_size: int = 1000, chunk_overlap: int = 100) -> List[Document]:
        """Split documents into chunks."""
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )
        return text_splitter.split_documents(documents) 