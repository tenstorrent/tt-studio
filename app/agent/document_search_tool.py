# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""LangChain tool that searches Tenstorrent documentation via the backend.

Calls the backend's /collections/retrieve endpoint (hybrid dense + BM25 with
reranking) over the shared docker network. It queries only the shared
tenstorrent_internal_knowledge collection: the agent request path carries no
browser identity, and that collection is the one visible to every session.
"""

from typing import Type

import requests
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

try:
    from .config import AgentConfig
except ImportError:
    from config import AgentConfig

INTERNAL_KNOWLEDGE_COLLECTION = "tenstorrent_internal_knowledge"
_MAX_DOCS = 3
_MAX_DOC_CHARS = 800
_TIMEOUT = (3, 20)

DOC_SEARCH_DESCRIPTION = (
    "Search Tenstorrent's internal documentation: TT-Studio, tt-metal, "
    "tt-inference-server, QuietBox and Blackhole hardware, and Tenstorrent "
    "products. Use this FIRST for any question about Tenstorrent software, "
    "hardware, or how to use them. Input should be a focused search query."
)


class _DocumentSearchInput(BaseModel):
    query: str = Field(description="Question to look up in Tenstorrent documentation")


class DocumentSearchTool(BaseTool):
    name: str = "document_search"
    description: str = DOC_SEARCH_DESCRIPTION
    args_schema: Type[BaseModel] = _DocumentSearchInput

    def _run(self, query: str, **kwargs) -> str:
        try:
            response = requests.post(
                f"{AgentConfig.BACKEND_URL}/collections/retrieve",
                json={
                    "query_text": query,
                    "collection": INTERNAL_KNOWLEDGE_COLLECTION,
                },
                timeout=_TIMEOUT,
            )
            response.raise_for_status()
            documents = response.json().get("documents") or []
        except Exception as e:
            # Never raise: the model should fall back to web search or its own
            # knowledge instead of aborting the whole agent run.
            return (
                f"Document search is unavailable ({e}). Answer from your own "
                "knowledge or use web search instead."
            )
        if not documents:
            return (
                "No relevant documentation found. Answer from your own knowledge "
                "or use web search instead."
            )
        trimmed = [
            doc[:_MAX_DOC_CHARS] + ("…" if len(doc) > _MAX_DOC_CHARS else "")
            for doc in documents[:_MAX_DOCS]
            if isinstance(doc, str)
        ]
        return "\n\n---\n\n".join(trimmed)

    async def _arun(self, query: str, **kwargs) -> str:
        return self._run(query, **kwargs)
