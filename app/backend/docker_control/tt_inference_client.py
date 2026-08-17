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


def tool_call_parser_for(model_name: str = "", hf_model_id: str = "") -> Optional[str]:
    """Return the vLLM ``--tool-call-parser`` for a model family, or None.

    Coding agents (Claude Code, Cursor) send ``tool_choice: "auto"`` with tool
    definitions; vLLM rejects those unless launched with
    ``--enable-auto-tool-choice --tool-call-parser <parser>``. The correct parser
    is model-family specific. Unknown families return None so we DON'T enable tool
    calling rather than risk a wrong parser breaking model startup.
    """
    s = f"{hf_model_id} {model_name}".lower()
    if "llama-3" in s or "llama3" in s:
        return "llama3_json"
    # Qwen3.5 / Qwen3.6 blackhole builds ship with the qwen3_coder parser; older
    # Qwen families use hermes.
    if "qwen3.5" in s or "qwen3.6" in s or "qwen35" in s or "qwen36" in s:
        return "qwen3_coder"
    if "qwen" in s or "qwq" in s:
        return "hermes"
    if "mistral" in s:
        return "mistral"
    if "deepseek" in s:
        return "deepseek_v3"
    if "gemma-4-" in s:
        return "gemma4"
    return None


def tool_calling_launch_flags(model_name: str = "", hf_model_id: str = "") -> Optional[str]:
    """The vLLM flags a container must be launched with for coding-agent tool
    calling and/or reasoning splitting, or None if the model family needs
    neither. A registered reasoning parser no longer requires a tool-call
    parser: reasoning models without a known tool format (e.g. NemotronH)
    still need --reasoning-parser so thinking ends up in reasoning_content
    instead of leaking into the reply."""
    from shared_config.coding_agent_config import get_reasoning_parser

    parser = tool_call_parser_for(model_name, hf_model_id)
    reasoning = get_reasoning_parser(model_name)
    parts = []
    if parser:
        parts.append(f"--enable-auto-tool-choice --tool-call-parser {parser}")
    if reasoning:
        parts.append(f"--reasoning-parser {reasoning}")
    return " ".join(parts) if parts else None


def resolve_deploy_image(
    model_name: str,
    device: Optional[str] = None,
    *,
    impl: Optional[str] = None,
    fastapi_base_url: Optional[str] = None,
    timeout_seconds: int = 5,
) -> Optional[str]:
    """Ask the TT Inference Server which Docker image it will actually deploy for
    a model. Returns the image ref, or None if it can't be resolved. `device` is an
    optional hint; the server falls back to a per-model lookup when it's omitted.
    `impl` disambiguates models whose name+device match multiple engine specs (e.g.
    a forge/training and a vLLM spec share a name); without it the server may
    default to the wrong engine's image.

    The deployed image is chosen by the server's own model_spec, which can differ
    from tt-studio's static catalog (impl.image_version). Pre-pulling must use this
    ref to produce a real cache hit; callers fall back to impl.image_version on None.
    """
    fastapi_base_url = (
        fastapi_base_url or backend_config.tt_inference_api_url
    ).rstrip("/")
    try:
        base_params = {"model": model_name}
        if device:
            base_params["device"] = device

        # Try impl-qualified first, then fall back to a plain lookup. An impl the
        # server can't match (e.g. a spec outside the prod tier) 404s the qualified
        # request even when the plain one would resolve, so a redundant impl must
        # not block resolution. The catalog now records impl only when it truly
        # disambiguates, making this a defensive backstop.
        attempts = []
        if impl:
            attempts.append({**base_params, "impl": impl})
        attempts.append(base_params)

        for params in attempts:
            r = requests.get(
                f"{fastapi_base_url}/resolve-image",
                params=params,
                timeout=timeout_seconds,
            )
            if r.status_code != 200:
                logger.warning(
                    f"resolve-image for model={model_name} device={device} "
                    f"impl={params.get('impl')} returned HTTP {r.status_code}: {r.text[:200]}"
                )
                continue
            image = (r.json() or {}).get("docker_image")
            if image:
                return image
        return None
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
    vllm_override_args: Optional[str] = None,
    override_tt_config: Optional[str] = None,
    override_docker_image: Optional[str] = None,
    artifact_ref: Optional[str] = None,
    disable_metal_timeout: bool = False,
) -> TTInferenceRunResult:
    """Start a chat model deployment via TT Inference Server (/run).

    This endpoint is expected to return quickly with a job_id so the UI can poll
    /run/progress/<job_id> and display explicit weights download progress.
    """
    fastapi_run_url = (
        fastapi_run_url or f"{backend_config.tt_inference_api_url}/run"
    ).strip().rstrip("/")
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
    if vllm_override_args is not None:
        payload["vllm_override_args"] = vllm_override_args
    if override_tt_config is not None:
        payload["override_tt_config"] = override_tt_config
    if override_docker_image is not None:
        payload["override_docker_image"] = override_docker_image
    if artifact_ref is not None:
        payload["artifact_ref"] = artifact_ref
    if disable_metal_timeout:
        payload["disable_metal_timeout"] = True

    # Pass UI-managed secrets explicitly. The inference server runs on the host
    # and cannot read user_config.env in the persistent volume when the backend
    # container (root) wrote it, so the request payload is its reliable source.
    from shared_config.user_config import get_hf_token, get_jwt_secret
    hf_token = get_hf_token()
    if hf_token:
        payload["hf_token"] = hf_token
    jwt_secret = get_jwt_secret()
    if jwt_secret:
        payload["jwt_secret"] = jwt_secret

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
