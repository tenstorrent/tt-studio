# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Query rewriting for retrieval, using the deployed LLM.

Chat queries like "how do I configure it?" embed poorly — the pronoun only
resolves in conversation context. When RAG_QUERY_REWRITE is enabled and a chat
model is deployed, the query is rewritten into a self-contained search query
before retrieval. Every failure path falls back to the original query.
"""

import requests
from django.conf import settings

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_REWRITE_TIMEOUT = (3, 10)  # (connect, read) seconds
_MAX_HISTORY_TURNS = 6
_MAX_REWRITE_CHARS = 512

_SYSTEM_PROMPT = (
    "Rewrite the user's last message as a single self-contained search query. "
    "Resolve pronouns and references using the conversation. "
    "Reply with ONLY the rewritten query, nothing else."
)


def build_rewrite_messages(query_text: str, history: list) -> list:
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for turn in history[-_MAX_HISTORY_TURNS:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)})
    messages.append({"role": "user", "content": query_text})
    return messages


def _pick_chat_deploy(deploy_cache: dict):
    for deploy in deploy_cache.values():
        if not deploy.get("internal_url"):
            continue
        model_impl = deploy.get("model_impl")
        if getattr(model_impl, "service_route", None) == "/v1/chat/completions":
            return deploy
    return None


def maybe_rewrite_query(query_text: str, history: list | None) -> tuple[str, bool]:
    """Return (effective_query, was_rewritten); never raises."""
    if not settings.RAG_QUERY_REWRITE or not history or not query_text.strip():
        return query_text, False
    try:
        # Imported lazily: model_control pulls in docker_control at module load,
        # which must not happen while vector_db_control is being initialized.
        from model_control.model_utils import (
            get_deploy_cache,
            get_model_name_from_container,
            token_for,
        )

        deploy = _pick_chat_deploy(get_deploy_cache())
        if deploy is None:
            return query_text, False

        token = token_for(deploy.get("jwt_secret"))
        model_name = deploy.get("cached_model_name") or get_model_name_from_container(
            deploy["internal_url"],
            fallback=deploy["model_impl"].hf_model_id,
            auth_token=token,
        )
        response = requests.post(
            f"http://{deploy['internal_url']}",
            json={
                "model": model_name,
                "messages": build_rewrite_messages(query_text, history),
                "max_tokens": 64,
                "temperature": 0,
                "stream": False,
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=_REWRITE_TIMEOUT,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        rewritten = content.strip("\"'").splitlines()[0].strip() if content else ""
        if not rewritten or len(rewritten) > _MAX_REWRITE_CHARS:
            return query_text, False
        logger.info(f"Rewrote RAG query: {query_text!r} -> {rewritten!r}")
        return rewritten, True
    except Exception as e:
        logger.warning(f"Query rewrite failed, using original query: {e}")
        return query_text, False
