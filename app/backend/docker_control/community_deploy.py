# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Deploying a community bundle, the tt-model-manager way.

Kept beside DeployView rather than inside it: the inference-server branch there is
long because it resolves catalog-specific things (device names, mesh fallbacks,
tt_config overrides, artifact refs, image pre-pulls) that a bundle's manifest already
answers. Only the parts that are genuinely shared are shared — the pre-deploy guards,
the chip allocator, the deployment record, and the progress/sync machinery — so a
community deploy is tracked and displayed exactly like a catalog one.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Optional

from rest_framework import status
from rest_framework.response import Response

from docker_control import launchers
from docker_control.chip_allocator import (
    AllocationError,
    ChipSlotAllocator,
    MultiChipConflictError,
)
from docker_control.deploy_guards import (
    deploy_in_flight_refusal,
    hugging_face_access_refusal,
)
from docker_control.launchers.base import StartRequest
from docker_control.tt_model_client import get_community_impl

logger = logging.getLogger(__name__)

BASE_SERVICE_PORT = 7000


def deploy_community_model(request) -> Response:
    """Handle a POST /docker/deploy/ whose model_id is a community bundle."""
    model_id = request.data.get("model_id")
    impl = get_community_impl(model_id)
    if impl is None:
        return Response(
            {
                "status": "error",
                "message": (
                    f"Community model '{model_id}' could not be resolved. It may have "
                    "been unpublished, or tt-model-manager may be unavailable."
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    launcher = launchers.get(launchers.COMMUNITY)
    if not launcher.available():
        return Response(
            {
                "status": "error",
                "message": (
                    "tt-model-manager is not installed on this host, so community "
                    "models cannot be deployed."
                ),
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    if impl.kind not in ("vllm-plugin", "vllm-fork"):
        # A bundle whose engine this build has no UI for would deploy into a route
        # that 404s, so it is refused by name instead.
        return Response(
            {
                "status": "error",
                "message": (
                    f"{impl.repo_id} uses the '{impl.kind}' engine, which this version "
                    "of TT Studio cannot serve yet."
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    refusal = hugging_face_access_refusal(impl.hf_model_id)
    if refusal:
        return Response(refusal[0], status=refusal[1])

    refusal = deploy_in_flight_refusal(impl.model_name)
    if refusal:
        return Response(refusal[0], status=refusal[1])

    try:
        device_id, device_ids = _allocate_slots(
            impl, _requested_device_id(request.data.get("device_id"))
        )
    except MultiChipConflictError as e:
        logger.warning(f"Multi-chip conflict for {impl.repo_id}: {e}")
        return Response(
            {
                "status": "error",
                "error_type": "multi_chip_conflict",
                "message": str(e),
                "conflicts": e.conflicts,
            },
            status=status.HTTP_409_CONFLICT,
        )
    except AllocationError as e:
        logger.warning(f"Allocation failed for {impl.repo_id}: {e}")
        return Response(
            {"status": "error", "error_type": "allocation_failed", "message": str(e)},
            status=status.HTTP_409_CONFLICT,
        )
    service_port = BASE_SERVICE_PORT + device_id
    # The port has to be on the impl too: it is what the deploy cache turns into the
    # model's internal URL once the container is up.
    impl = dataclasses.replace(impl, service_port=service_port)

    result = launcher.start(
        StartRequest(
            model_impl=impl,
            device=impl.arch or "",
            device_ids=device_ids,
            service_port=service_port,
        )
    )
    if not result.ok:
        return Response(
            {"status": "error", "message": result.message or "Deployment failed"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    _create_placeholder(impl, result.job_id, device_id, device_ids, service_port)
    try:
        from docker_control.deployment_sync import start_deployment_sync

        start_deployment_sync(result.job_id)
    except Exception as e:
        logger.warning(f"Could not start deployment sync for job {result.job_id}: {e}")

    return Response(
        {
            "status": "success",
            "job_id": result.job_id,
            "message": result.message or "Deployment started",
            "api_response": result.api_response or {},
            "allocated_device_id": device_id,
            "device_ids": device_ids,
            "source": launchers.COMMUNITY,
        },
        status=status.HTTP_201_CREATED,
    )


def _requested_device_id(raw) -> Optional[int]:
    """The base slot the user pinned in advanced mode, or None for auto-placement.

    Accepts the comma-separated form the deploy form also sends for catalog models
    ("0,1"); only the first slot matters, since the bundle's own chip count decides
    how many follow it.
    """
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return int(str(raw).split(",")[0].strip())
    except ValueError:
        return None


def _allocate_slots(impl, manual_device_id: Optional[int]):
    """Reserve exactly the chips the bundle's profile asks for.

    tt-model-manager scopes a container to the chips it is given, so TT Studio can
    reserve a bundle's real mesh size instead of the whole board — which means a
    1-chip bundle leaves the rest of a P300x2 free for other models.

    Returns ``(base_slot, every_slot_held)``. The base slot also sets the published
    port (7000 + base), keeping community and catalog models on one convention.
    """
    allocator = ChipSlotAllocator()
    chips = max(1, impl.chips_required)
    if chips > allocator.total_slots:
        raise AllocationError(
            f"{impl.repo_id} needs {chips} chips, but this board has "
            f"{allocator.total_slots}."
        )
    device_id = allocator.allocate_chip_slot(
        impl.model_name, manual_override=manual_device_id, chips_required=chips
    )
    return device_id, allocator.slot_group(device_id, chips)


def _create_placeholder(impl, job_id, device_id, device_ids, service_port):
    """Record the deployment under the job id, as the catalog chat path does.

    The chip slot must read IN USE from the moment the deploy starts; the real
    container id replaces the job id when the job completes
    (views._sync_chat_deployment_record).
    """
    try:
        from docker_control.models import ModelDeployment

        ModelDeployment.objects.create(
            container_id=job_id,
            container_name=impl.model_name,
            model_name=impl.model_name,
            device=impl.arch or "",
            device_id=device_id,
            device_ids=device_ids,
            status="starting",
            port=service_port,
            tool_calling_enabled=impl.tool_calling_enabled,
            model_type=impl.model_type.value,
            hf_model_id=impl.hf_model_id,
            service_route=impl.service_route,
            community_model_id=impl.model_id,
        )
    except Exception as e:
        logger.warning(
            f"Could not create ModelDeployment for community job {job_id}: {e}"
        )
