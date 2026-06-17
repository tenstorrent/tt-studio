# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Periodic keepalive pings against deployed vLLM containers.

vLLM (uvicorn) closes idle HTTP keepalive connections after 5s by default,
so the first inference after a brief idle pays a TCP+HTTP reconnect on TTFT.
A background thread submits cheap GET /health pings through _vllm_client
(the same pool inference uses) onto the captured ASGI loop, keeping the
pooled socket genuinely active.
"""

import asyncio
import threading
import time
from typing import Optional

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_WARMUP_INTERVAL_SECONDS = 0.5
_WARMUP_REQUEST_TIMEOUT = 2.0

_loop: Optional[asyncio.AbstractEventLoop] = None
_loop_lock = threading.Lock()
_warmer_thread: Optional[threading.Thread] = None
_stop = False


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


def _warmer_loop() -> None:
    logger.info("connection_warmer: thread started (interval=%ss)", _WARMUP_INTERVAL_SECONDS)
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


def start_connection_warmer() -> None:
    global _warmer_thread, _stop
    if _warmer_thread is not None and _warmer_thread.is_alive():
        return
    _stop = False
    _warmer_thread = threading.Thread(
        target=_warmer_loop, name="vllm-connection-warmer", daemon=True
    )
    _warmer_thread.start()
