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
from typing import List, Optional

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
from docker_control.tt_model_client import fetch_bundle, get_community_impl
from shared_config.community_model_config import (
    build_community_model_impl,
    is_verified_bundle,
    parse_community_model_id,
    profile_for_chips,
    unavailable_mark,
)

logger = logging.getLogger(__name__)

BASE_SERVICE_PORT = 7000


def deploy_community_model(request) -> Response:
    """Handle a POST /docker/deploy/ whose model_id is a community bundle."""
    model_id = request.data.get("model_id")
    repo_id, profile = parse_community_model_id(model_id)
    if not is_verified_bundle(repo_id):
        return Response(
            {
                "status": "error",
                "message": f"{repo_id} is not in the verified community catalog.",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    impl = get_community_impl(model_id)
    if impl is None:
        return Response(
            {
                "status": "error",
                "message": (
                    f"Community model '{model_id}' could not be resolved. It may have "
                    "been unpublished, tt-model-manager may be unavailable, or its engine "
                    "cannot be launched."
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if profile and profile not in impl.profiles:
        return Response(
            {"status": "error", "message": f"{repo_id} has no profile '{profile}'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    pinned = _requested_device_ids(request.data.get("device_id"))
    impl = _impl_for_pinned_devices(impl, pinned)

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

    mark = unavailable_mark(impl.repo_id, impl.profile)
    if mark:
        return Response(
            {
                "status": "error",
                "message": f"{impl.repo_id} is not offered in TT Studio: {mark[1]}",
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
        device_id, device_ids = _allocate_slots(impl, pinned[0] if pinned else None)
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


def _requested_device_ids(raw) -> List[int]:
    """The slots the user pinned ("2" or "2,3"), or [] for auto-placement."""
    if raw is None or str(raw).strip() == "":
        return []
    try:
        return [int(part) for part in str(raw).split(",") if part.strip()]
    except ValueError:
        return []


def _impl_for_pinned_devices(impl, pinned: List[int]):
    """Switch to the profile whose mesh matches an explicit multi-device pin.

    "0,1" states a chip count the model_id's profile need not match: the CLI's
    --device-id sends the listing's default id. A lone slot is left alone, since for
    a multi-chip profile it only names the base slot.
    """
    if len(pinned) < 2 or len(pinned) == impl.chips_required:
        return impl
    bundle = fetch_bundle(impl.repo_id)
    name = profile_for_chips(bundle or {}, len(pinned), preferred=impl.profile)
    return build_community_model_impl(bundle, name, impl.service_port) if name else impl


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
    from docker_control.views import _community_fit  # views imports this module

    if _community_fit(
        impl.device_configurations, chips, allocator.board_type, allocator.total_slots, impl.kind
    ) is False:
        raise AllocationError(
            f"{impl.repo_id} ({impl.profile}) does not run on this {allocator.board_type} board."
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
            reasoning_parser=impl.reasoning_parser,
        )
    except Exception as e:
        logger.warning(
            f"Could not create ModelDeployment for community job {job_id}: {e}"
        )
