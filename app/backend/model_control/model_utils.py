# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import os
import pickle
import time
import traceback

import httpx
import requests
import jwt
import json

from django.core.cache import caches

from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger
from docker_control.docker_utils import update_deploy_cache
from model_control.metrics_tracker import InferenceMetricsTracker

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
AUTH_TOKEN = os.getenv('CLOUD_CHAT_UI_AUTH_TOKEN', '')

# Shared async HTTP clients with connection pooling (one pool per target)
_vllm_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0),
    limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
)
_cloud_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)

def messages_to_prompt(messages: list) -> str:
    """Convert chat messages list to a plain text prompt for base/completion models."""
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(content)
        elif role == "user":
            parts.append(f"User: {content}")
        elif role == "assistant":
            parts.append(f"Assistant: {content}")
    parts.append("Assistant:")
    return "\n\n".join(parts)


def get_model_context_length(internal_url: str):
    """Fetch max_model_len from vLLM /v1/models. Returns int or None if unavailable."""
    try:
        base = internal_url.split("/")[0]
        models_url = f"http://{base}/v1/models"
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        response = requests.get(models_url, headers=headers, timeout=3)
        if response.status_code == 200:
            data = response.json().get("data", [])
            if data:
                return data[0].get("max_model_len")
    except Exception as e:
        logger.warning(f"Failed to fetch max_model_len from {internal_url}: {e}")
    return None


def get_model_name_from_container(internal_url: str, fallback: str) -> str:
    """Query vLLM /v1/models to get the exact model name loaded in the container.

    Args:
        internal_url: Raw internal URL from deploy cache (e.g. "container:7000/v1/chat/completions")
        fallback: Value to return if the query fails (typically hf_model_id)

    Returns:
        The actual model name reported by vLLM, or fallback on any error.
    """
    try:
        # Strip the route path to get just host:port
        # e.g. "container:7000/v1/chat/completions" -> "container:7000"
        base = internal_url.split("/")[0]
        models_url = f"http://{base}/v1/models"
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        response = requests.get(models_url, headers=headers, timeout=3)
        if response.status_code == 200:
            model_id = response.json()["data"][0]["id"]
            logger.info(f"Resolved actual model name from /v1/models: {model_id}")
            return model_id
        else:
            logger.warning(
                f"GET {models_url} returned {response.status_code}, using fallback: {fallback}"
            )
            return fallback
    except Exception as e:
        logger.warning(f"Failed to query /v1/models ({e}), using fallback: {fallback}")
        return fallback


_last_deploy_cache_update: float = 0.0
_DEPLOY_CACHE_TTL: float = 5.0  # seconds — avoid hitting Docker API on every request


def get_deploy_cache():
    # the cache is initialized when by docker_control is imported
    def get_all_records():
        # need to strip out the key version tag
        return {
            k.replace(":version:", ""): pickle.loads(v)
            for k, v in caches[backend_config.django_deploy_cache_name]._cache.items()
        }

    global _last_deploy_cache_update
    now = time.monotonic()
    if now - _last_deploy_cache_update > _DEPLOY_CACHE_TTL:
        update_deploy_cache()
        _last_deploy_cache_update = now
    data = get_all_records()

    # Lazily enrich entries with max_model_len from the running vLLM container.
    # Once fetched it is persisted back into the cache so subsequent calls are free.
    cache = caches[backend_config.django_deploy_cache_name]
    for con_id, entry in data.items():
        if "max_model_len" not in entry and entry.get("internal_url"):
            max_len = get_model_context_length(entry["internal_url"])
            if max_len is not None:
                entry["max_model_len"] = max_len
                cache.set(con_id, entry, timeout=None)
                logger.info(f"Cached max_model_len={max_len} for container {con_id[:12]}")
        if "cached_model_name" not in entry and entry.get("internal_url"):
            name = get_model_name_from_container(
                entry["internal_url"], fallback=entry["model_impl"].hf_model_id
            )
            entry["cached_model_name"] = name
            cache.set(con_id, entry, timeout=None)
            logger.info(f"Cached model_name={name!r} for container {con_id[:12]}")

    return data


def health_check(url, json_data, timeout=5):
    logger.info(f"calling health_url:= {url}")
    try:
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        response = requests.get(url, json=json_data, headers=headers, timeout=5)
    except requests.exceptions.ConnectionError as e:
        # Port not yet listening — container is still starting up
        logger.info(f"Health check: connection refused (starting): {e}")
        return None, str(e)
    except requests.RequestException as e:
        logger.error(f"Health check failed (network error): {str(e)}")
        return False, str(e)

    if response.status_code == 200:
        logger.info(f"Health check passed: {response.status_code}")
        try:
            content = response.json() if response.content else {}
        except Exception:
            content = {}
        return True, content

    # 503 with "not ready" means model is still loading (media-server models)
    if response.status_code == 503:
        try:
            body = response.json()
        except Exception:
            body = {}
        detail = body.get("detail", "")
        if "not ready" in detail.lower():
            logger.info(f"Health check: model not ready yet (starting): {detail}")
            return None, detail

    logger.error(f"Health check failed: {response.status_code} {response.text[:200]}")
    return False, response.text[:200]

