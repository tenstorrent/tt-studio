# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TTInferenceRunResult:
    status: str  # "success" | "error"
    job_id: Optional[str] = None
    message: str = ""
    api_response: Optional[Dict[str, Any]] = None


def start_chat_deployment(
    *,
    model_name: str,
    device: str,
    device_id: Optional[int] = None,
    service_port: Optional[int] = None,
    fastapi_run_url: str = "http://172.18.0.1:8001/run",
    timeout_seconds: int = 30,
    dev_mode: bool = False,
    skip_system_sw_validation: bool = True,
    override_tt_config: Optional[str] = None,
) -> TTInferenceRunResult:
    """Start a chat model deployment via TT Inference Server (/run).

    This endpoint is expected to return quickly with a job_id so the UI can poll
    /run/progress/<job_id> and display explicit weights download progress.
    """
    payload: Dict[str, Any] = {
        "model": model_name,
        "workflow": "server",
        "device": device,
        "docker_server": True,
        "dev_mode": dev_mode,
        "skip_system_sw_validation": skip_system_sw_validation,
    }
    if service_port is not None:
        payload["service_port"] = str(service_port)
    if device_id is not None:
        payload["device_id"] = str(device_id)
    if override_tt_config is not None:
        payload["override_tt_config"] = override_tt_config

    try:
        r = requests.post(fastapi_run_url, json=payload, timeout=timeout_seconds)
    except requests.exceptions.RequestException as e:
        return TTInferenceRunResult(
            status="error",
            message=f"Network error calling TT Inference Server /run: {e}",
        )

    if r.status_code not in (200, 202):
        return TTInferenceRunResult(
            status="error",
            message=f"TT Inference Server /run failed (HTTP {r.status_code}): {r.text}",
        )

    api_result: Dict[str, Any] = {}
    try:
        api_result = r.json() if r.content else {}
    except Exception as e:
        logger.error(
            f"Failed to parse JSON from TT Inference Server /run response "
            f"(HTTP {r.status_code}): {e}. Body: {r.text[:300]}"
        )
        return TTInferenceRunResult(
            status="error",
            message=f"Bad response from TT Inference Server: {e}",
        )

    job_id = api_result.get("job_id")
    if not job_id:
        logger.error(
            f"TT Inference Server returned HTTP {r.status_code} but no job_id in response. "
            f"Full response: {api_result}"
        )
        return TTInferenceRunResult(
            status="error",
            message="TT Inference Server did not return a job_id — deployment may not have started",
            api_response=api_result,
        )

    return TTInferenceRunResult(
        status="success",
        job_id=job_id,
        message=api_result.get("message", "Deployment started"),
        api_response=api_result,
    )

