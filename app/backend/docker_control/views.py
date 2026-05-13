# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.shortcuts import render
from django.http import StreamingHttpResponse
from django.views import View
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import json
import shutil
import subprocess
import signal
import os
from pathlib import Path

import re
import os
import concurrent.futures
import requests
import json
from .forms import DockerForm
from .docker_utils import (
    run_container,
    stop_container,
    get_container_status,
    perform_reset,
    perform_device_reset,
    check_image_exists,
    detect_board_type,
    map_board_type_to_device_name,
    _BOARD_TO_SINGLE_CHIP_DEVICE,
    update_deploy_cache,
    DEPLOYMENT_TIMEOUT_SECONDS,
)
from .tt_inference_client import start_chat_deployment
from .docker_control_client import get_docker_client
from shared_config.model_config import model_implmentations, infer_chips_required
from shared_config.model_type_config import ModelTypes
from .serializers import DeploymentSerializer, StopSerializer
from shared_config.logger_config import get_logger
from shared_config.backend_config import backend_config
from shared_config.device_config import DeviceConfigurations
from board_control.services import SystemResourceService

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

# Build model_name → status lookup from catalog JSON
_CATALOG_PATH = Path(__file__).parent.parent / "shared_config/models_from_inference_server.json"
try:
    _catalog = json.loads(_CATALOG_PATH.read_text())
    _status_lookup: dict[str, str | None] = {m["model_name"]: m.get("status") for m in _catalog["models"]}
except Exception:
    logger.warning(f"Could not load model catalog from {_CATALOG_PATH}; status will be null for all models")
    _status_lookup = {}

# Manual compatibility overrides: model names always shown as compatible regardless of board.
# HARDCODED: whisper-large-v3 and speecht5_tts are intentionally NOT listed here for qb2 (P300Cx2)
# until proper board support is confirmed. Edit model_compatibility_overrides.json to re-enable.
_OVERRIDE_PATH = Path(__file__).parent.parent / "shared_config/model_compatibility_overrides.json"
try:
    _override_data = json.loads(_OVERRIDE_PATH.read_text())
    _compatibility_override_names: set[str] = set(_override_data.get("model_names", []))
except Exception:
    _compatibility_override_names = set()

# Track when deployment started
deployment_start_times = {}  # {job_id: timestamp} - Track when deployment started


def _is_llama31_8b_model(model_name: str) -> bool:
    token = (model_name or "").lower().replace("_", "").replace(" ", "")
    return "llama-3.1-8b" in token or "llama3.18b" in token

class StopView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = StopSerializer(data=request.data)
        if serializer.is_valid():
            container_id = request.data.get("container_id")
            logger.info(f"Received request to stop container with ID: {container_id}")

            # Mark deployment as stopped by user in database
            try:
                from docker_control.models import ModelDeployment
                from django.utils import timezone
                
                deployment = ModelDeployment.objects.filter(container_id=container_id).first()
                if deployment:
                    deployment.stopped_by_user = True
                    deployment.status = "stopped"
                    deployment.stopped_at = timezone.now()
                    deployment.save()
                    logger.info(f"Marked deployment {container_id} as stopped by user")
            except Exception as e:
                logger.error(f"Failed to update deployment record: {e}")
                # Continue with stop even if database update fails

            # Stop the main container
            stop_response = stop_container(container_id)
            logger.info(f"Stop response: {stop_response}")

            # Perform reset if the stop was successful
            reset_response = None
            reset_status = "success"

            if stop_response.get("status") == "success":
                reset_response = perform_reset()
                logger.info(f"Reset response: {reset_response}")

                if reset_response.get("status") == "error":
                    error_message = reset_response.get(
                        "message", "An error occurred during reset."
                    )
                    http_status = reset_response.get(
                        "http_status", status.HTTP_500_INTERNAL_SERVER_ERROR
                    )
                    logger.warning(f"Reset failed: {error_message}")
                    reset_status = "error"
                else:
                    # Refresh tt-smi cache after successful stop and reset
                    try:
                        SystemResourceService.force_refresh_tt_smi_cache()
                    except Exception as e:
                        logger.warning(f"Failed to refresh tt-smi cache after model stop: {e}")

            # Ensure that we always return a status field
            combined_status = (
                "success" if stop_response.get("status") == "success" else "error"
            )

            # Return the response, combining the stop and reset results
            response_status = (
                status.HTTP_200_OK
                if combined_status == "success"
                else status.HTTP_500_INTERNAL_SERVER_ERROR
            )
            logger.info(f"Returning responses: {stop_response}, {reset_response}")
            return Response(
                {
                    "status": combined_status,
                    "stop_response": stop_response,
                    "reset_response": reset_response,
                    "reset_status": reset_status,
                },
                status=response_status,
            )
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ContainersView(APIView):
    def get(self, request, *args, **kwargs):
        # Detect current board type using tt-smi command
        current_board = detect_board_type()
        logger.info(f"Detected board type: {current_board}")
        
        # Map board types to their corresponding device configurations
        board_to_device_map = {
            # Wormhole single devices
            'N150': [DeviceConfigurations.N150, DeviceConfigurations.N150_WH_ARCH_YAML],
            'N300': [DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML],
            'E150': [DeviceConfigurations.E150],
            
            # Wormhole multi-device
            'N150X4': [DeviceConfigurations.N150X4, DeviceConfigurations.N150, DeviceConfigurations.N150_WH_ARCH_YAML],
            'T3000': [DeviceConfigurations.N300x4, DeviceConfigurations.N300x4_WH_ARCH_YAML, DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML],
            'T3K': [DeviceConfigurations.T3K, DeviceConfigurations.N300x4, DeviceConfigurations.N300x4_WH_ARCH_YAML, DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML],
            
            # Blackhole single devices
            'P100': [DeviceConfigurations.P100],
            'P150': [DeviceConfigurations.P150],
            'P300c': [DeviceConfigurations.P300c],
            
            # Blackhole multi-device
            'P150X4': [DeviceConfigurations.P150X4, DeviceConfigurations.P150],
            'P150X8': [DeviceConfigurations.P150X8, DeviceConfigurations.P150],
            # P300Cx2/P300Cx4: include P150 so single-chip models (--tt-device p150) show as compatible
            'P300Cx2': [DeviceConfigurations.P300Cx2, DeviceConfigurations.P150, DeviceConfigurations.P300c],
            'P300Cx4': [DeviceConfigurations.P300Cx4, DeviceConfigurations.P150, DeviceConfigurations.P300c],
            
            # Galaxy systems
            'GALAXY': [DeviceConfigurations.GALAXY, DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML],
            'GALAXY_T3K': [DeviceConfigurations.GALAXY_T3K, DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML],
            
            'unknown': []  # Empty list for unknown board type
        }
        
        # Get the device configurations for current board
        current_board_devices = set(board_to_device_map.get(current_board, []))
        logger.info(f"Current board devices: {current_board_devices}")
        
        data = []
        for impl_id, impl in model_implmentations.items():
            # Calculate compatibility
            is_compatible = False
            if current_board == 'unknown':
                # If board type is unknown, show all models but mark them as potentially incompatible
                is_compatible = None
            else:
                # Check if any of the current board's device configurations are in the model's configurations
                is_compatible = bool(current_board_devices.intersection(impl.device_configurations))
                logger.info(f"Model {impl.model_name}: is_compatible={is_compatible}")
            
            # Get all boards this model can run on
            compatible_boards = []
            for board, devices in board_to_device_map.items():
                if board != 'unknown' and bool(set(devices).intersection(impl.device_configurations)):
                    compatible_boards.append(board)

            # Manual override: always show certain models as compatible (e.g. whisper when sync JSON is incomplete)
            if impl.model_name in _compatibility_override_names:
                is_compatible = True
                if current_board != 'unknown' and current_board not in compatible_boards:
                    compatible_boards = list(compatible_boards) + [current_board]
                logger.info(f"Model {impl.model_name}: compatibility overridden to True")
            
            logger.info(f"Model {impl.model_name}: compatible={is_compatible}, boards={compatible_boards}")

            # Infer chip requirements for this model
            from shared_config.model_config import infer_chips_required
            chips_required = infer_chips_required(impl.device_configurations)

            data.append({
                "id": impl_id,
                "name": impl.model_name,
                "is_compatible": is_compatible,
                "compatible_boards": compatible_boards,
                "model_type": impl.model_type.value,
                "display_model_type": impl.display_model_type,
                "current_board": current_board,
                "status": _status_lookup.get(impl.model_name),
                "chips_required": chips_required,
            })
        
        return Response(data, status=status.HTTP_200_OK)


class StatusView(APIView):
    def get(self, request, *args, **kwargs):
        data = get_container_status()
        # Enrich with model_type from deploy cache so frontend navbar can route correctly (e.g. Speech -> /speech-to-text).
        try:
            from model_control.model_utils import get_deploy_cache

            deploy_cache = get_deploy_cache()
            for con_id, con_data in data.items():
                if con_id in deploy_cache:
                    model_impl = deploy_cache[con_id].get("model_impl")
                    if model_impl is not None:
                        mt = getattr(model_impl, "model_type", None)
                        if mt is not None:
                            con_data["model_type"] = getattr(
                                mt, "value", str(mt)
                            )
        except Exception as e:
            logger.warning(
                "Could not enrich status with model_type from deploy cache: %s",
                e,
            )
        return Response(data, status=status.HTTP_200_OK)