async def stream_response_from_agent_api(url: str, json_data: dict):
    logger.info('[TRACE_FLOW_STEP_3_BACKEND_TO_AGENT] stream_response_from_agent_api called', extra={'url': url})
    new_json_data = {
        "thread_id": json_data["thread_id"],
        "message": json_data["messages"][-1]["content"],
    }
    logger.info(f"POST {url} data:={new_json_data}")
    try:
        async with _vllm_client.stream("POST", url, json=new_json_data) as response:
            response.raise_for_status()
            async for chunk in response.aiter_text():
                logger.debug(f"stream_response_from_agent_api chunk:={chunk}")
                if chunk.strip() == "[DONE]":
                    yield f"data: [DONE]\n\n"
                elif chunk.strip():
                    json_chunk = {"choices": [{"index": 0, "delta": {"content": chunk}}]}
                    yield "data: " + json.dumps(json_chunk) + "\n\n"
        logger.info("stream_response_from_agent_api done")
    except httpx.HTTPStatusError as e:
        logger.error(f"Agent HTTPStatusError {e.response.status_code}: {e.response.text[:200]}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    except httpx.RequestError as e:
        logger.error(f"Agent RequestError: {str(e)}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

def get_max_tokens_limit(param_count) -> int:
    """Return max_tokens ceiling based on model parameter count (in billions)."""
    if param_count is None: return 32768
    if param_count <= 8:    return 32768
    if param_count <= 32:   return 65536
    return 131072


def validate_model_params(json_data, max_tokens_limit: int = 32768):
    """Validate and set default values for model parameters."""
    # Default values based on the working curl example
    defaults = {
        'temperature': 0.95,
        'top_p': 0.9,
        'top_k': 40,
        'max_tokens': 1024
    }

    # Parameter ranges
    ranges = {
        'temperature': (0.0, 2.0),
        'top_p': (0.0, 1.0),
        'top_k': (1, 100),
        'max_tokens': (1, max_tokens_limit)  # ceiling is model-size-dependent
    }
    
    validated_params = {}
    
    for param, default in defaults.items():
        value = json_data.get(param)
        
        # If value is None, 0, or not provided, use default
        if value is None or value == 0:
            logger.info(f"Using default value for {param}: {default}")
            validated_params[param] = default
            continue
            
        # Validate range
        min_val, max_val = ranges[param]
        if not (min_val <= value <= max_val):
            logger.warning(f"Invalid {param} value: {value}. Using default: {default}")
            validated_params[param] = default
        else:
            validated_params[param] = value
            
    return validated_params

async def stream_to_cloud_model(url: str, json_data: dict):
    """Stream response from cloud model (async)."""
    # Validate and coerce model parameters
    validated_params = validate_model_params(json_data)
    json_data.update(validated_params)
    temperature = json_data.get("temperature")
    top_k = json_data.get("top_k")
    top_p = json_data.get("top_p")
    max_tokens = json_data.get("max_tokens")
    json_data["temperature"] = float(temperature) if temperature is not None else 1.0
    json_data["top_k"] = int(top_k) if top_k is not None else 20
    json_data["top_p"] = float(top_p) if top_p is not None else 0.9
    json_data["max_tokens"] = int(max_tokens) if max_tokens is not None else 1024
    json_data["stream_options"] = {"include_usage": True}
    logger.info(f"stream_to_cloud_model params: temperature={json_data['temperature']} top_k={json_data['top_k']} top_p={json_data['top_p']} max_tokens={json_data['max_tokens']}")

    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    tracker = InferenceMetricsTracker()

    try:
        async with _cloud_client.stream("POST", url, json=json_data, headers=headers) as response:
            logger.info(f"stream_to_cloud_model response status:={response.status_code}")
            response.raise_for_status()
            te = response.headers.get("transfer-encoding", "")
            if te != "chunked":
                logger.warning(f"Unexpected transfer-encoding from cloud model: {te!r}")

            chunk_count = 0
            found_done = False
            async for chunk in response.aiter_text():
                chunk_count += 1
                logger.debug(f"cloud chunk #{chunk_count}: {repr(chunk)}")

                if "data: [DONE]" in chunk:
                    found_done = True

                if chunk.startswith("data: "):
                    new_chunk = chunk[len("data: "):].strip()
                    if new_chunk and new_chunk != "[DONE]":
                        try:
                            chunk_dict = json.loads(new_chunk)
                            usage = chunk_dict.get("usage") or {}
                            completion_tokens = usage.get("completion_tokens", 0)
                            prompt_tokens = usage.get("prompt_tokens", 0)
                            if completion_tokens > 0:
                                tracker.record_token(
                                    completion_tokens=completion_tokens,
                                    prompt_tokens=prompt_tokens,
                                )
                                logger.debug(f"Recorded token: completion={completion_tokens}, TTFT={tracker.get_ttft():.4f}s, TPOT={tracker.get_tpot():.4f}s")
                        except json.JSONDecodeError as e:
                            logger.error(f"JSON decode error in cloud chunk: {e}")
                    yield chunk
                    if found_done:
                        stats = tracker.get_stats()
                        logger.info(f"Cloud stream final stats: {stats}")
                        yield "data: " + json.dumps(stats) + "\n\n"
                        break
                else:
                    yield chunk

            if not found_done:
                logger.info("Cloud stream ended without [DONE], sending stats")
                yield "data: " + json.dumps(tracker.get_stats()) + "\n\n"

            logger.info(f"Cloud stream completed after {chunk_count} chunks")

    except httpx.HTTPStatusError as e:
        logger.error(f"Cloud HTTPStatusError {e.response.status_code}: {e.response.text[:200]}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    except Exception as e:
        logger.error(f"Cloud stream unexpected error: {e}\n{traceback.format_exc()}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

async def stream_response_from_external_api(url: str, json_data: dict):
    """Async SSE streaming from vLLM — non-blocking, connection-pooled."""
    logger.info("=== Starting stream_response_from_external_api ===")

    # Coerce and forward parameters
    temperature = json_data.get("temperature")
    top_k = json_data.get("top_k")
    top_p = json_data.get("top_p")
    max_tokens = json_data.get("max_tokens")
    json_data["temperature"] = float(temperature) if temperature is not None else 1.0
    json_data["top_k"] = int(top_k) if top_k is not None else 20
    json_data["top_p"] = float(top_p) if top_p is not None else 0.9
    json_data["max_tokens"] = int(max_tokens) if max_tokens is not None else 1024
    json_data["stream_options"] = {"include_usage": True}

    # Forward seed if provided (0 or absent means random)
    seed = json_data.get("seed")
    if seed is not None and int(seed) > 0:
        json_data["seed"] = int(seed)
    else:
        json_data.pop("seed", None)

    logger.info(f"stream_response_from_external_api params: temperature={json_data['temperature']} top_k={json_data['top_k']} top_p={json_data['top_p']} max_tokens={json_data['max_tokens']} seed={json_data.get('seed', 'random')}")

    headers = {"Authorization": f"Bearer {encoded_jwt}"}
    tracker = InferenceMetricsTracker()
    logger.info(f"Starting stream request at time: {tracker.start_time}")

    try:
        async with _vllm_client.stream("POST", url, json=json_data, headers=headers) as response:
            response.raise_for_status()
            te = response.headers.get("transfer-encoding", "")
            if te != "chunked":
                logger.warning(f"Unexpected transfer-encoding from vLLM: {te!r}")

            async for chunk in response.aiter_text():
                logger.debug(f"stream_response_from_external_api chunk:={chunk}")
                if chunk.startswith("data: "):
                    new_chunk = chunk[len("data: "):].strip()

                    if new_chunk == "[DONE]":
                        yield chunk
                        stats = tracker.get_stats()
                        logger.info(f"ttft and tpot stats: {stats}")
                        yield "data: " + json.dumps(stats) + "\n\n"
                        break

                    elif new_chunk != "":
                        chunk_dict = json.loads(new_chunk)

                        # Track TTFT/TPOT from content delta chunks
                        choices = chunk_dict.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta", {})
                            delta_reasoning = (
                                delta.get("reasoning_content")
                                or delta.get("reasoning")
                                or delta.get("thinking")
                            )
                            if delta_reasoning:
                                tracker.record_thinking_token()
                            delta_content = delta.get("content", "")
                            if delta_content:
                                tracker.record_content_token()
                                logger.debug(f"Recorded token: count={tracker.num_tokens}, TTFT={tracker.get_ttft():.4f}s, TPOT={tracker.get_tpot():.4f}s")

                        # Capture prompt_tokens from usage chunk
                        usage = chunk_dict.get("usage") or {}
                        prompt_tokens = usage.get("prompt_tokens", 0)
                        if prompt_tokens > 0:
                            tracker.set_prompt_tokens(prompt_tokens)

                    yield chunk

        logger.info("stream_response_from_external_api done")

    except httpx.HTTPStatusError as e:
        body = e.response.text if e.response is not None else "(no body)"
        logger.error(f"HTTPError {e.response.status_code}: {body}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    except httpx.RequestError as e:
        logger.error(f"RequestError: {str(e)}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

