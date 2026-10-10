# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pre-deploy checks shared by both launcher backends.

These run before a chip slot is consumed and are identical whether the model comes
from the tt-inference-server catalog or from a community bundle, so they live outside
the deploy views rather than being duplicated per path.

Each returns ``(payload, http_status)`` describing the refusal, or ``None`` to proceed.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

from rest_framework import status

logger = logging.getLogger(__name__)

Refusal = Optional[Tuple[dict, int]]


def hugging_face_access_refusal(hf_repo: Optional[str]) -> Refusal:
    """Refuse early when the configured HF token cannot read a model's weights.

    Checked before allocating a chip slot: a deploy that will fail on a 401 should not
    hold devices while it discovers that.
    """
    if not hf_repo or "/" not in hf_repo:
        return None

    from api.hf_access import _check_repo, _status_from_code
    from shared_config.user_config import get_hf_token

    token = get_hf_token()
    code = _check_repo(token or "", hf_repo)
    # diffusers repos (FLUX/Wan) have no root config.json and 404; retry with
    # model_index.json so a gated diffusers repo still surfaces denied/auth_failed
    # instead of a false "error".
    if code == 404:
        code = _check_repo(token or "", hf_repo, "model_index.json")
    status_str = _status_from_code(code)

    if status_str in ("denied", "auth_failed"):
        message = (
            f"Your Hugging Face token does not have access to {hf_repo}."
            if token
            else f"A Hugging Face token is required to access {hf_repo}. Please add a token in Settings."
        )
        return (
            {
                "error_code": "hf_access_denied",
                "message": message,
                "hf_url": f"https://huggingface.co/{hf_repo}",
            },
            status.HTTP_400_BAD_REQUEST,
        )
    if status_str == "not_found" or code == 404:
        return (
            {
                "error_code": "hf_model_not_found",
                "message": (
                    f"The Hugging Face model repository '{hf_repo}' could not be found "
                    "or is unavailable."
                ),
                "hf_url": f"https://huggingface.co/{hf_repo}",
            },
            status.HTTP_400_BAD_REQUEST,
        )
    return None


def deploy_in_flight_refusal(model_name: str) -> Refusal:
    """Refuse a second concurrent *start* of the same model.

    Multiple concurrent instances are allowed when chip capacity exists; this blocks
    only a duplicate start. A model still in 'starting' has a deploy in flight, and
    firing another achieves nothing — the launchers serialise their work, so the
    duplicate would either be rejected or sit invisibly queued and then start a second
    container on the same devices and port when the first finished. Deliberately
    independent of chip-slot accounting so it still holds if slot bookkeeping is ever
    wrong about the board being free.
    """
    from docker_control.models import ModelDeployment

    in_flight = ModelDeployment.objects.filter(
        model_name=model_name, status="starting"
    ).first()
    if in_flight is None:
        return None

    logger.info(
        f"Rejecting duplicate deploy of {model_name}: job "
        f"{in_flight.container_id} is already starting"
    )
    return (
        {
            "status": "error",
            "error_type": "deploy_in_flight",
            "message": (
                f"{model_name} is already deploying. Wait for it to finish, or cancel "
                f"it from the Deployed Models page before starting another."
            ),
            "job_id": in_flight.container_id,
        },
        status.HTTP_409_CONFLICT,
    )
