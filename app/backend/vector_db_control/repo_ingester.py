# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import os
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

DEFAULT_INCLUDE_EXTENSIONS = [".md", ".html", ".txt", ".rst"]
DEFAULT_EXCLUDE_DIRS = {
    ".cache",
    ".git",
    ".github",
    ".next",
    "__pycache__",
    "_site",
    "build",
    "dist",
    "node_modules",
    "vendor",
}
MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024  # 1 MB per file

# Module-level status registry keyed by collection_name.
# Populated by RepoIngester.ingest_all() before the thread starts so the
# status endpoint can return "pending" entries immediately.
INGESTION_STATUS: Dict[str, Dict[str, Any]] = {}


class RepoIngester:
    def __init__(self, embed_model: str):
        self.embed_model = embed_model

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def ingest_all(self, repo_configs: List[Dict]) -> None:
        """Register all repos as pending then start a single background daemon thread."""
        for config in repo_configs:
            name = config["collection_name"]
            INGESTION_STATUS[name] = {
                "collection_name": name,
                "url": config["url"],
                "description": config.get("description", ""),
                "status": "pending",
                "error": None,
                "doc_count": 0,
            }
        threading.Thread(target=self._run, args=(repo_configs,), daemon=True).start()

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _run(self, repo_configs: List[Dict]) -> None:
        # Lazy imports so Django app registry is fully ready
        from vector_db_control.chroma import (
            create_collection,
            get_collection,
            insert_to_chroma_collection,
            list_collections,
        )
        from vector_db_control.document_processor import DocumentProcessor

        for config in repo_configs:
            collection_name = config["collection_name"]
            try:
                # Idempotency: skip if collection already exists in ChromaDB
                existing_names = [c.name for c in list_collections()]
                if collection_name in existing_names:
                    logger.info(
                        f"[RepoIngester] '{collection_name}' already exists – skipping."
                    )
                    try:
                        col = get_collection(collection_name, self.embed_model)
                        doc_count = col.count()
                    except Exception:
                        doc_count = 0
                    INGESTION_STATUS[collection_name].update(
                        status="ready", doc_count=doc_count
                    )
                    continue

                INGESTION_STATUS[collection_name]["status"] = "building"
                logger.info(
                    f"[RepoIngester] Building '{collection_name}' from {config['url']}"
                )

                with tempfile.TemporaryDirectory() as tmpdir:
                    self._clone(config["url"], config.get("branch", "main"), tmpdir)

                    include_exts = set(
                        config.get("include_extensions", DEFAULT_INCLUDE_EXTENSIONS)
                    )
                    exclude_dirs = DEFAULT_EXCLUDE_DIRS | set(
                        config.get("exclude_dirs", [])
                    )
                    files = self._walk(tmpdir, include_exts, exclude_dirs)
                    logger.info(
                        f"[RepoIngester] {len(files)} file(s) found for '{collection_name}'"
                    )

                    chunks, ids, metadatas = self._process_files(
                        files, tmpdir, collection_name, DocumentProcessor
                    )

                    if not chunks:
                        logger.warning(
                            f"[RepoIngester] No content produced for '{collection_name}'"
                        )
                        INGESTION_STATUS[collection_name].update(
                            status="ready", doc_count=0
                        )
                        continue

                    create_collection(
                        collection_name=collection_name,
                        embedding_func_name=self.embed_model,
                        metadata={
                            "type": "repo_knowledge",
                            "description": config.get("description", ""),
                            "source_url": config["url"],
                            "created_by": "system",
                        },
                    )
                    insert_to_chroma_collection(
                        collection_name=collection_name,
                        embedding_func_name=self.embed_model,
                        ids=ids,
                        documents=chunks,
                        metadatas=metadatas,
                    )
                    INGESTION_STATUS[collection_name].update(
                        status="ready", doc_count=len(chunks)
                    )
                    logger.info(
                        f"[RepoIngester] Done: '{collection_name}' – {len(chunks)} chunk(s) ingested."
                    )

            except Exception as exc:
                logger.error(
                    f"[RepoIngester] Failed to ingest '{collection_name}': {exc}",
                    exc_info=True,
                )
                INGESTION_STATUS[collection_name].update(
                    status="failed", error=str(exc)
                )

    def _clone(self, url: str, branch: str, dest: str) -> None:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", branch, url, dest],
            capture_output=True,
            timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError(f"git clone failed:\n{result.stderr.decode()}")

    def _walk(
        self, repo_dir: str, include_exts: set, exclude_dirs: set
    ) -> List[str]:
        files: List[str] = []
        for root, dirs, filenames in os.walk(repo_dir):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for fname in filenames:
                if os.path.splitext(fname)[1].lower() in include_exts:
                    fpath = os.path.join(root, fname)
                    try:
                        if os.path.getsize(fpath) <= MAX_FILE_SIZE_BYTES:
                            files.append(fpath)
                    except OSError:
                        pass
        return files

    def _process_files(
        self,
        files: List[str],
        repo_dir: str,
        collection_name: str,
        DocumentProcessor,
    ):
        all_chunks: List[str] = []
        all_ids: List[str] = []
        all_metadatas: List[Dict] = []

        for fpath in files:
            rel_path = os.path.relpath(fpath, repo_dir)
            metadata = {
                "source": rel_path,
                "type": "repo_knowledge",
                "collection": collection_name,
                "upload_date": datetime.now().isoformat(),
            }
            try:
                docs = DocumentProcessor.process_document(fpath, metadata)
                chunks = DocumentProcessor.chunk_documents(docs)
                for chunk in chunks:
                    all_chunks.append(chunk.page_content)
                    all_ids.append(uuid.uuid4().hex)
                    all_metadatas.append(chunk.metadata)
            except Exception as exc:
                logger.warning(f"[RepoIngester] Skipping {rel_path}: {exc}")

        return all_chunks, all_ids, all_metadatas


def load_preinstall_config() -> List[Dict]:
    """Load preinstall_repos.json from the same directory as this module."""
    config_path = os.path.join(os.path.dirname(__file__), "preinstall_repos.json")
    if not os.path.exists(config_path):
        logger.info(
            "[RepoIngester] preinstall_repos.json not found – skipping repo ingestion."
        )
        return []
    try:
        with open(config_path) as fh:
            configs = json.load(fh)
        logger.info(f"[RepoIngester] Loaded {len(configs)} repo config(s).")
        return configs
    except Exception as exc:
        logger.error(f"[RepoIngester] Failed to load preinstall_repos.json: {exc}")
        return []