class ChipStatusView(APIView):
    """API endpoint for chip slot occupancy status"""

    def get(self, request, *args, **kwargs):
        """
        Get current chip slot status.

        Returns JSON with board type, total slots, and per-slot occupancy info.
        """
        try:
            # Prune deploy cache of containers that are no longer running
            # so dead containers don't block device slots.
            update_deploy_cache()

            from docker_control.chip_allocator import ChipSlotAllocator

            allocator = ChipSlotAllocator()
            status_info = allocator.get_chip_status()

            return Response(status_info, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error getting chip status: {str(e)}")
            return Response(
                {
                    "error": "Failed to get chip status",
                    "message": str(e)
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )



class DeployView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = DeploymentSerializer(data=request.data)
        if serializer.is_valid():
            from docker_control.chip_allocator import ChipSlotAllocator, AllocationError, MultiChipConflictError

            impl_id = request.data.get("model_id")
            weights_id = request.data.get("weights_id")
            use_image_override = request.data.get("use_image_override", True)

            # Get manual override if in advanced mode (optional).
            # device_id may be a single integer or a comma-separated list (e.g. "0,1")
            # for multi-chip single-card deployments (--device-id 0,1).
            raw_device_id = request.data.get("device_id")
            if raw_device_id is not None:
                requested_device_ids = [
                    int(x.strip()) for x in str(raw_device_id).split(",") if str(x).strip() != ""
                ]
                if not requested_device_ids:
                    requested_device_ids = [0]
                manual_device_id = requested_device_ids[0]  # primary slot for allocation
            else:
                requested_device_ids = []
                manual_device_id = None

            impl = model_implmentations[impl_id]
            chips_required = infer_chips_required(impl.device_configurations)

            # Stop and clean up any existing starting/running deployments of this
            # model before deploying a new instance. Prevents stale records with
            # wrong device_id from persisting in the UI after a re-deploy.
            try:
                from docker_control.models import ModelDeployment
                from docker_control.docker_utils import stop_container
                stale = list(ModelDeployment.objects.filter(
                    model_name=impl.model_name,
                    status__in=["starting", "running"],
                ))
                for old_dep in stale:
                    try:
                        stop_container(old_dep.container_id)
                    except Exception:
                        pass
                    old_dep.status = "stopped"
                    old_dep.save()
                    logger.info(
                        f"Cleaned up stale deployment record {old_dep.id} "
                        f"for {impl.model_name} (container_id={old_dep.container_id})"
                    )
            except Exception as e:
                logger.warning(f"Could not clean up stale deployments for {impl.model_name}: {e}")

            # Allocate a chip slot for all model types so device_id and service_port
            # are always set correctly (port = 7000 + device_id).
            try:
                allocator = ChipSlotAllocator()
                device_id = allocator.allocate_chip_slot(
                    impl.model_name,
                    manual_override=manual_device_id
                )
                # If multiple device IDs were requested, validate every slot and pass
                # them all to the inference server call; otherwise use the allocated slot.
                if requested_device_ids and len(requested_device_ids) > 1:
                    if chips_required != 1:
                        return Response(
                            {
                                "status": "error",
                                "error_type": "allocation_failed",
                                "message": (
                                    f"{impl.model_name} does not support explicit multi-slot "
                                    "single-card device_id selection."
                                ),
                            },
                            status=status.HTTP_409_CONFLICT,
                        )
                    normalized_requested_device_ids = []
                    for requested_slot in requested_device_ids:
                        if requested_slot in normalized_requested_device_ids:
                            continue
                        validation = allocator._validate_manual_allocation(
                            requested_slot, 1, impl.model_name
                        )
                        if not validation["valid"]:
                            return Response(
                                {
                                    "status": "error",
                                    "error_type": "allocation_failed",
                                    "message": validation["message"],
                                },
                                status=status.HTTP_409_CONFLICT,
                            )
                        normalized_requested_device_ids.append(requested_slot)
                    device_ids = normalized_requested_device_ids
                else:
                    device_ids = [device_id]
                device_ids_str = ",".join(str(d) for d in device_ids)
                logger.info(f"Allocated device_id={device_id} (request={device_ids_str}) for {impl.model_name}")

            except MultiChipConflictError as e:
                logger.warning(f"Multi-chip conflict for {impl.model_name}: {str(e)}")
                return Response({
                    "status": "error",
                    "error_type": "multi_chip_conflict",
                    "message": str(e),
                    "conflicts": e.conflicts  # List of conflicting deployments
                }, status=status.HTTP_409_CONFLICT)

            except AllocationError as e:
                logger.warning(f"Allocation failed for {impl.model_name}: {str(e)}")
                return Response({
                    "status": "error",
                    "error_type": "allocation_failed",
                    "message": str(e)
                }, status=status.HTTP_409_CONFLICT)

            BASE_SERVICE_PORT = 7000
            service_port = BASE_SERVICE_PORT + device_id

            # Chat models are deployed via the TT Inference Server (FastAPI) run endpoint.
            # We call it directly here so we can return job_id immediately for progress polling,
            # without requiring docker_utils.py to handle async "job started" responses.
            if impl.model_type == ModelTypes.CHAT:
                board_type = detect_board_type()
                if chips_required == 1:
                    device = _BOARD_TO_SINGLE_CHIP_DEVICE.get(board_type, "cpu")
                else:
                    device = map_board_type_to_device_name(board_type)
                # QB2 Voice/paired-chip path: Llama-3.1-8B with --device-id 0,1
                # should run with --tt-device p300 (not p150).
                if (
                    board_type == "P300Cx2"
                    and _is_llama31_8b_model(impl.model_name)
                    and sorted(device_ids) == [0, 1]
                ):
                    device = "p300"
                # For QB2 (P300Cx2) with the whole-board p300x2 device, the inference
                # server selects the physical chip itself — omit device_id entirely.
                # For slot-pinned p150/p300 mode on QB2, pass device_id so each model
                # lands on its allocated slot(s).
                if board_type == "P300Cx2" and device == "p300x2":
                    inference_device_id = None
                else:
                    inference_device_id = device_ids_str
                # Qwen3-32B on p300x2 exceeds the 50MB default trace region size
                override_tt_config = None
                qwen32b_p300x2 = impl.model_name == "Qwen3-32B" and device == "p300x2"
                if qwen32b_p300x2:
                    override_tt_config = '{"trace_region_size": 53000000}'
                result = start_chat_deployment(
                    model_name=impl.model_name,
                    device=device,
                    device_id=inference_device_id,
                    service_port=service_port,
                    timeout_seconds=30,
                    skip_system_sw_validation=True,
                    override_tt_config=override_tt_config,
                    dev_mode=qwen32b_p300x2,
                )
                if result.status != "success":
                    return Response(
                        {"status": "error", "message": result.message},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
                if not result.job_id:
                    logger.error(
                        f"start_chat_deployment returned status='success' but job_id is None/empty. "
                        f"api_response={result.api_response!r}"
                    )
                    return Response(
                        {
                            "status": "error",
                            "message": "Deployment started but no job_id was returned from TT Inference Server",
                        },
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
                # Create a ModelDeployment record immediately so the chip slot
                # shows IN USE and the allocator tracks this deployment.
                # Use job_id as a placeholder container_id until the real Docker
                # container_id is known (updated in DeploymentProgressView on completion).
                try:
                    from docker_control.models import ModelDeployment
                    ModelDeployment.objects.create(
                        container_id=result.job_id,
                        container_name=impl.model_name,
                        model_name=impl.model_name,
                        device=device,
                        device_id=device_id,
                        device_ids=device_ids,
                        status="starting",
                        port=service_port,
                    )
                except Exception as e:
                    logger.warning(f"Could not create ModelDeployment for chat job {result.job_id}: {e}")
                # Spawn a background thread to poll FastAPI and transition the
                # 'starting' record to 'running' (or 'stopped' on failure).
                # This makes the lifecycle backend-owned so frontends that do
                # not poll DeploymentProgressView (e.g. Voice Agent) still get
                # correct records.
                try:
                    from docker_control.deployment_sync import start_deployment_sync
                    start_deployment_sync(result.job_id)
                except Exception as e:
                    logger.warning(f"Could not start deployment sync for job {result.job_id}: {e}")
                response = {
                    "status": "success",
                    "job_id": result.job_id,
                    "message": result.message or "Deployment started",
                    "api_response": result.api_response or {},
                    "allocated_device_id": device_id,
                }
                return Response(response, status=status.HTTP_201_CREATED)
            else:
                # Continue with deployment using allocated device_id(s) and optional host_port
                host_port = serializer.validated_data.get("host_port")
                response = run_container(impl, weights_id, device_id=device_ids_str, host_port=host_port, use_image_override=use_image_override)

                # Add allocated_device_id to response
                response["allocated_device_id"] = device_id

                # Ensure job_id is set for progress tracking
                # Use job_id from API response, or fallback to container_id or container_name
                if not response.get("job_id"):
                    response["job_id"] = response.get("container_id") or response.get("container_name")

                # Check if deployment failed
                if response.get("status") == "error":
                    logger.error(f"Deployment failed: {response.get('message', 'Unknown error')}")
                    return Response(
                        response,
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )

                # Refresh tt-smi cache after successful deployment
                if response.get("status") == "success":
                    try:
                        SystemResourceService.force_refresh_tt_smi_cache()
                    except Exception as e:
                        logger.warning(f"Failed to refresh tt-smi cache after deployment: {e}")

                return Response(response, status=status.HTTP_201_CREATED)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def _find_workflow_log_for_deployment(deployment) -> str | None:
    """Derive the docker-server workflow log path for a deployment.

    Log files are named: {prefix}_{YYYY-MM-DD}_{HH-MM-SS}_{model_name}_{device}_server.log
    where prefix is typically 'vllm' or 'media' depending on the model type.
    The timestamp in the filename matches deployment.deployed_at in UTC.

    Tries two candidate base directories to handle both Docker-mounted and
    local-run scenarios.  Returns the first path that exists on disk.

    Falls back progressively:
    1. Exact timestamp match (both known prefixes)
    2. Fuzzy timestamp match (model+device, within 300s window)
    3. Most-recent file matching model+device pattern (no timestamp constraint)
    """
    if not deployment.deployed_at:
        return None

    from datetime import datetime, timezone

    dt = deployment.deployed_at  # stored as UTC-aware datetime
    ts = dt.strftime("%Y-%m-%d_%H-%M-%S")
    model = deployment.model_name or ""
    device = deployment.device or ""

    tt_studio_root = backend_config.host_tt_studio_root
    candidate_dirs = [
        Path(tt_studio_root) / ".artifacts" / "tt-inference-server" / "workflow_logs" / "docker_server",
        Path(tt_studio_root) / "tt-inference-server" / "workflow_logs" / "docker_server",
    ]

    # Pass 1: exact timestamp match — try common prefixes (vllm, media, and bare model name)
    for prefix in ("vllm", "media", model.lower()):
        filename = f"{prefix}_{ts}_{model}_{device}_server.log"
        for base in candidate_dirs:
            candidate = base / filename
            if candidate.exists():
                logger.debug(f"Found exact log match for deployment {deployment.id}: {candidate}")
                return str(candidate)

    # Pass 2: fuzzy timestamp match — scan all *_server.log files for model+device,
    # accept the closest one within a 300-second window (increased from 60s to handle
    # slow deployments where the log file is created well after deployed_at is recorded).
    for base in candidate_dirs:
        if not base.is_dir():
            continue
        best = None
        best_delta = None
        for f in base.iterdir():
            if not f.name.endswith("_server.log"):
                continue
            if model not in f.name or device not in f.name:
                continue
            try:
                parts = f.name.split("_")
                # filename: prefix_YYYY-MM-DD_HH-MM-SS_...
                file_ts_str = f"{parts[1]}_{parts[2]}"
                file_dt = datetime.strptime(file_ts_str, "%Y-%m-%d_%H-%M-%S").replace(tzinfo=timezone.utc)
                delta = abs((file_dt - dt).total_seconds())
                if delta <= 300 and (best_delta is None or delta < best_delta):
                    best = f
                    best_delta = delta
            except (IndexError, ValueError):
                continue
        if best:
            logger.debug(
                f"Found fuzzy log match for deployment {deployment.id} "
                f"(delta={best_delta:.0f}s): {best}"
            )
            return str(best)

    # Pass 3: last-resort — return the most-recently modified file that contains both
    # model name and device in its filename, regardless of timestamp.
    for base in candidate_dirs:
        if not base.is_dir():
            continue
        matches = [
            f for f in base.iterdir()
            if f.name.endswith("_server.log") and model in f.name and device in f.name
        ]
        if matches:
            best = max(matches, key=lambda p: p.stat().st_mtime)
            logger.warning(
                f"Using last-resort log match for deployment {deployment.id} "
                f"(no timestamp match found): {best}"
            )
            return str(best)

    logger.warning(
        f"No workflow log found for deployment {deployment.id} "
        f"(model={model!r}, device={device!r}, deployed_at={dt.isoformat()!r})"
    )
    return None


def _sync_chat_deployment_record(job_id: str, progress_data: dict) -> None:
    """Keep the ModelDeployment placeholder record in sync with FastAPI progress.

    On completion: swap the job_id placeholder container_id for the real Docker
    container_id and mark status 'running', then refresh the deploy cache so the
    "Device" column and chip slot visualization reflect the running container.

    On terminal failure: mark the placeholder record as stopped so the chip slot
    is freed immediately.
    """
    job_status = progress_data.get("status")
    try:
        from docker_control.models import ModelDeployment
        dep = ModelDeployment.objects.filter(container_id=job_id).first()
        if dep is None:
            return

        if job_status == "completed":
            real_container_id = progress_data.get("container_id")
            real_container_name = progress_data.get("container_name")
            if real_container_id:
                dep.container_id = real_container_id
                if real_container_name:
                    dep.container_name = real_container_name
                dep.status = "running"
                docker_log_path = progress_data.get("docker_log_file_path")
                if docker_log_path:
                    dep.workflow_log_path = docker_log_path
                dep.save()
                logger.info(
                    f"Updated ModelDeployment for {dep.model_name}: "
                    f"container_id={real_container_id}, status=running, "
                    f"workflow_log_path={dep.workflow_log_path}"
                )
                try:
                    update_deploy_cache()
                except Exception as e:
                    logger.warning(f"Could not refresh deploy cache after chat deployment: {e}")

        elif job_status in ("error", "failed", "cancelled", "timeout"):
            dep.status = "stopped"
            dep.save()
            logger.info(
                f"Marked ModelDeployment for {dep.model_name} as stopped (job status: {job_status})"
            )
    except Exception as e:
        logger.warning(f"_sync_chat_deployment_record failed for job {job_id}: {e}")


class DeploymentProgressView(APIView):
    def get(self, request, job_id, *args, **kwargs):
        """Track deployment progress - proxy FastAPI progress endpoints with fallback"""
        import time

        try:
            logger.info(f"Fetching deployment progress for job_id: {job_id}")

            # Track deployment start time if not already tracked
            if job_id not in deployment_start_times:
                deployment_start_times[job_id] = time.time()

            elapsed_time = time.time() - deployment_start_times[job_id]

            # First, try to get progress from FastAPI inference server
            try:
                fastapi_url = "http://172.18.0.1:8001/run/progress/" + job_id
                response = requests.get(fastapi_url, timeout=5)

                if response.status_code == 200:
                    progress_data = response.json()
                    logger.info(f"Got progress from FastAPI: {progress_data}")

                    # FastAPI reports job_id doesn't exist.
                    # For directly-deployed models (e.g. face-recognition), the job_id IS the
                    # container ID and FastAPI never tracked the job. Fall through to the
                    # container-based tracking below so those deployments can reach "completed".
                    if progress_data.get("status") == "not_found":
                        pass  # Fall through to container-based tracking

                    # Normalize 'stalled' status to 'running' with appropriate message
                    # 'stalled' typically means downloading weights, which can take hours
                    if progress_data.get("status") == "stalled":
                        # Check if we've exceeded the 5-hour timeout
                        if elapsed_time > DEPLOYMENT_TIMEOUT_SECONDS:
                            progress_data["status"] = "timeout"
                            progress_data["message"] = f"Deployment timeout after {int(elapsed_time/60)} minutes"
                            # Clean up start time tracking
                            if job_id in deployment_start_times:
                                del deployment_start_times[job_id]
                        else:
                            # Still within timeout - treat as running with descriptive message
                            progress_data["status"] = "running"
                            progress_data["message"] = "Downloading model weights... (this may take several hours for large models)"

                    # Check timeout for other running statuses
                    elif progress_data.get("status") in ["starting", "running"]:
                        if elapsed_time > DEPLOYMENT_TIMEOUT_SECONDS:
                            progress_data["status"] = "timeout"
                            progress_data["message"] = f"Deployment timeout after {int(elapsed_time/60)} minutes"
                            # Clean up start time tracking
                            if job_id in deployment_start_times:
                                del deployment_start_times[job_id]

                    # Clean up start time tracking on terminal statuses
                    elif progress_data.get("status") in ["completed", "error", "failed", "cancelled"]:
                        if job_id in deployment_start_times:
                            del deployment_start_times[job_id]

                    # Sync ModelDeployment record for chat models tracked by job_id
                    _sync_chat_deployment_record(job_id, progress_data)

                    # Add support for new status types
                    # Note: "not_found" is intentionally excluded here so direct-deploy models
                    # (e.g. face-recognition) fall through to container-based tracking below.
                    if progress_data.get("status") in ["starting", "running", "completed", "error", "failed", "timeout", "cancelled", "retrying"]:
                        return Response(progress_data, status=status.HTTP_200_OK)

                logger.info(f"FastAPI progress not available (status: {response.status_code}), falling back to container-based progress")

            except requests.exceptions.RequestException as e:
                logger.info(f"FastAPI not available ({str(e)}), falling back to container-based progress")
            
            # Fallback: existing container-based progress tracking
            # elapsed_time already calculated above
            
            # job_id is container_id or container_name
            # Try to get container by ID first, then by name
            container = None
            try:
                # Try to get container via docker-control-service
                docker_client = get_docker_client()
                container_data = docker_client.get_container(job_id)
                # The response status is the Docker container status (e.g. "running", "exited"),
                # or "error" if the container was not found. A valid container has an "id" field.
                if container_data.get("status") != "error" and container_data.get("id"):
                    # Create container-like object for compatibility
                    class ContainerWrapper:
                        def __init__(self, data):
                            self.id = data.get("id")
                            self.name = data.get("name")
                            self.status = data.get("status")
                            self.attrs = data.get("attrs", {})
                    container = ContainerWrapper(container_data)
            except Exception as e:
                logger.warning(f"Error getting container {job_id}: {str(e)}")

            # Container not found - deployment in early stages
            # Map to actual FastAPI log stages with realistic timing
            if not container:
                logger.info(f"Container {job_id} not found yet - deployment in progress (elapsed: {elapsed_time:.1f}s)")

                # Check for timeout
                if elapsed_time > DEPLOYMENT_TIMEOUT_SECONDS:
                    # Clean up start time tracking
                    if job_id in deployment_start_times:
                        del deployment_start_times[job_id]
                    return Response(
                        {
                            "status": "timeout",
                            "stage": "error",
                            "progress": 0,
                            "message": f"Deployment timeout after {int(elapsed_time/60)} minutes"
                        },
                        status=status.HTTP_200_OK
                    )

                # Based on FastAPI logs - realistic timing for each stage
                if elapsed_time < 3:
                    progress = 5
                    stage = "initialization"
                    message = "Loading environment files..."  # fastapi.log (13-14)
                elif elapsed_time < 8:
                    progress = 15
                    stage = "setup"
                    message = "Running workflow configuration..."  # fastapi.log (19-27)
                elif elapsed_time < 15:
                    progress = 25
                    stage = "model_preparation"
                    message = "Checking model setup and weights..."  # fastapi.log (83-91)
                elif elapsed_time < 25:
                    progress = 40
                    stage = "model_preparation"
                    message = "Downloading model weights (if needed)..."
                elif elapsed_time < 35:
                    progress = 55
                    stage = "container_setup"
                    message = "Preparing Docker configuration..."  # fastapi.log (100-113)
                elif elapsed_time < 45:
                    progress = 70
                    stage = "container_setup"
                    message = "Starting Docker container..."
                else:
                    # If taking longer than expected, show downloading/waiting state
                    # For very long operations (hours), show a more informative message
                    progress = min(75, 70 + int((elapsed_time - 45) / 10 * 5))
                    stage = "model_preparation"
                    if elapsed_time > 300:  # After 5 minutes, assume downloading weights
                        message = "Downloading model weights... (this may take several hours for large models)"
                    else:
                        message = "Waiting for container to initialize..."

                return Response(
                    {
                        "status": "running",
                        "stage": stage,
                        "progress": progress,
                        "message": message
                    },
                    status=status.HTTP_200_OK
                )
            
            # Container found - check its status and network connectivity
            container_status = container.status
            container_attrs = container.attrs
            networks = container_attrs.get("NetworkSettings", {}).get("Networks", {})
            container_name = container.name
            
            # Determine progress based on container state
            progress = 0
            stage = "container_setup"
            message = "Container found..."
            status_value = "running"
            
            if container_status == "created":
                # Container created but not running yet
                progress = 80
                stage = "container_setup"
                message = "Container created, starting services..."
            elif container_status == "restarting":
                progress = 82
                stage = "container_setup"
                message = "Container restarting..."
            elif container_status == "running":
                # Container is running - check network and finalization status
                if "tt_studio_network" in networks:
                    # Detect direct-deploy: job_id IS the container's own Docker ID.
                    # This applies to models like face-recognition that bypass FastAPI and
                    # are launched synchronously via docker-control-service. Their container
                    # is fully up by the time the first progress poll arrives.
                    container_id_str = container.id or ""
                    is_direct_deploy_by_id = (
                        job_id == container_id_str
                        or container_id_str.startswith(job_id)
                        or (len(job_id) >= 12 and container_id_str.startswith(job_id[:12]))
                    )

                    # FastAPI-deployed LLM containers start with a random Docker name
                    # (e.g. "romantic_khorana") and get renamed to the model name as the
                    # final step. The name-based check detects that rename for those models.
                    is_fastapi_deploy_complete = (
                        any(part in container_name.lower() for part in ['llama', 'instruct', 'model'])
                        or '-' not in container_name
                    )

                    if is_direct_deploy_by_id or is_fastapi_deploy_complete:
                        progress = 100
                        stage = "complete"
                        message = "Deployment complete!"
                        status_value = "completed"
                        if job_id in deployment_start_times:
                            del deployment_start_times[job_id]
                    else:
                        # On network but not renamed yet (FastAPI LLM deploy in progress)
                        progress = 95
                        stage = "finalizing"
                        message = "Finalizing container setup..."
                else:
                    # Running but not on network yet
                    progress = 85
                    stage = "finalizing"
                    message = "Connecting container to network..."
            elif container_status == "paused":
                progress = 85
                stage = "container_setup"
                message = "Container paused, resuming..."
            elif container_status == "exited":
                # Check exit code
                exit_code = container_attrs.get("State", {}).get("ExitCode", 0)
                if exit_code == 0:
                    # Successful completion
                    progress = 100
                    stage = "complete"
                    message = "Deployment completed successfully!"
                    status_value = "completed"
                    # Clean up start time tracking
                    if job_id in deployment_start_times:
                        del deployment_start_times[job_id]
                else:
                    # Failed with error
                    status_value = "error"
                    stage = "error"
                    message = f"Container failed with exit code {exit_code}"
                    progress = 0
                    # Clean up start time tracking
                    if job_id in deployment_start_times:
                        del deployment_start_times[job_id]
            elif container_status == "dead":
                status_value = "error"
                stage = "error"
                message = "Container failed to start properly"
                progress = 0
                # Clean up start time tracking
                if job_id in deployment_start_times:
                    del deployment_start_times[job_id]
            
            progress_data = {
                "status": status_value,
                "stage": stage,
                "progress": progress,
                "message": message,
                "container_status": container_status,
                "container_name": container_name
            }
            
            logger.info(f"Progress data: {progress_data} (elapsed: {elapsed_time:.1f}s, networks: {list(networks.keys())})")
            return Response(progress_data, status=status.HTTP_200_OK)

        except Exception as e:
            # Container not found or error - use time-based progress for early stages
            elapsed_time = time.time() - deployment_start_times.get(job_id, time.time())
            if elapsed_time < 0:
                elapsed_time = 0
            
            # Map to actual log stages
            if elapsed_time < 3:
                progress = 5
                stage = "initialization"
                message = "Loading environment files..."
            elif elapsed_time < 8:
                progress = 15
                stage = "setup"
                message = "Running workflow configuration..."
            elif elapsed_time < 15:
                progress = 25
                stage = "model_preparation"
                message = "Checking model setup..."
            else:
                progress = min(55, 25 + int((elapsed_time - 15) / 20 * 30))
                stage = "container_setup"
                message = "Preparing Docker container..."
            
            logger.info(f"Container {job_id} not found - deployment in progress (elapsed: {elapsed_time:.1f}s)")
            return Response(
                {
                    "status": "running",
                    "stage": stage,
                    "progress": progress,
                    "message": message
                },
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Error fetching progress: {str(e)}")
            return Response(
                {"status": "error", "message": f"Docker API error: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
            logger.error(f"Unexpected error in DeploymentProgressView: {str(e)}", exc_info=True)
            return Response(
                {"status": "error", "message": f"Internal server error: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DeploymentLogsView(APIView):
    def get(self, request, job_id, *args, **kwargs):
        """Get deployment logs from FastAPI inference server"""
        try:
            logger.info(f"Fetching deployment logs for job_id: {job_id}")
            
            # Try to get logs from FastAPI inference server
            try:
                fastapi_url = f"http://172.18.0.1:8001/run/logs/{job_id}"
                response = requests.get(fastapi_url, timeout=5)
                
                if response.status_code == 200:
                    logs_data = response.json()
                    logger.info(f"Got logs from FastAPI: {logs_data.get('total_messages', 0)} messages")
                    return Response(logs_data, status=status.HTTP_200_OK)
                
                logger.warning(f"FastAPI logs not available (status: {response.status_code})")
                return Response(
                    {"job_id": job_id, "logs": [], "total_messages": 0, "error": "Logs not available"},
                    status=status.HTTP_404_NOT_FOUND
                )
                
            except requests.exceptions.RequestException as e:
                logger.error(f"Error fetching logs from FastAPI: {str(e)}")
                return Response(
                    {"job_id": job_id, "logs": [], "total_messages": 0, "error": f"Failed to fetch logs: {str(e)}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                
        except Exception as e:
            logger.error(f"Unexpected error in DeploymentLogsView: {str(e)}", exc_info=True)
            return Response(
                {"job_id": job_id, "logs": [], "total_messages": 0, "error": f"Internal server error: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DeploymentProgressStreamView(APIView):
    """Stream deployment progress updates from FastAPI inference server via SSE"""
    
    def get(self, request, job_id, *args, **kwargs):
        """Proxy SSE stream from FastAPI inference server"""
        
        def event_stream():
            """Generator that forwards SSE events from FastAPI to frontend"""
            try:
                # Connect to FastAPI inference server SSE endpoint
                fastapi_url = f"http://172.18.0.1:8001/run/stream/{job_id}"
                logger.info(f"Connecting to FastAPI SSE endpoint: {fastapi_url}")
                
                # Stream the response
                response = requests.get(fastapi_url, stream=True, timeout=300)
                
                if response.status_code != 200:
                    logger.error(f"FastAPI SSE endpoint returned status {response.status_code}")
                    error_data = {
                        "status": "error",
                        "message": f"SSE endpoint not available (status: {response.status_code})"
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"
                    return
                
                logger.info(f"Successfully connected to FastAPI SSE for job {job_id}")
                
                # Forward all SSE events from FastAPI to frontend
                for line in response.iter_lines():
                    if line:
                        line_str = line.decode('utf-8')
                        # Forward the line as-is
                        yield f"{line_str}\n"
                        
                        # Check if this is the end of the stream
                        if line_str.startswith('data: '):
                            try:
                                data = json.loads(line_str[6:])  # Remove 'data: ' prefix
                                if data.get('status') in ['completed', 'error', 'failed', 'cancelled']:
                                    logger.info(f"Stream ended for job {job_id} with status {data.get('status')}")
                                    break
                            except json.JSONDecodeError:
                                pass
                    else:
                        # Empty line - part of SSE format
                        yield "\n"
                        
            except requests.exceptions.RequestException as e:
                logger.error(f"Error connecting to FastAPI SSE endpoint: {str(e)}")
                error_data = {
                    "status": "error",
                    "message": f"Connection error: {str(e)}"
                }
                yield f"data: {json.dumps(error_data)}\n\n"
            except Exception as e:
                logger.error(f"Unexpected error in SSE stream: {str(e)}", exc_info=True)
                error_data = {
                    "status": "error",
                    "message": f"Stream error: {str(e)}"
                }
                yield f"data: {json.dumps(error_data)}\n\n"
        
        # Return streaming response with proper SSE headers
        response = StreamingHttpResponse(
            event_stream(),
            content_type='text/event-stream'
        )
        response['Cache-Control'] = 'no-cache'
        response['Connection'] = 'keep-alive'
        response['X-Accel-Buffering'] = 'no'
        
        return response


class RedeployView(APIView):
    def post(self, request, *args, **kwargs):
        # TODO: stop existing container by container_id, get model_id
        serializer = DeploymentSerializer(data=request.data)
        if serializer.is_valid():
            impl_id = request.data.get("model_id")
            weights_id = request.data.get("weights_id")
            impl = model_implmentations[impl_id]
            response = run_container(impl, weights_id)
            
            # Refresh tt-smi cache after successful redeployment
            if response.get("status") == "success":
                try:
                    SystemResourceService.force_refresh_tt_smi_cache()
                except Exception as e:
                    logger.warning(f"Failed to refresh tt-smi cache after redeployment: {e}")
                    
            return Response(response, status=status.HTTP_201_CREATED)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ResetBoardView(APIView):
    def post(self, request, *args, **kwargs):
        try:
            # Perform the reset
            reset_response = perform_reset()

            # Determine the HTTP status based on the reset_response
            if reset_response.get("status") == "error":
                error_message = reset_response.get(
                    "message", "An error occurred during reset."
                )
                http_status = reset_response.get(
                    "http_status", status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                return Response(
                    {"status": "error", "message": error_message}, status=http_status
                )

            # If successful, return a 200 OK with the output
            output = reset_response.get("output", "Board reset successfully.")
            warnings = reset_response.get("warnings", [])
            if warnings:
                warning_block = "Warnings during device detection:\n" + "\n".join(warnings) + "\n\n"
                output = warning_block + output
            return StreamingHttpResponse(
                output, content_type="text/plain", status=status.HTTP_200_OK
            )

        except Exception as e:
            logger.exception("Exception occurred during reset operation.")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ResetDeviceView(APIView):
    """Reset a single chip/device using tt-smi -r <device_id>."""

    def post(self, request, device_id, *args, **kwargs):
        try:
            reset_response = perform_device_reset(device_id)

            if reset_response.get("status") == "error":
                error_message = reset_response.get(
                    "message", f"An error occurred during device {device_id} reset."
                )
                http_status = reset_response.get(
                    "http_status", status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                return Response(
                    {"status": "error", "message": error_message}, status=http_status
                )

            output = reset_response.get("output", f"Device {device_id} reset successfully.")
            return StreamingHttpResponse(
                output, content_type="text/plain", status=status.HTTP_200_OK
            )

        except Exception as e:
            logger.exception(f"Exception occurred during device {device_id} reset operation.")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ImageStatusView(APIView):
    def get(self, request, model_id):
        try:
            logger.info(f"Checking image status for model_id: {model_id}")
            impl = model_implmentations[model_id]
            image_name, image_tag = impl.image_version.split(':')
            logger.info(f"Checking status for image: {image_name}:{image_tag}")
            image_status = check_image_exists(image_name, image_tag)
            logger.info(f"Image status result: {image_status}")
            image_status['pull_in_progress'] = False
            return Response(image_status, status=status.HTTP_200_OK)
        except KeyError:
            logger.warning(f"Model {model_id} not found in model_implementations")
            return Response(
                {"status": "error", "message": f"Model {model_id} not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f"Error checking image status: {str(e)}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


@method_decorator(csrf_exempt, name='dispatch')
class ModelCatalogView(APIView):
    """
    Model catalog management API that handles:
    - Model ejection (removal)
    - Space usage checking
    - Model status and metadata

    Note: Docker image pulling is now handled automatically by TT Inference Server
    during deployment via ensure_docker_image() function.
    """
    renderer_classes = [JSONRenderer]  # Allow JSON renderer to prevent content negotiation issues
    
    def options(self, request, *args, **kwargs):
        """Handle preflight requests for CORS"""
        response = Response(status=status.HTTP_200_OK)
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'GET, DELETE, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Content-Type, Accept, Authorization'
        response['Access-Control-Max-Age'] = '86400'
        return response
    
    def get(self, request, *args, **kwargs):
        """Get catalog status including available models, disk space, and pull status"""
        try:
            logger.info("Getting catalog status")
            # Get disk space info
            disk_usage = {}
            for impl_id, impl in model_implmentations.items():
                volume_path = impl.volume_path
                if volume_path.exists():
                    total, used, free = shutil.disk_usage(volume_path)
                    disk_usage[impl_id] = {
                        "total_gb": total / (1024**3),
                        "used_gb": used / (1024**3),
                        "free_gb": free / (1024**3)
                    }
                    logger.info(f"Disk usage for {impl_id}: {disk_usage[impl_id]}")
            
            # Get model status
            model_status = {}
            for impl_id, impl in model_implmentations.items():
                image_name, image_tag = impl.image_version.split(':')
                logger.info(f"Checking status for model {impl_id}: {image_name}:{image_tag}")
                image_status = check_image_exists(image_name, image_tag)
                model_status[impl_id] = {
                    "model_name": impl.model_name,
                    "model_type": impl.model_type.value,
                    "image_version": impl.image_version,
                    "exists": image_status["exists"],
                    "size": image_status["size"],
                    "status": image_status["status"],
                    "disk_usage": disk_usage.get(impl_id, None)
                }
                logger.info(f"Status for model {impl_id}: {model_status[impl_id]}")
            
            logger.info("Successfully retrieved catalog status")
            return Response({
                "status": "success",
                "models": model_status
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error getting catalog status: {str(e)}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def delete(self, request, *args, **kwargs):
        """Eject (remove) a model"""
        try:
            model_id = request.data.get("model_id")
            logger.info(f"Received request to eject model: {model_id}")
            
            if not model_id or model_id not in model_implmentations:
                logger.warning(f"Invalid model_id provided: {model_id}")
                return Response(
                    {"status": "error", "message": f"Invalid model_id: {model_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            impl = model_implmentations[model_id]
            image_name, image_tag = impl.image_version.split(':')
            logger.info(f"Attempting to remove image: {image_name}:{image_tag}")

            # Remove the image via docker-control-service
            try:
                docker_client = get_docker_client()
                result = docker_client.remove_image(image_name, image_tag, force=True)
                if result.get("status") == "success":
                    logger.info(f"Successfully removed image: {image_name}:{image_tag}")
                else:
                    raise Exception(result.get("message", "Unknown error"))
                logger.info(f"Successfully removed image: {image_name}:{image_tag}")
                
                # Remove volume if it exists
                volume_path = impl.volume_path
                if volume_path.exists():
                    logger.info(f"Removing volume at path: {volume_path}")
                    shutil.rmtree(volume_path)
                    logger.info(f"Successfully removed volume for model {model_id}")
                
                return Response({
                    "status": "success",
                    "message": f"Successfully removed model {model_id}"
                }, status=status.HTTP_200_OK)

            except Exception as e:
                logger.warning(f"Image {image_name}:{image_tag} not found: {str(e)}")
                return Response({
                    "status": "error",
                    "message": f"Image {image_name}:{image_tag} not found"
                }, status=status.HTTP_404_NOT_FOUND)
                
        except Exception as e:
            logger.error(f"Error ejecting model: {str(e)}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

@method_decorator(csrf_exempt, name='dispatch')
class BoardInfoView(APIView):
    """
    API endpoint to provide board information to the frontend.
    This helps the frontend filter models based on board compatibility.
    """
    def get(self, request, *args, **kwargs):
        try:
            # Detect board type using tt-smi command
            board_type = detect_board_type()
            logger.info(f"BoardInfoView detected board type: {board_type}")
            
            # Map board types to friendly names
            board_name_map = {
                # Wormhole devices
                'N150': 'Tenstorrent N150',
                'N300': 'Tenstorrent N300',
                'E150': 'Tenstorrent E150',
                
                # Wormhole multi-device
                'N150X4': 'Tenstorrent N150x4',
                'T3000': 'Tenstorrent T3000',
                'T3K': 'Tenstorrent T3K',
                
                # Blackhole devices
                'P100': 'Tenstorrent P100',
                'P150': 'Tenstorrent P150',
                'P300c': 'Tenstorrent P300c',
                
                # Blackhole multi-device
                'P150X4': 'Tenstorrent P150x4',
                'P150X8': 'Tenstorrent P150x8',
                'P300Cx2': 'Tenstorrent P300Cx2',  # 2 cards (4 chips)
                'P300Cx4': 'Tenstorrent P300Cx4',  # 4 cards (8 chips)
                
                # Galaxy systems
                'GALAXY': 'Tenstorrent Galaxy',
                'GALAXY_T3K': 'Tenstorrent Galaxy T3K',
                
                'unknown': 'Unknown Board'
            }
            board_name = board_name_map.get(board_type, 'Unknown Board')
            
            return Response({
                'type': board_type,
                'name': board_name
            }, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error getting board info: {str(e)}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

@method_decorator(csrf_exempt, name='dispatch')
class DockerServiceLogsView(APIView):
    """Get recent logs from Docker services for bug reporting"""
    
    def get(self, request, *args, **kwargs):
        try:
            logger.info("Fetching Docker service logs for bug report")
            
            # Build logs for all TT Studio containers dynamically (backend, frontend, agent, chroma)
            # and include any that look like part of the stack, regardless of exact name
            logs_data = {}
            docker_logs_found = False

            try:
                def classify_service(container) -> str:
                    name = (container.name or "").lower()
                    image = (container.image.tags[0] if container.image.tags else container.image.short_id).lower()
                    candidates = name + " " + image
                    if "backend" in candidates:
                        return "tt_studio_backend"
                    if "frontend" in candidates:
                        return "tt_studio_frontend"
                    if "agent" in candidates:
                        return "tt_studio_agent"
                    if "chroma" in candidates:
                        return "tt_studio_chroma"
                    if "tt-studio" in candidates or "tt_studio" in candidates:
                        return "tt_studio_other"
                    return "other"

                # Get containers via docker-control-service
                docker_client = get_docker_client()
                containers_data = docker_client.list_containers(all=True)

                # Convert to container-like objects
                class ContainerWrapper:
                    def __init__(self, data):
                        self.id = data.get("id")
                        self.name = data.get("name")
                        self.status = data.get("status")
                        self.attrs = data.get("attrs", {})
                        self.image = type('obj', (object,), {
                            'tags': data.get("image_tags", [])
                        })()
                    def logs(self, tail=200, timestamps=False):
                        # This is a stub - docker-control-service doesn't support logs yet
                        return b"Logs not available via docker-control-service"

                containers = [ContainerWrapper(c) for c in containers_data.get("containers", [])]

                service_to_containers = {}
                for c in containers:
                    service = classify_service(c)
                    if service == "other":
                        continue
                    service_to_containers.setdefault(service, []).append(c)

                def fetch_logs_for_container(container) -> str:
                    try:
                        raw = container.logs(tail=200, timestamps=False)
                        txt = raw.decode('utf-8', errors='replace').strip()
                        if len(txt) > 2000:
                            txt = txt[-2000:] + "\n\n... (truncated)"
                        header = f"Container {container.name} ({container.id[:12]})\n"
                        return header + txt
                    except Exception as e:
                        return f"Container {container.name}: Failed to fetch logs: {str(e)[:500]}"

                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                    futures = {}
                    for service, conts in service_to_containers.items():
                        for c in conts:
                            futures[executor.submit(fetch_logs_for_container, c)] = (service, c.name)

                    combined: dict[str, list[str]] = {}
                    for future in concurrent.futures.as_completed(futures):
                        service, _ = futures[future]
                        try:
                            content = future.result()
                            combined.setdefault(service, []).append(content)
                            if content and "Failed to fetch" not in content and "No logs" not in content:
                                docker_logs_found = True
                        except Exception as e:
                            combined.setdefault(service, []).append(f"Unexpected error: {str(e)[:500]}")

                # Flatten combined results to string blocks
                for service, blocks in combined.items():
                    title = service
                    logs_data[title] = "\n\n".join(blocks)

            except Exception as e:
                logger.error(f"Error initializing or fetching Docker logs: {str(e)}")
                logs_data["docker"] = f"Docker client error: {str(e)[:500]}"
            
            if not docker_logs_found:
                if not logs_data:
                    logs_data["docker"] = "Docker logs not accessible from container"
            
            # Also try to get system logs if available
            try:
                # Check if fastapi.log exists in multiple possible locations using relative paths
                possible_fastapi_logs = [
                    "fastapi.log",  # Current directory
                    os.path.join(os.getcwd(), "fastapi.log"),  # Current working directory
                    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "fastapi.log"),  # Go up from backend/docker_control/views.py
                    os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "fastapi.log"),  # Relative to backend directory
                    os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "..", "fastapi.log"),  # Two levels up from backend
                    "/app/fastapi.log",  # Container path as fallback
                ]
                
                fastapi_log_found = False
                for fastapi_log_path in possible_fastapi_logs:
                    if os.path.exists(fastapi_log_path):
                        try:
                            with open(fastapi_log_path, 'r') as f:
                                lines = f.readlines()
                                # Get last 8 lines and limit size
                                log_content = ''.join(lines[-8:])
                                if len(log_content) > 800:
                                    log_content = log_content[-800:] + "\n\n... (truncated)"
                                logs_data["fastapi"] = log_content
                            fastapi_log_found = True
                            break
                        except Exception as read_error:
                            logger.error(f"Error reading {fastapi_log_path}: {str(read_error)}")
                            continue
                
                if not fastapi_log_found:
                    logs_data["fastapi"] = "fastapi.log not accessible from container (logs available from Docker containers above)"
                    
            except Exception as e:
                logger.error(f"Error reading fastapi.log: {str(e)}")
                logs_data["fastapi"] = f"Error reading fastapi.log: {str(e)[:500]}"
            
            # Try to get backend log file if available
            try:
                # Try multiple possible paths for backend logs
                possible_backend_log_paths = [
                    os.path.join(os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/path/to/fallback"), "backend_volume", "python_logs"),
                    os.path.join(os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/path/to/fallback"), "python_logs"),
                    "/tt_studio_persistent_volume/backend_volume/python_logs",
                    "/tt_studio_persistent_volume/python_logs"
                ]
                
                backend_log_found = False
                for backend_log_path in possible_backend_log_paths:
                    if os.path.exists(backend_log_path):
                        try:
                            # Get the most recent log file
                            log_files = [f for f in os.listdir(backend_log_path) if f.endswith('.log')]
                            if log_files:
                                latest_log = max(log_files, key=lambda x: os.path.getctime(os.path.join(backend_log_path, x)))
                                latest_log_path = os.path.join(backend_log_path, latest_log)
                                with open(latest_log_path, 'r') as f:
                                    lines = f.readlines()
                                    # Get last 8 lines and limit size
                                    log_content = ''.join(lines[-8:])
                                    if len(log_content) > 800:
                                        log_content = log_content[-800:] + "\n\n... (truncated)"
                                    logs_data["backend_log"] = log_content
                                backend_log_found = True
                                break
                        except Exception as read_error:
                            logger.error(f"Error reading from {backend_log_path}: {str(read_error)}")
                            continue
                
                if not backend_log_found:
                    logs_data["backend_log"] = "Backend logs directory not found in any expected location"
                    
            except Exception as e:
                logger.error(f"Error reading backend logs: {str(e)}")
                logs_data["backend_log"] = f"Error reading backend logs: {str(e)[:500]}"
            
            # Add a summary of total log size
            total_size = sum(len(str(logs)) for logs in logs_data.values())
            logs_data["_summary"] = f"Total log size: {total_size} characters"
            
            return Response(logs_data, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching Docker service logs: {str(e)}")
            return Response(
                {"error": "Failed to fetch Docker service logs", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ContainerEventsView(APIView):
    """Server-Sent Events stream for container death notifications"""
    
    def get(self, request):
        """Stream container death events to frontend"""
        import time
        from docker_control.models import ModelDeployment
        
        def event_stream():
            """Generator that yields SSE-formatted events"""
            # Keep track of last check time
            last_check = {}
            
            # Send initial connection message
            yield f"data: {json.dumps({'event': 'connected', 'message': 'Container events stream connected'})}\n\n"
            
            while True:
                try:
                    # Check for containers that died since last check
                    recent_deaths = ModelDeployment.objects.filter(
                        status__in=['exited', 'dead'],
                        stopped_by_user=False
                    ).order_by('-stopped_at')[:10]  # Get last 10 unexpected deaths
                    
                    for deployment in recent_deaths:
                        # Only send if we haven't sent this one before
                        if deployment.container_id not in last_check or last_check[deployment.container_id] != deployment.stopped_at:
                            event_data = {
                                'event': 'container_died',
                                'container_id': deployment.container_id,
                                'container_name': deployment.container_name,
                                'model_name': deployment.model_name,
                                'device': deployment.device,
                                'status': deployment.status,
                                'stopped_at': deployment.stopped_at.isoformat() if deployment.stopped_at else None
                            }
                            yield f"data: {json.dumps(event_data)}\n\n"
                            last_check[deployment.container_id] = deployment.stopped_at
                    
                    # Send heartbeat every 30 seconds
                    yield f"data: {json.dumps({'event': 'heartbeat', 'timestamp': time.time()})}\n\n"
                    
                    # Wait before next check
                    time.sleep(30)
                    
                except Exception as e:
                    logger.error(f"Error in SSE stream: {e}")
                    yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
                    break
        
        response = StreamingHttpResponse(
            event_stream(),
            content_type='text/event-stream'
        )
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'
        return response


class DeploymentHistoryView(APIView):
    """Get deployment history from database"""
    
    def get(self, request):
        """Return all deployments ordered by most recent first"""
        try:
            from docker_control.models import ModelDeployment
            
            # Get all deployments, ordered by most recent first
            deployments = ModelDeployment.objects.all().order_by('-deployed_at')
            
            # Serialize the data, lazily backfilling workflow_log_path when missing
            deployment_data = []
            for deployment in deployments:
                if not deployment.workflow_log_path:
                    logger.debug(
                        f"Attempting lazy backfill for deployment {deployment.id} "
                        f"({deployment.model_name}, deployed_at={deployment.deployed_at})"
                    )
                    found_path = _find_workflow_log_for_deployment(deployment)
                    if found_path:
                        logger.info(
                            f"Backfilled workflow_log_path for deployment {deployment.id}: {found_path}"
                        )
                        deployment.workflow_log_path = found_path
                        try:
                            deployment.save()
                        except Exception as save_err:
                            logger.warning(f"Could not save workflow_log_path for deployment {deployment.id}: {save_err}")

                deployment_data.append({
                    'id': deployment.id,
                    'container_id': deployment.container_id,
                    'container_name': deployment.container_name,
                    'model_name': deployment.model_name,
                    'device': deployment.device,
                    'device_id': deployment.device_id,
                    'deployed_at': deployment.deployed_at.isoformat() if deployment.deployed_at else None,
                    'stopped_at': deployment.stopped_at.isoformat() if deployment.stopped_at else None,
                    'status': deployment.status,
                    'stopped_by_user': deployment.stopped_by_user,
                    'port': deployment.port,
                    'workflow_log_path': deployment.workflow_log_path,
                })
            
            return Response({
                'status': 'success',
                'deployments': deployment_data,
                'count': len(deployment_data)
            }, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching deployment history: {e}")
            return Response(
                {'status': 'error', 'message': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DiscoverContainersView(APIView):
    """List running containers NOT already on tt_studio_network (candidates for registration)."""

    # Container name prefixes that belong to the TT Studio infrastructure itself
    _INFRA_PREFIXES = ("tt_studio_", "tt-studio-", "tt_studio-", "docker-control")

    def get(self, request, *args, **kwargs):
        try:
            docker_client = get_docker_client()
            response = docker_client.list_containers(all=False)
            containers_list = response.get("containers", []) if isinstance(response, dict) else []

            network_name = backend_config.docker_bridge_network_name
            results = []

            for c in containers_list:
                name = c.get("name", "")
                # Skip TT Studio infrastructure containers
                if any(name.startswith(p) or name.lower().startswith(p) for p in self._INFRA_PREFIXES):
                    continue

                # Skip containers already on tt_studio_network
                networks = c.get("NetworkSettings", {}).get("Networks", {})
                if not networks:
                    networks = c.get("networks", {})
                if network_name in networks:
                    continue

                # Extract port bindings
                port_bindings = c.get("NetworkSettings", {}).get("Ports", {})
                if not port_bindings:
                    port_bindings = c.get("port_bindings", {})

                results.append({
                    "id": c.get("id", ""),
                    "name": name,
                    "image": c.get("Config", {}).get("Image", c.get("image", "")),
                    "status": c.get("status", ""),
                    "port_bindings": port_bindings or {},
                })

            return Response(results, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error discovering containers: {e}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class RegisterExternalModelView(APIView):
    """Register an external Docker container with TT Studio."""

    # Default service routes by model type
    _DEFAULT_ROUTES = {
        "chat": "/v1/chat/completions",
        "vlm": "/v1/chat/completions",
        "embedding": "/v1/chat/completions",
        "tts": "/v1/audio/speech",
        "speech_recognition": "/v1/audio/transcriptions",
        "image_generation": "/v1/images/generations",
        "video_generation": "/v1/chat/completions",
        "object_detection": "/v1/chat/completions",
        "cnn": "/v1/chat/completions",
    }

    def post(self, request, *args, **kwargs):
        try:
            data = request.data
            container_id = data.get("container_id")
            model_type = data.get("model_type", "").lower()
            model_name = data.get("model_name", "").strip()
            hf_model_id = data.get("hf_model_id", "").strip() or None
            service_port = data.get("service_port", 7000)
            service_route = data.get("service_route", "").strip() or None
            health_route = data.get("health_route", "").strip() or "/health"
            device_id = data.get("device_id", 0)
            chips_required = data.get("chips_required", 1)

            # Normalise device_id / chips_required to int
            try:
                device_id = int(device_id)
            except (TypeError, ValueError):
                device_id = 0
            try:
                chips_required = int(chips_required)
            except (TypeError, ValueError):
                chips_required = 1

            # --- Validate required fields ---
            if not container_id or not model_type or not model_name:
                return Response(
                    {"status": "error", "message": "container_id, model_type, and model_name are required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if model_type not in self._DEFAULT_ROUTES and model_type != "mock":
                valid_types = ", ".join(sorted(self._DEFAULT_ROUTES.keys()))
                return Response(
                    {"status": "error", "message": f"Invalid model_type '{model_type}'. Valid types: {valid_types}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # --- Validate device_id against chip slot availability ---
            try:
                from docker_control.chip_allocator import ChipSlotAllocator, AllocationError, MultiChipConflictError

                allocator = ChipSlotAllocator()
                chip_status = allocator.get_chip_status()
                total_slots = chip_status.get("total_slots", 1)

                if chips_required >= 4:
                    # Multi-chip: all slots (0-3) must be free
                    occupied_slots = [
                        s for s in chip_status.get("slots", []) if s.get("status") == "occupied"
                    ]
                    if occupied_slots:
                        occupied_names = ", ".join(
                            f"slot {s['slot_id']} ({s.get('model_name', 'unknown')})"
                            for s in occupied_slots
                        )
                        return Response(
                            {
                                "status": "error",
                                "message": f"Multi-chip model requires all chip slots to be free. Currently occupied: {occupied_names}.",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    device_id = 0  # Multi-chip always registers on slot 0
                else:
                    # Single-chip: validate the selected slot is in range and free
                    if device_id < 0 or device_id >= total_slots:
                        return Response(
                            {
                                "status": "error",
                                "message": f"Invalid device_id {device_id}. Must be 0–{total_slots - 1}.",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    slot_info = next(
                        (s for s in chip_status.get("slots", []) if s.get("slot_id") == device_id),
                        None,
                    )
                    if slot_info and slot_info.get("status") == "occupied":
                        occupying = slot_info.get("model_name", "another model")
                        return Response(
                            {
                                "status": "error",
                                "message": f"Chip slot {device_id} is already occupied by '{occupying}'. Choose a different slot.",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
            except ImportError:
                logger.warning("ChipSlotAllocator not available; skipping device_id validation")

            corrections = []

            # --- Verify container exists and is running ---
            docker_client = get_docker_client()
            try:
                container_info = docker_client.get_container(container_id)
            except Exception:
                return Response(
                    {"status": "error", "message": f"Container '{container_id}' not found or not accessible."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            container_status = container_info.get("status", "")
            if "running" not in container_status.lower():
                return Response(
                    {"status": "error", "message": f"Container '{container_id}' is not running (status: {container_status})."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # --- Port conflict check ---
            port_bindings = container_info.get("NetworkSettings", {}).get("Ports", {})
            if not port_bindings:
                port_bindings = container_info.get("port_bindings", {})
            exposed_ports = []
            if port_bindings:
                for port_key in port_bindings.keys():
                    try:
                        exposed_ports.append(int(port_key.split("/")[0]))
                    except (ValueError, IndexError):
                        pass

            if service_port and exposed_ports and int(service_port) not in exposed_ports:
                return Response(
                    {
                        "status": "error",
                        "message": f"Container does not expose port {service_port}. Available ports: {', '.join(str(p) for p in exposed_ports)}",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # --- HF Model ID catalog matching ---
            if hf_model_id:
                try:
                    catalog_data = json.loads(_CATALOG_PATH.read_text())
                    for catalog_model in catalog_data.get("models", []):
                        if catalog_model.get("hf_model_id", "").lower() == hf_model_id.lower():
                            # Found a catalog match — use its authoritative routes
                            catalog_route = catalog_model.get("service_route")
                            catalog_health = catalog_model.get("health_route")
                            catalog_type = catalog_model.get("model_type", "").lower()

                            if catalog_route and service_route and service_route != catalog_route:
                                corrections.append(
                                    f"Service route corrected from '{service_route}' to '{catalog_route}' based on catalog entry for {catalog_model.get('model_name')}"
                                )
                                service_route = catalog_route
                            elif catalog_route and not service_route:
                                service_route = catalog_route

                            if catalog_health and health_route != catalog_health:
                                corrections.append(
                                    f"Health route corrected from '{health_route}' to '{catalog_health}' based on catalog entry"
                                )
                                health_route = catalog_health

                            if catalog_type and catalog_type != model_type:
                                corrections.append(
                                    f"Model type corrected from '{model_type}' to '{catalog_type}' based on catalog entry"
                                )
                                model_type = catalog_type

                            break
                except Exception as e:
                    logger.warning(f"Could not check HF model ID against catalog: {e}")

            # --- Apply default route if still unset ---
            if not service_route:
                service_route = self._DEFAULT_ROUTES.get(model_type, "/v1/chat/completions")

            # --- Rename container based on model name ---
            current_name = container_info.get("name", container_id)
            if current_name.startswith("/"):
                current_name = current_name[1:]

            # Sanitize desired name: lowercase, replace problematic chars
            desired_name = model_name.lower().replace("/", "-").replace(" ", "_")
            # Remove any chars that aren't alphanumeric, hyphens, or underscores
            desired_name = "".join(c for c in desired_name if c.isalnum() or c in "-_.")

            container_name = current_name
            if desired_name and current_name != desired_name:
                try:
                    docker_client.rename_container(container_id, desired_name)
                    corrections.append(f"Container renamed from '{current_name}' to '{desired_name}'")
                    container_name = desired_name
                    logger.info(f"Renamed container '{current_name}' to '{desired_name}'")
                except Exception as e:
                    logger.warning(f"Could not rename container: {e}")
                    container_name = current_name

            # --- Connect container to tt_studio_network ---
            network_name = backend_config.docker_bridge_network_name
            networks = container_info.get("NetworkSettings", {}).get("Networks", {})
            if not networks:
                networks = container_info.get("networks", {})

            if network_name not in networks:
                try:
                    docker_client.connect_container_to_network(network_name, container_id)
                    logger.info(f"Connected container '{container_id}' to network '{network_name}'")
                except requests.exceptions.HTTPError as e:
                    if e.response is not None and e.response.status_code in (409, 500):
                        # Already connected or similar — treat as non-fatal
                        corrections.append(f"Container may already be on {network_name}")
                        logger.warning(f"Non-fatal error connecting to network: {e}")
                    else:
                        return Response(
                            {"status": "error", "message": f"Failed to connect container to {network_name}: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        )
                except Exception as e:
                    return Response(
                        {"status": "error", "message": f"Failed to connect container to {network_name}: {e}"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
            else:
                corrections.append(f"Container was already on {network_name}")

            # --- Create deployment record ---
            try:
                from docker_control.models import ModelDeployment

                # Check for duplicate registration
                existing = ModelDeployment.objects.filter(
                    container_id=container_id, status="running"
                )
                if existing.exists():
                    corrections.append("Deployment record already exists — updated")
                else:
                    ModelDeployment.objects.create(
                        container_id=container_id,
                        container_name=container_name,
                        model_name=model_name,
                        device="external",
                        device_id=device_id,
                        status="running",
                        stopped_by_user=False,
                        port=int(service_port) if service_port else 7000,
                    )
                    logger.info(f"Created deployment record for external container '{container_name}' on device_id={device_id}")
            except Exception as e:
                logger.error(f"Failed to create deployment record: {e}")
                # Continue — the network connection is the critical part

            # --- Refresh deploy cache ---
            try:
                update_deploy_cache()
            except Exception as e:
                logger.warning(f"Failed to update deploy cache after registration: {e}")

            return Response(
                {
                    "status": "success",
                    "container_id": container_id,
                    "container_name": container_name,
                    "corrections": corrections,
                },
                status=status.HTTP_200_OK,
            )

        except Exception as e:
            logger.error(f"Error registering external model: {e}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


@method_decorator(csrf_exempt, name='dispatch')
class WorkflowLogStreamView(View):
    """Stream workflow logs from file using Server-Sent Events"""
    
    def get(self, request, deployment_id, *args, **kwargs):
        """Stream workflow log file for a specific deployment"""
        try:
            from docker_control.models import ModelDeployment
            from django.http import HttpResponse
            
            # Get deployment record
            logger.info(f"Fetching workflow logs for deployment_id: {deployment_id}")
            deployment = ModelDeployment.objects.get(id=deployment_id)
            logger.info(f"Found deployment: {deployment.model_name}, workflow_log_path: {deployment.workflow_log_path}")
            
            if not deployment.workflow_log_path:
                logger.warning(f"No workflow log path for deployment {deployment_id}")
                return HttpResponse(
                    status=404,
                    content="No workflow log file available for this deployment"
                )
            
            log_file_path = deployment.workflow_log_path
            
            # Check if file exists
            if not os.path.exists(log_file_path):
                logger.error(f"Log file not found at path: {log_file_path}")
                return HttpResponse(
                    status=404,
                    content=f"Log file not found: {log_file_path}"
                )
            
            def generate_log_data():
                try:
                    yield "retry: 1000\n\n"
                    
                    with open(log_file_path, 'r') as f:
                        for line in f:
                            line = line.rstrip('\n\r')
                            if line:
                                event_data = {
                                    "type": "log",
                                    "message": line
                                }
                                yield f"data: {json.dumps(event_data)}\n\n"
                    
                    # Send completion event
                    yield f"data: {json.dumps({'type': 'complete', 'message': 'End of log file'})}\n\n"
                    
                except Exception as e:
                    logger.error(f"Error streaming log file: {str(e)}")
                    error_data = {
                        "type": "error",
                        "message": f"Error reading log file: {str(e)}"
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"
            
            response = StreamingHttpResponse(
                generate_log_data(),
                content_type='text/event-stream'
            )
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'
            
            return response
            
        except ModelDeployment.DoesNotExist:
            logger.warning(f"Deployment {deployment_id} not found in database")
            return HttpResponse(
                status=404,
                content=f"Deployment {deployment_id} not found"
            )
        except Exception as e:
            import traceback
            logger.error(f"Error in WorkflowLogStreamView: {str(e)}\n{traceback.format_exc()}")
            return HttpResponse(
                status=500,
                content=str(e)
            )


class StopStreamView(View):
    """Stream model deletion progress as Server-Sent Events.

    Performs stop → remove → board-reset sequentially, emitting real-time
    log lines so the frontend dialog can mirror what the backend is doing.
    Each ``log`` event carries a ``step`` field so the UI can slot it under
    the correct progress row.

    Uses an async generator so that yields flush immediately through
    uvicorn's event loop instead of being batched by the sync threadpool.
    """

    @staticmethod
    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    async def get(self, request, container_id, *args, **kwargs):
        import asyncio
        sse = self._sse
        ansi_re = re.compile(r'\x1b\[[0-9;]*m|\|[0-9;]*m')

        async def generate():
            yield "retry: 1000\n\n"

            truncated = container_id[:12]
            current_step = "deleting"

            # --- Step 1: mark deployment stopped in DB ---
            yield sse({"type": "step", "step": "deleting", "message": f"Stopping model {truncated}…"})

            def _mark_stopped():
                from docker_control.models import ModelDeployment
                from django.utils import timezone
                deployment = ModelDeployment.objects.filter(container_id=container_id).first()
                if deployment:
                    deployment.stopped_by_user = True
                    deployment.status = "stopped"
                    deployment.stopped_at = timezone.now()
                    deployment.save()
                    return f"Marked deployment {truncated} as stopped in database"
                return "No deployment record found — continuing"

            try:
                msg = await asyncio.to_thread(_mark_stopped)
                yield sse({"type": "log", "step": current_step, "message": msg})
            except Exception as e:
                yield sse({"type": "log", "step": current_step, "message": f"Warning: failed to update deployment record: {e}"})

            # --- Step 2: stop container ---
            yield sse({"type": "log", "step": current_step, "message": f"Sending stop signal to container {truncated}…"})
            docker_client = get_docker_client()
            container_gone = False
            try:
                stop_result = await asyncio.to_thread(docker_client.stop_container, container_id)
                stop_status = stop_result.get("status", "unknown")
                yield sse({"type": "log", "step": current_step, "message": f"Stop result: {stop_status}"})

                if stop_status != "success":
                    yield sse({"type": "complete", "status": "error", "message": f"Failed to stop container: {stop_result.get('message', 'unknown error')}"})
                    return
            except Exception as e:
                error_str = str(e)
                # 404 / "Not Found" means the container is already gone — not an error
                if "404" in error_str or "Not Found" in error_str:
                    container_gone = True
                    yield sse({"type": "log", "step": current_step, "message": "Container already stopped"})
                else:
                    yield sse({"type": "log", "step": current_step, "message": f"Error stopping container: {error_str}"})
                    yield sse({"type": "complete", "status": "error", "message": f"Failed to stop container {truncated}"})
                    return

            # --- Step 3: remove container (best-effort, container may already be gone) ---
            if not container_gone:
                yield sse({"type": "log", "step": current_step, "message": f"Cleaning up container {truncated}…"})
                try:
                    await asyncio.to_thread(docker_client.remove_container, container_id, True)
                    yield sse({"type": "log", "step": current_step, "message": "Container removed"})
                except Exception:
                    yield sse({"type": "log", "step": current_step, "message": "Container already removed"})

            try:
                await asyncio.to_thread(update_deploy_cache)
            except Exception:
                pass

            yield sse({"type": "log", "step": current_step, "message": f"Container {truncated} stopped and removed successfully"})

            # --- Step 4: board reset (stream tt-smi output line-by-line) ---
            current_step = "resetting"
            yield sse({"type": "step", "step": "resetting", "message": "Resetting the board…"})

            await asyncio.to_thread(SystemResourceService.set_resetting_state)

            MAX_ATTEMPTS = 2
            reset_ok = False

            for attempt in range(1, MAX_ATTEMPTS + 1):
                yield sse({"type": "log", "step": current_step, "message": f"Running tt-smi -r (attempt {attempt}/{MAX_ATTEMPTS})…"})

                try:
                    proc = await asyncio.create_subprocess_exec(
                        "tt-smi", "-r",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                        stdin=asyncio.subprocess.DEVNULL,
                    )

                    try:
                        async def _read_with_timeout():
                            while True:
                                raw_line = await asyncio.wait_for(
                                    proc.stdout.readline(), timeout=90
                                )
                                if not raw_line:
                                    break
                                cleaned = ansi_re.sub("", raw_line.decode("utf-8", errors="replace")).strip()
                                if cleaned:
                                    yield cleaned

                        async for line in _read_with_timeout():
                            yield sse({"type": "log", "step": current_step, "message": line})

                        await asyncio.wait_for(proc.wait(), timeout=10)

                    except asyncio.TimeoutError:
                        yield sse({"type": "log", "step": current_step, "message": "Timed out after 90s"})
                        try:
                            proc.terminate()
                            await asyncio.sleep(2)
                            proc.kill()
                        except Exception:
                            pass

                    returncode = proc.returncode if proc.returncode is not None else -1

                except Exception as exc:
                    yield sse({"type": "log", "step": current_step, "message": str(exc)})
                    returncode = -1

                if returncode == 0:
                    reset_ok = True
                    yield sse({"type": "log", "step": current_step, "message": f"Board reset succeeded on attempt {attempt}"})
                    break
                else:
                    yield sse({"type": "log", "step": current_step, "message": f"Attempt {attempt} failed (exit code {returncode})"})

            await asyncio.to_thread(SystemResourceService.clear_device_state_cache)

            if reset_ok:
                try:
                    await asyncio.to_thread(SystemResourceService.force_refresh_tt_smi_cache)
                    yield sse({"type": "log", "step": current_step, "message": "tt-smi cache refreshed"})
                except Exception as e:
                    yield sse({"type": "log", "step": current_step, "message": f"Warning: tt-smi cache refresh failed: {e}"})

            final_status = "success" if reset_ok else "partial"
            final_msg = (
                "Model deleted and board reset successfully"
                if reset_ok
                else "Model deleted but board reset failed"
            )
            yield sse({"type": "complete", "status": final_status, "message": final_msg})

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache, no-transform"
        response["X-Accel-Buffering"] = "no"
        response["Content-Encoding"] = "identity"
        return response


class AvailableDevicesView(APIView):
    """Get list of available Tenstorrent devices on the system"""

    def get(self, request, *args, **kwargs):
        import glob

        devices = []

        # Check for Tenstorrent devices in /dev/tenstorrent/ (devices 0-3)
        device_paths = sorted(glob.glob("/dev/tenstorrent/[0-3]"))

        for device_path in device_paths:
            try:
                device_id = int(os.path.basename(device_path))
                devices.append({
                    "id": device_id,
                    "path": device_path,
                    "available": os.access(device_path, os.R_OK | os.W_OK)
                })
            except (ValueError, OSError) as e:
                logger.warning(f"Error checking device {device_path}: {e}")

        return Response({
            "devices": devices,
            "count": len(devices)
        }, status=status.HTTP_200_OK)