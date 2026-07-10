# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Node handler functions for workflow execution.

Each handler is an async generator that:
  1. Receives the node's config dict and a dict of upstream inputs.
  2. Yields SSE event dicts (type, node_id, payload) for live progress.
  3. Returns the node's final output text via a final ``node_done`` event.
"""

import json
import uuid
from typing import AsyncGenerator

import httpx
from django.conf import settings

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# Reuse the connection-pooled httpx client from model_control when available,
# otherwise create a lightweight one for the workflow executor.
try:
    from model_control.model_utils import _vllm_client, encoded_jwt
except ImportError:
    _vllm_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
    )
    encoded_jwt = ""


def _sse(event_type: str, node_id: str, data: dict | str) -> dict:
    """Build a uniform SSE event envelope."""
    return {"event": event_type, "node_id": node_id, "data": data}


# ---------------------------------------------------------------------------
# Input Node
# ---------------------------------------------------------------------------

async def handle_input(
    node_id: str, config: dict, inputs: dict, run_id: str
) -> AsyncGenerator[dict, None]:
    """Pass-through node that emits the user's initial input text."""
    text = config.get("text", "") or inputs.get("__initial_input__", "")
    yield _sse("node_done", node_id, {"output": text})


# ---------------------------------------------------------------------------
# Output Node
# ---------------------------------------------------------------------------

async def handle_output(
    node_id: str, config: dict, inputs: dict, run_id: str
) -> AsyncGenerator[dict, None]:
    """Terminal node -- collects the first upstream input as the workflow result."""
    upstream_values = list(inputs.values())
    result = upstream_values[0] if upstream_values else ""
    yield _sse("node_done", node_id, {"output": result})


# ---------------------------------------------------------------------------
# LLM Node
# ---------------------------------------------------------------------------

async def handle_llm(
    node_id: str, config: dict, inputs: dict, run_id: str
) -> AsyncGenerator[dict, None]:
    """
    Call a deployed chat model via the same vLLM streaming path used by
    ``model_control.model_utils.stream_response_from_external_api``.
    """
    from model_control.model_utils import get_deploy_cache
    from shared_config.model_type_config import ModelTypes

    deploy_id = config.get("deploy_id", "")
    prompt_template = config.get("prompt_template", "{input}")
    temperature = config.get("temperature", 0.7)
    max_tokens = config.get("max_tokens", 1024)

    upstream_text = " ".join(str(v) for v in inputs.values())
    user_content = prompt_template.replace("{input}", upstream_text)

    deploy_cache = get_deploy_cache()
    entry = deploy_cache.get(deploy_id)
    if not entry:
        for _cid, e in deploy_cache.items():
            impl = e.get("model_impl")
            model_type = getattr(impl, "model_type", None)
            if e.get("status") == "running" and model_type == ModelTypes.CHAT:
                entry = e
                break
    if not entry:
        yield _sse("node_error", node_id, {"error": "No deployed chat model found"})
        return

    internal_url = entry.get("internal_url", "")
    url = f"http://{internal_url}"

    model_impl = entry.get("model_impl")
    fallback_name = getattr(model_impl, "hf_model_id", "default") if model_impl else "default"
    model_name = entry.get("cached_model_name", fallback_name)

    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": user_content}],
        "stream": True,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    headers = {"Authorization": f"Bearer {encoded_jwt}"}

    assembled = []
    try:
        async with _vllm_client.stream("POST", url, json=payload, headers=headers) as response:
            response.raise_for_status()
            async for chunk in response.aiter_text():
                for line in chunk.split("\n"):
                    line = line.strip()
                    if not line or not line.startswith("data: "):
                        continue
                    raw = line[len("data: "):]
                    if raw == "[DONE]":
                        break
                    try:
                        obj = json.loads(raw)
                        delta = obj.get("choices", [{}])[0].get("delta", {})
                        token = delta.get("content", "")
                        if token:
                            assembled.append(token)
                            yield _sse("node_progress", node_id, {"token": token})
                    except json.JSONDecodeError:
                        continue
    except Exception as exc:
        logger.error(f"LLM node {node_id} error: {exc}")
        yield _sse("node_error", node_id, {"error": str(exc)})
        return

    output = "".join(assembled)
    yield _sse("node_done", node_id, {"output": output})


# ---------------------------------------------------------------------------
# RAG Query Node
# ---------------------------------------------------------------------------

async def handle_rag_query(
    node_id: str, config: dict, inputs: dict, run_id: str
) -> AsyncGenerator[dict, None]:
    """Query a ChromaDB collection and return concatenated results."""
    from vector_db_control.chroma import query_collection

    collection_name = config.get("collection_name", "")
    n_results = config.get("n_results", 5)
    embed_model = getattr(settings, "CHROMA_DB_EMBED_MODEL", "all-MiniLM-L6-v2")

    upstream_text = " ".join(str(v) for v in inputs.values())

    if not collection_name:
        yield _sse("node_error", node_id, {"error": "No collection selected"})
        return

    try:
        results = query_collection(
            collection_name=collection_name,
            embedding_func_name=embed_model,
            query_texts=[upstream_text],
            n_results=int(n_results),
        )
        docs = results.get("documents", [[]])[0]
        output = "\n\n---\n\n".join(docs) if docs else "(no results)"
        yield _sse("node_done", node_id, {"output": output})
    except Exception as exc:
        logger.error(f"RAG node {node_id} error: {exc}")
        yield _sse("node_error", node_id, {"error": str(exc)})


# ---------------------------------------------------------------------------
# Agent Node
# ---------------------------------------------------------------------------

async def handle_agent(
    node_id: str, config: dict, inputs: dict, run_id: str
) -> AsyncGenerator[dict, None]:
    """
    Forward to the existing ``app/agent`` FastAPI service (tt_studio_agent:8080)
    and stream reasoning steps back through the workflow SSE channel.
    """
    import os

    agent_host = os.environ.get("AGENT_HOST", "tt_studio_agent")
    agent_port = os.environ.get("AGENT_PORT", "8080")
    agent_url = f"http://{agent_host}:{agent_port}/poll_requests"

    goal = config.get("goal", "")
    upstream_text = " ".join(str(v) for v in inputs.values())
    message = f"{goal}\n\nContext:\n{upstream_text}" if goal else upstream_text

    thread_id = config.get("thread_id", str(uuid.uuid4()))

    payload = {"thread_id": thread_id, "message": message}

    assembled = []
    try:
        async with _vllm_client.stream("POST", agent_url, json=payload) as response:
            response.raise_for_status()
            async for chunk in response.aiter_text():
                chunk = chunk.strip()
                if not chunk or chunk == "[DONE]":
                    continue
                if chunk.startswith("[STATS]"):
                    continue

                # Forward raw reasoning text
                assembled.append(chunk)
                yield _sse("agent_reasoning", node_id, {"text": chunk})
    except Exception as exc:
        logger.error(f"Agent node {node_id} error: {exc}")
        yield _sse("node_error", node_id, {"error": str(exc)})
        return

    output = "".join(assembled)
    yield _sse("node_done", node_id, {"output": output})


# ---------------------------------------------------------------------------
# Handler registry
# ---------------------------------------------------------------------------

NODE_HANDLERS = {
    "input": handle_input,
    "output": handle_output,
    "llm": handle_llm,
    "rag_query": handle_rag_query,
    "agent": handle_agent,
}
