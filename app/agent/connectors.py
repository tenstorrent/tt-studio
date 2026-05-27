# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Per-request Composio tool loading for the agent.

The agent service receives `session_id` + `enabled_connectors` in the
request payload (forwarded by Django from the chat UI). We look up the
corresponding LangChain tools from Composio scoped to that user and
merge them into the base toolset.

Toolkit slugs (e.g. "NOTION") match what the backend Django app
publishes in `connectors_control/catalog.py`.
"""

import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

# Map chat-UI provider slugs to Composio toolkit slugs. Keep in sync with
# app/backend/connectors_control/catalog.py.
_PROVIDER_TO_TOOLKIT = {
    "notion": "NOTION",
}

_PLACEHOLDER_KEYS = {
    "",
    "composio-api-key-not-configured",
    "your-composio-api-key",
}


def _api_key_configured() -> bool:
    return os.environ.get("COMPOSIO_API_KEY", "").strip() not in _PLACEHOLDER_KEYS


@lru_cache(maxsize=1)
def _composio_client():
    """Lazy-build a Composio client wired to the LangChain provider.

    Cached because the client maintains its own httpx connection pool.
    """
    from composio import Composio
    from composio_langchain import LangchainProvider
    return Composio(provider=LangchainProvider())


def get_composio_tools(session_id: str | None, providers: list[str] | None) -> list:
    """Return LangChain tools for the given session's enabled connectors.

    Always returns a list (possibly empty). Never raises — connector failures
    must not break chat. The base tools (Tavily/E2B) keep working.
    """
    if not session_id or not providers:
        return []
    if not _api_key_configured():
        logger.warning("COMPOSIO_API_KEY not configured; skipping connector tools")
        return []

    toolkits = [
        _PROVIDER_TO_TOOLKIT[p] for p in providers if p in _PROVIDER_TO_TOOLKIT
    ]
    if not toolkits:
        return []

    try:
        client = _composio_client()
        tools = client.tools.get(user_id=session_id, toolkits=toolkits)
    except Exception as e:
        logger.exception("Composio tool fetch failed for session=%s: %s", session_id, e)
        return []

    if isinstance(tools, list):
        return tools
    try:
        return list(tools)
    except TypeError:
        return []
