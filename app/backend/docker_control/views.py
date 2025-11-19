# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from django.shortcuts import render
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from rest_framework.negotiation import DefaultContentNegotiation
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import json  
import shutil
import subprocess
import os

import docker
import re
import os 
import concurrent.futures
from .forms import DockerForm
from .docker_utils import (
    run_container,
    stop_container,
    get_container_status,
    perform_reset,
    check_image_exists,
    pull_image_with_progress,
    detect_board_type,
)
from shared_config.model_config import model_implmentations
from shared_config.model_type_config import ModelTypes
from .serializers import DeploymentSerializer, StopSerializer
from shared_config.logger_config import get_logger
from shared_config.backend_config import backend_config
from shared_config.device_config import DeviceConfigurations
from board_control.services import SystemResourceService

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

# Create docker client for use across views
client = docker.from_env()

# Add this near the top after imports, before classes
pull_progress = {}  # {model_id: {status, progress, current, total, message}}
pull_cancellation = {}  # {model_id: bool} - tracks if pull should be cancelled

# Add custom renderer for SSE
class EventStreamRenderer(JSONRenderer):
    media_type = 'text/event-stream'
    format = 'txt'

# Add custom negotiation class to handle SSE
class IgnoreClientContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix):
        # Force the first renderer without checking Accept headers
        return (renderers[0], renderers[0].media_type)

class StopView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = StopSerializer(data=request.data)
        if serializer.is_valid():
            container_id = request.data.get("container_id")
            logger.info(f"Received request to stop container with ID: {container_id}")

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
            'N150': [DeviceConfigurations.N150, DeviceConfigurations.N150_WH_ARCH_YAML],
            'N300': [DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML],
            'T3000': [DeviceConfigurations.N300x4, DeviceConfigurations.N300x4_WH_ARCH_YAML],
            'T3K': [DeviceConfigurations.N300x4, DeviceConfigurations.N300x4_WH_ARCH_YAML],
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
            
            logger.info(f"Model {impl.model_name}: compatible={is_compatible}, boards={compatible_boards}")
            
            data.append({
                "id": impl_id,
                "name": impl.model_name,
                "is_compatible": is_compatible,
                "compatible_boards": compatible_boards,
                "model_type": impl.model_type.value,
                "current_board": current_board
            })
        
        return Response(data, status=status.HTTP_200_OK)


class StatusView(APIView):
    def get(self, request, *args, **kwargs):
        data = get_container_status()
        return Response(data, status=status.HTTP_200_OK)





