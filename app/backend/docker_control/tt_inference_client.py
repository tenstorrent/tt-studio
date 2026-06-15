# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional, Union

import requests

from shared_config.backend_config import backend_config

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TTInferenceRunResult:
    status: str  # "success" | "error"
    job_id: Optional[str] = None
    message: str = ""
    api_response: Optional[Dict[str, Any]] = None


def resolve_deploy_image(
    model_name: str,
    device: Optional[str] = None,
    *,
    fastapi_base_url: Optional[str] = None,
    timeout_seconds: int = 5,
) -> Optional[str]:
    """Ask the TT Inference Server which Docker image it will actually deploy for
    a model. Returns the image ref, or None if it can't be resolved. `device` is an
    optional hint; the server falls back to a per-model lookup when it's omitted.

    The deployed image is chosen by the server's own model_spec, which can differ
    from tt-studio's static catalog (impl.image_version). Pre-pulling must use this
    ref to produce a real cache hit; callers fall back to impl.image_version on None.
    """
    fastapi_base_url = (
        fastapi_base_url or backend_config.tt_inference_api_url
    ).rstrip("/")
    try:
        params = {"model": model_name}
        if device:
            params["device"] = device
        r = requests.get(
            f"{fastapi_base_url}/resolve-image",
            params=params,
            timeout=timeout_seconds,
        )
        if r.status_code != 200:
            logger.warning(
                f"resolve-image for model={model_name} device={device} returned HTTP {r.status_code}: {r.text[:200]}"
            )
            return None
        image = (r.json() or {}).get("docker_image")
        return image or None
    except requests.exceptions.RequestException as e:
        logger.warning(f"resolve-image request failed for model={model_name}: {e}")
        return None
    except Exception as e:
        logger.warning(f"resolve-image parse failed for model={model_name}: {e}")
        return None


def start_chat_deployment(
    *,
    model_name: str,
    device: str,
    device_id: Optional[Union[int, str]] = None,
    service_port: Optional[int] = None,
    fastapi_run_url: Optional[str] = None,
    timeout_seconds: int = 30,
    dev_mode: bool = False,
    skip_system_sw_validation: bool = True,
    override_tt_config: Optional[str] = None,
    override_docker_image: Optional[str] = None,
) -> TTInferenceRunResult:
    """Start a chat model deployment via TT Inference Server (/run).

    This endpoint is expected to return quickly with a job_id so the UI can poll
    /run/progress/<job_id> and display explicit weights download progress.
    """
    fastapi_run_url = fastapi_run_url or f"{backend_config.tt_inference_api_url}/run"
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
    if override_docker_image is not None:
        payload["override_docker_image"] = override_docker_image

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
