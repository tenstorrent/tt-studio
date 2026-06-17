# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Periodic keepalive pings against deployed vLLM containers.

Two layers run from one background thread on each worker:

1. GET /health every 500ms — keeps the TCP+HTTP keepalive socket in
   _vllm_client's pool alive (vLLM/uvicorn closes idle keepalives at 5s).
2. POST /v1/{chat/}completions with max_tokens=1 every 30s — warms vLLM's
   internal pipeline state (scheduler, allocator, tokenizer cache, prefill
   kernels) on top of the TCP layer.

Both go through the same _vllm_client that inference uses, scheduled onto
the captured ASGI loop via run_coroutine_threadsafe.
"""

import asyncio
import threading
import time
from typing import Optional

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_WARMUP_INTERVAL_SECONDS = 0.5
_WARMUP_REQUEST_TIMEOUT = 2.0

_INFERENCE_WARMUP_INTERVAL_SECONDS = 30.0
_INFERENCE_WARMUP_TIMEOUT = 10.0

_loop: Optional[asyncio.AbstractEventLoop] = None
_loop_lock = threading.Lock()
_warmer_thread: Optional[threading.Thread] = None
_stop = False
_last_inference_warmup: float = 0.0


def note_inference_loop() -> None:
    """Capture the ASGI worker's event loop. Idempotent; first call wins."""
    global _loop
    if _loop is not None:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    with _loop_lock:
        if _loop is None:
            _loop = loop
            logger.info("connection_warmer: captured ASGI loop")


async def _ping_all() -> None:
    from model_control.model_utils import _vllm_client, encoded_jwt, get_deploy_cache
    try:
        entries = get_deploy_cache()
    except Exception as e:
        logger.debug(f"connection_warmer: deploy cache unavailable: {e}")
        return
    headers = {"Authorization": f"Bearer {encoded_jwt}"}
    for con_id, entry in entries.items():
        health_url = entry.get("health_url")
        if not health_url:
            continue
        try:
            await _vllm_client.get(
                f"http://{health_url}",
                headers=headers,
                timeout=_WARMUP_REQUEST_TIMEOUT,
            )
        except Exception as e:
            logger.debug(f"connection_warmer: ping {health_url} failed: {e}")


async def _warmup_inference_all() -> None:
    """Send a max_tokens=1 inference to each deployed model to warm vLLM's
    scheduler / allocator / kernel state, not just the TCP socket."""
    from model_control.model_utils import _vllm_client, encoded_jwt, get_deploy_cache
    try:
        entries = get_deploy_cache()
    except Exception as e:
        logger.debug(f"connection_warmer: deploy cache unavailable: {e}")
        return
    headers = {"Authorization": f"Bearer {encoded_jwt}"}
    for con_id, entry in entries.items():
        internal_url = entry.get("internal_url")
        if not internal_url:
            continue
        impl = entry.get("model_impl")
        model_name = entry.get("cached_model_name") or (
            impl.hf_model_id if impl is not None else None
        )
        if not model_name:
            continue
        is_chat = "/chat/completions" in internal_url
        if is_chat:
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
                "stream": False,
            }
        else:
            payload = {
                "model": model_name,
                "prompt": "hi",
                "max_tokens": 1,
                "stream": False,
            }
        try:
            await _vllm_client.post(
                f"http://{internal_url}",
                json=payload,
                headers=headers,
                timeout=_INFERENCE_WARMUP_TIMEOUT,
            )
        except Exception as e:
            logger.debug(
                f"connection_warmer: inference warmup {internal_url} failed: {e}"
            )


def _warmer_loop() -> None:
    global _last_inference_warmup
    logger.info(
        "connection_warmer: thread started (health_interval=%ss, inference_interval=%ss)",
        _WARMUP_INTERVAL_SECONDS,
        _INFERENCE_WARMUP_INTERVAL_SECONDS,
    )
    while not _stop:
        time.sleep(_WARMUP_INTERVAL_SECONDS)
        loop = _loop
        if loop is None or not loop.is_running():
            continue
        try:
            fut = asyncio.run_coroutine_threadsafe(_ping_all(), loop)
            fut.result(timeout=_WARMUP_INTERVAL_SECONDS + 2.0)
        except Exception as e:
            logger.debug(f"connection_warmer: tick failed: {e}")

        now = time.monotonic()
        if now - _last_inference_warmup >= _INFERENCE_WARMUP_INTERVAL_SECONDS:
            _last_inference_warmup = now
            # Fire and forget so a slow inference warmup never starves the
            # 500ms /health cadence — the coroutine logs its own errors.
            try:
                asyncio.run_coroutine_threadsafe(_warmup_inference_all(), loop)
            except Exception as e:
                logger.debug(
                    f"connection_warmer: inference warmup schedule failed: {e}"
                )


def start_connection_warmer() -> None:
    global _warmer_thread, _stop
    if _warmer_thread is not None and _warmer_thread.is_alive():
        return
    _stop = False
    _warmer_thread = threading.Thread(
        target=_warmer_loop, name="vllm-connection-warmer", daemon=True
    )
    _warmer_thread.start()
