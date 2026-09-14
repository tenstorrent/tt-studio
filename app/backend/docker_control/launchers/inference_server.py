# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Launcher backend for the released catalog, served by tt-inference-server.

A thin adapter over tt_inference_client. The inference-server deploy also resolves a
device name, tt_config overrides, a docker image and an artifact ref, all of which
depend on the catalog impl; DeployView still computes those and passes them through
``StartRequest.options`` so this adapter introduces no second source of truth.
"""

from __future__ import annotations

from typing import Any, Dict

from docker_control.launchers.base import StartRequest, StartResult, StopResult
from docker_control.tt_inference_client import start_chat_deployment

NAME = "inference-server"


class TTInferenceServerLauncher:
    """Serves models from the tt-inference-server catalog."""

    name = NAME

    def available(self) -> bool:
        # The artifact is a hard startup requirement for a hardware install, so this
        # backend is always considered present; a real outage surfaces as a start error.
        return True

    def start(self, request: StartRequest) -> StartResult:
        options: Dict[str, Any] = dict(request.options or {})
        result = start_chat_deployment(
            model_name=request.model_impl.model_name,
            device=request.device,
            service_port=request.service_port,
            **options,
        )
        return StartResult(
            status=result.status,
            job_id=result.job_id,
            message=result.message,
            api_response=result.api_response,
        )

    def stop(self, deployment) -> StopResult:
        """Stopping is a docker operation for this backend, handled by docker_utils.

        Kept explicit rather than raising: the caller's existing stop path already
        covers it, and a launcher that claimed to stop the container would duplicate
        the streaming-stop flow in StopStreamView.
        """
        return StopResult(
            status="success",
            message="Handled by the container stop path",
        )
