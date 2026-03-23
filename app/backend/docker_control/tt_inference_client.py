# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests


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
    fastapi_run_url: str = "http://172.18.0.1:8001/run",
    timeout_seconds: int = 30,
    dev_mode: bool = False,
    skip_system_sw_validation: bool = True,
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
    except Exception:
        api_result = {}

    return TTInferenceRunResult(
        status="success",
        job_id=api_result.get("job_id"),
        message=api_result.get("message", "Deployment started"),
        api_response=api_result,
    )