class DeployView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = DeploymentSerializer(data=request.data)
        if serializer.is_valid():
            impl_id = request.data.get("model_id")
            weights_id = request.data.get("weights_id")
            impl = model_implmentations[impl_id]
            response = run_container(impl, weights_id)
            
            # Refresh tt-smi cache after successful deployment
            if response.get("status") == "success":
                try:
                    SystemResourceService.force_refresh_tt_smi_cache()
                except Exception as e:
                    logger.warning(f"Failed to refresh tt-smi cache after deployment: {e}")
            
            return Response(response, status=status.HTTP_201_CREATED)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


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
            return StreamingHttpResponse(
                output, content_type="text/plain", status=status.HTTP_200_OK
            )

        except Exception as e:
            logger.exception("Exception occurred during reset operation.")
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
            
            # Add pull progress if available
            if model_id in pull_progress:
                image_status['pull_in_progress'] = True
                image_status['progress'] = pull_progress[model_id]
            else:
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
class PullImageView(APIView):
    renderer_classes = [JSONRenderer, EventStreamRenderer]  # Add EventStreamRenderer
    content_negotiation_class = IgnoreClientContentNegotiation  # Use custom negotiation
    
    def options(self, request, *args, **kwargs):
        """Handle preflight requests for CORS"""
        response = Response(status=status.HTTP_200_OK)
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Content-Type, Accept, Authorization'
        response['Access-Control-Max-Age'] = '86400'
        return response

    def post(self, request, *args, **kwargs):
        try:
            logger.info(f"Received request to pull Docker image")
            logger.info(f"Request data: {request.data}")
            logger.info(f"Request headers: {dict(request.headers)}")
            
            # Use DeploymentSerializer to validate and get model_id from request body
            serializer = DeploymentSerializer(data=request.data)
            if not serializer.is_valid():
                logger.warning(f"Invalid request data: {serializer.errors}")
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
            model_id = serializer.validated_data["model_id"]
            logger.info(f"Pulling image for model_id: {model_id}")
            
            try:
                impl = model_implmentations[model_id]
            except KeyError:
                logger.warning(f"Model {model_id} not found in model_implementations")
                return Response(
                    {"status": "error", "message": f"Model {model_id} not found"},
                    status=status.HTTP_404_NOT_FOUND
                )
                
            image_name, image_tag = impl.image_version.split(':')
            logger.info(f"Pulling image: {image_name}:{image_tag} for model: {impl.model_name}")
            
            # Check if client wants SSE updates
            accept_header = request.headers.get('Accept', '')
            logger.info(f"Accept header received: {accept_header}")
            if 'text/event-stream' in accept_header:
                logger.info("Client requested SSE updates for pull progress")
                
                def event_stream():
                    # Check if pull already in progress - if so, send current state but don't return yet
                    # The pull loop will continue updating pull_progress and we'll stream those updates
                    already_in_progress = model_id in pull_progress
                    if already_in_progress:
                        logger.info(f"Pull already in progress for {model_id}, streaming current progress and continuing...")
                        yield f"data: {json.dumps(pull_progress[model_id])}\n\n"
                        # Don't return here - let it continue to monitor for updates
                        # The pull is happening in another request's event_stream, so we'll just
                        # monitor pull_progress for changes
                        import time
                        last_progress = pull_progress.get(model_id, {})
                        while model_id in pull_progress:
                            time.sleep(0.5)  # Check every 500ms
                            current_progress = pull_progress.get(model_id)
                            if current_progress and current_progress != last_progress:
                                yield f"data: {json.dumps(current_progress)}\n\n"
                                last_progress = current_progress
                                # Check if pull is done
                                if current_progress.get('status') in ['success', 'error', 'cancelled']:
                                    break
                        return
                    
                    # Reset cancellation flag
                    pull_cancellation[model_id] = False
                    
                    # Simple test first
                    initial_progress = {'status': 'starting', 'progress': 0, 'current': 0, 'total': 0, 'message': 'Starting pull...'}
                    pull_progress[model_id] = initial_progress
                    yield f"data: {json.dumps(initial_progress)}\n\n"
                    
                    # Now do the actual pull with progress
                    # Track progress per layer to properly aggregate
                    layer_progress = {}  # {layer_id: {current: bytes, total: bytes}}
                    layer_status = {}    # {layer_id: status_string}
                    
                    def progress_callback(progress):
                        # Process Docker API progress and aggregate across all layers
                        nonlocal layer_progress, layer_status
                        
                        layer_id = progress.get('id', '')
                        status_msg = progress.get('status', '')
                        
                        # Update layer status
                        if layer_id:
                            layer_status[layer_id] = status_msg
                        
                        # Extract and track progress for each layer
                        if 'progressDetail' in progress and progress['progressDetail']:
                            detail = progress['progressDetail']
                            if 'current' in detail and 'total' in detail and layer_id:
                                current = detail['current']
                                total = detail['total']
                                
                                # Update this layer's progress
                                layer_progress[layer_id] = {
                                    'current': current,
                                    'total': total
                                }
                        
                        # Calculate overall progress by summing all layers
                        total_bytes_overall = 0
                        current_bytes_overall = 0
                        
                        for layer_id, layer_data in layer_progress.items():
                            total_bytes_overall += layer_data.get('total', 0)
                            current_bytes_overall += layer_data.get('current', 0)
                        
                        # Calculate progress percentage
                        progress_percentage = 0
                        if total_bytes_overall > 0:
                            progress_percentage = min(99, int((current_bytes_overall / total_bytes_overall) * 100))
                        
                        # Generate a meaningful status message
                        active_layers = [lid for lid, status in layer_status.items() if status in ['Downloading', 'Extracting']]
                        if active_layers:
                            primary_status = layer_status.get(active_layers[0], status_msg)
                            if len(active_layers) > 1:
                                message = f"{primary_status} ({len(active_layers)} layers)"
                            else:
                                message = f"{primary_status} layer {active_layers[0][:12]}"
                        else:
                            message = status_msg or 'Pulling image...'
                        
                        formatted_progress = {
                            "status": "pulling",
                            "progress": progress_percentage,
                            "current": current_bytes_overall,
                            "total": total_bytes_overall,
                            "message": message,
                            "active_layers": len(active_layers),
                            "total_layers": len(layer_progress)
                        }
                        
                        # Update global progress tracking
                        pull_progress[model_id] = formatted_progress
                        
                        logger.debug(f"Layer {layer_id[:12] if layer_id else 'N/A'}: {status_msg} | Overall: {progress_percentage}% ({current_bytes_overall}/{total_bytes_overall} bytes)")
                        return f"data: {json.dumps(formatted_progress)}\n\n"
                    
                    # Do the actual pull with progress streaming
                    try:
                        image = f"{image_name}:{image_tag}"
                        logger.info(f"Starting streaming pull for: {image}")
                        
                        # Authenticate with ghcr.io if credentials are available
                        if image_name.startswith("ghcr.io") and backend_config.github_username and backend_config.github_pat:
                            logger.info("Authenticating with GitHub Container Registry")
                            try:
                                client.login(
                                    username=backend_config.github_username,
                                    password=backend_config.github_pat,
                                    registry="ghcr.io"
                                )
                                logger.info("Successfully authenticated with ghcr.io")
                            except Exception as auth_error:
                                logger.error(f"Failed to authenticate with ghcr.io: {str(auth_error)}")
                                error_result = {"status": "error", "progress": 0, "current": 0, "total": 0, "message": f"Authentication failed: {str(auth_error)}"}
                                pull_progress[model_id] = error_result
                                yield f"data: {json.dumps(error_result)}\n\n"
                                # Clear progress on error
                                pull_progress.pop(model_id, None)
                                return
                        
                        # Pull the image with real-time progress streaming
                        for line in client.api.pull(image, stream=True, decode=True):
                            # Check if pull has been cancelled
                            if pull_cancellation.get(model_id, False):
                                logger.info(f"Pull cancelled for {model_id}")
                                cancelled_result = {
                                    "status": "cancelled",
                                    "progress": 0,
                                    "current": 0,
                                    "total": 0,
                                    "message": "Pull cancelled by user"
                                }
                                pull_progress.pop(model_id, None)
                                pull_cancellation.pop(model_id, None)
                                yield f"data: {json.dumps(cancelled_result)}\n\n"
                                return
                            
                            if isinstance(line, dict) and 'status' in line:
                                progress_update = progress_callback(line)
                                yield progress_update
                        
                        # Verify the image was pulled successfully and send final status
                        try:
                            client.images.get(image)
                            # Calculate final total bytes from all layers
                            total_bytes_final = sum(layer_data.get('total', 0) for layer_data in layer_progress.values())
                            final_result = {
                                "status": "success",
                                "progress": 100,
                                "current": total_bytes_final,
                                "total": total_bytes_final,
                                "message": f"Successfully pulled {image}",
                                "total_layers": len(layer_progress)
                            }
                        except Exception as verify_error:
                            final_result = {
                                "status": "error",
                                "progress": 0,
                                "current": 0,
                                "total": 0,
                                "message": f"Failed to verify pulled image: {str(verify_error)}"
                            }
                        
                        yield f"data: {json.dumps(final_result)}\n\n"
                        
                        # Clear progress and cancellation flag when done
                        pull_progress.pop(model_id, None)
                        pull_cancellation.pop(model_id, None)
                        
                    except Exception as e:
                        logger.error(f"Error during streaming pull: {str(e)}")
                        error_result = {
                            "status": "error",
                            "progress": 0,
                            "current": 0,
                            "total": 0,
                            "message": str(e)
                        }
                        yield f"data: {json.dumps(error_result)}\n\n"
                        
                        # Clear progress and cancellation flag on error
                        pull_progress.pop(model_id, None)
                        pull_cancellation.pop(model_id, None)
                
                response = StreamingHttpResponse(
                    event_stream(),
                    content_type='text/event-stream'
                )
                response['Cache-Control'] = 'no-cache'
                response['X-Accel-Buffering'] = 'no'
                response['Access-Control-Allow-Origin'] = '*'
                response['Access-Control-Allow-Headers'] = 'Content-Type, Accept'
                response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
                return response
            else:
                # Regular non-SSE request - use the existing function
                logger.info("Processing regular (non-SSE) pull request")
                def progress_callback(progress):
                    logger.info(f"Pull progress: {progress}")
                
                result = pull_image_with_progress(image_name, image_tag, progress_callback)
                logger.info(f"Pull operation completed with result: {result}")
                
                if result["status"] == "success":
                    return Response(result, status=status.HTTP_200_OK)
                else:
                    return Response(result, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                
        except Exception as e:
            logger.error(f"Error pulling image: {str(e)}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


@method_decorator(csrf_exempt, name='dispatch')
class ModelCatalogView(APIView):
    """
    Comprehensive model catalog management API that handles:
    - Model pulling with progress tracking
    - Model ejection (removal)
    - Space usage checking
    - Pull cancellation
    - Model status and metadata
    """
    renderer_classes = [JSONRenderer]  # Allow JSON renderer to prevent content negotiation issues
    
    def options(self, request, *args, **kwargs):
        """Handle preflight requests for CORS"""
        response = Response(status=status.HTTP_200_OK)
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, PATCH, OPTIONS'
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

    def post(self, request, *args, **kwargs):
        """Pull a model with progress tracking"""
        try:
            model_id = request.data.get("model_id")
            logger.info(f"Received request to pull model: {model_id}")
            
            if not model_id or model_id not in model_implmentations:
                logger.warning(f"Invalid model_id provided: {model_id}")
                return Response(
                    {"status": "error", "message": f"Invalid model_id: {model_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            impl = model_implmentations[model_id]
            image_name, image_tag = impl.image_version.split(':')
            logger.info(f"Starting pull for image: {image_name}:{image_tag}")
            
            # Check if client wants SSE updates
            accept_header = request.headers.get('Accept', '')
            logger.info(f"Accept header received: {accept_header}")
            if 'text/event-stream' in accept_header:
                logger.info("Client requested SSE updates for pull progress")
                def event_stream():
                    def progress_callback(progress):
                        yield f"data: {json.dumps(progress)}\n\n"
                    
                    result = pull_image_with_progress(image_name, image_tag, progress_callback)
                    logger.info(f"Pull operation completed with result: {result}")
                    yield f"data: {json.dumps(result)}\n\n"
                
                response = StreamingHttpResponse(
                    event_stream(),
                    content_type='text/event-stream'
                )
                response['Cache-Control'] = 'no-cache'
                response['X-Accel-Buffering'] = 'no'
                response['Access-Control-Allow-Origin'] = '*'
                response['Access-Control-Allow-Headers'] = 'Content-Type, Accept'
                response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
                return response
            else:
                logger.info("Processing regular (non-SSE) pull request")
                def progress_callback(progress):
                    logger.info(f"Pull progress: {progress}")
                
                result = pull_image_with_progress(image_name, image_tag, progress_callback)
                logger.info(f"Pull operation completed with result: {result}")
                return Response(result, status=status.HTTP_200_OK)
                
        except Exception as e:
            logger.error(f"Error pulling model: {str(e)}")
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
            
            # Remove the image
            try:
                image = client.images.get(f"{image_name}:{image_tag}")
                logger.info(f"Found image with ID: {image.id}")
                client.images.remove(image.id, force=True)
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
                
            except docker.errors.ImageNotFound:
                logger.warning(f"Image {image_name}:{image_tag} not found")
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

    def patch(self, request, *args, **kwargs):
        """Cancel an ongoing model pull"""
        try:
            model_id = request.data.get("model_id")
            logger.info(f"Received request to cancel pull for model: {model_id}")
            
            if not model_id or model_id not in model_implmentations:
                logger.warning(f"Invalid model_id provided: {model_id}")
                return Response(
                    {"status": "error", "message": f"Invalid model_id: {model_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            impl = model_implmentations[model_id]
            image_name, image_tag = impl.image_version.split(':')
            logger.info(f"Looking for containers pulling image: {image_name}:{image_tag}")
            
            # Find and stop any ongoing pulls for this image
            containers_stopped = 0
            for container in client.containers.list():
                if container.image.tags and f"{image_name}:{image_tag}" in container.image.tags:
                    logger.info(f"Found container {container.id} pulling the image, stopping it")
                    container.stop()
                    container.remove()
                    containers_stopped += 1
            
            logger.info(f"Successfully cancelled pull for model {model_id}, stopped {containers_stopped} containers")
            
            # Clear pull progress
            pull_progress.pop(model_id, None)
            
            return Response({
                "status": "success",
                "message": f"Successfully cancelled pull for model {model_id}",
                "containers_stopped": containers_stopped
            }, status=status.HTTP_200_OK)
                
        except Exception as e:
            logger.error(f"Error cancelling model pull: {str(e)}")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

@method_decorator(csrf_exempt, name='dispatch')
class CancelPullView(APIView):
    def post(self, request, *args, **kwargs):
        try:
            model_id = request.data.get("model_id")
            logger.info(f"Received request to cancel pull for model: {model_id}")
            
            if not model_id or model_id not in model_implmentations:
                logger.warning(f"Invalid model_id provided: {model_id}")
                return Response(
                    {"status": "error", "message": f"Invalid model_id: {model_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check if there's an active pull for this model
            if model_id not in pull_progress:
                logger.warning(f"No active pull found for model: {model_id}")
                return Response(
                    {"status": "error", "message": f"No active pull for model: {model_id}"},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Set the cancellation flag - the pull loop will check this and stop
            pull_cancellation[model_id] = True
            logger.info(f"Cancellation flag set for model {model_id}")
            
            return Response({
                "status": "success",
                "message": f"Cancel request sent for model {model_id}"
            }, status=status.HTTP_200_OK)
                
        except Exception as e:
            logger.error(f"Error cancelling model pull: {str(e)}")
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
                'N150': 'Tenstorrent N150',
                'N300': 'Tenstorrent N300', 
                'T3000': 'Tenstorrent T3000',
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

                containers = client.containers.list(all=True)

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