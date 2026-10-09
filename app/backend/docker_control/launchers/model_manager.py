# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Launcher backend for community bundles, served by tt-model-manager."""

from __future__ import annotations

import logging
import re

from docker_control.launchers.base import StartRequest, StartResult, StopResult
from docker_control.tt_model_client import (
    cancel_community_deployment,
    community_available,
    start_community_deployment,
    stop_community_deployment,
)
from shared_config.community_model_config import parse_community_model_id

logger = logging.getLogger(__name__)

NAME = "community"


class TTModelManagerLauncher:
    """Serves community bundles from the Hugging Face Hub via tt-model-manager."""

    name = NAME

    def available(self) -> bool:
        return community_available()

    def start(self, request: StartRequest) -> StartResult:
        impl = request.model_impl
        # The chips the caller reserved are pinned on the container, so the bundle's
        # mesh opens exactly those and TT Studio's slot bookkeeping stays truthful.
        result = start_community_deployment(
            repo_id=impl.repo_id,
            profile=impl.profile,
            service_port=request.service_port,
            device_ids=request.device_ids,
        )
        return StartResult(
            status=result.status,
            job_id=result.job_id,
            message=result.message,
            api_response=result.api_response,
        )

    def stop(self, deployment) -> StopResult:
        """Stop through tt-model-manager so the mesh is closed cleanly.

        The bundle is identified from the deployment's model_name (the Hub id) rather
        than the container name, because the container name is derived from the
        manifest and only tt-model-manager can reproduce it.
        """
        repo_id = getattr(deployment, "model_name", "") or ""
        profile = None
        model_id = getattr(deployment, "community_model_id", None)
        if model_id:
            try:
                repo_id, profile = parse_community_model_id(model_id)
            except ValueError:
                pass
        if not repo_id:
            return StopResult(status="error", message="No bundle id on this deployment")

        # Until the deploy job finishes, the record holds its job id, not a container's.
        job_id = getattr(deployment, "container_id", "") or ""
        if job_id and not re.fullmatch(r"[0-9a-f]{64}", job_id):
            response = cancel_community_deployment(job_id)
            if response.get("status") == "error":
                return StopResult(status="error", message=response.get("message") or "")
            if response.get("community"):
                return StopResult(status="success", message=f"Cancelled deployment of {repo_id}")

        response = stop_community_deployment(repo_id, profile)
        if response.get("status") != "success":
            return StopResult(
                status="error",
                message=response.get("message") or f"Could not stop {repo_id}",
            )
        return StopResult(
            status="success",
            message=f"Stopped {repo_id}",
            mesh_reset=bool(response.get("mesh_reset")),
        )
