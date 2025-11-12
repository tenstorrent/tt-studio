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
import requests
import json
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
deployment_start_times = {}  # {job_id: timestamp} - Track when deployment started

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
            
            # Ensure job_id is set for progress tracking
            # Use job_id from API response, or fallback to container_id or container_name
            if not response.get("job_id"):
                response["job_id"] = response.get("container_id") or response.get("container_name")
            
            # Refresh tt-smi cache after successful deployment
            if response.get("status") == "success":
                try:
                    SystemResourceService.force_refresh_tt_smi_cache()
                except Exception as e:
                    logger.warning(f"Failed to refresh tt-smi cache after deployment: {e}")
            
            return Response(response, status=status.HTTP_201_CREATED)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class DeploymentProgressView(APIView):
    def get(self, request, job_id, *args, **kwargs):
        """Track deployment progress - proxy FastAPI progress endpoints with fallback"""
        import time
        
        try:
            logger.info(f"Fetching deployment progress for job_id: {job_id}")
            
            # First, try to get progress from FastAPI inference server
            try:
                fastapi_url = "http://172.18.0.1:8001/run/progress/" + job_id
                response = requests.get(fastapi_url, timeout=5)
                
                if response.status_code == 200:
                    progress_data = response.json()
                    logger.info(f"Got progress from FastAPI: {progress_data}")
                    
                    # Add support for new status types
                    if progress_data.get("status") in ["starting", "running", "completed", "error", "stalled", "cancelled"]:
                        return Response(progress_data, status=status.HTTP_200_OK)
                    
                logger.info(f"FastAPI progress not available (status: {response.status_code}), falling back to container-based progress")
                
            except requests.exceptions.RequestException as e:
                logger.info(f"FastAPI not available ({str(e)}), falling back to container-based progress")
            
            # Fallback: existing container-based progress tracking
            # Track deployment start time if not already tracked
            if job_id not in deployment_start_times:
                deployment_start_times[job_id] = time.time()
            
            elapsed_time = time.time() - deployment_start_times[job_id]
            
            # job_id is container_id or container_name
            # Try to get container by ID first, then by name
            container = None
            try:
                # Try to get container by ID (full or partial)
                container = client.containers.get(job_id)
            except docker.errors.NotFound:
                # Try by name
                try:
                    containers = client.containers.list(all=True)
                    for c in containers:
                        if c.name == job_id:
                            container = c
                            break
                except Exception as e:
                    logger.warning(f"Error listing containers: {str(e)}")
            
            # Container not found - deployment in early stages
            # Map to actual FastAPI log stages with realistic timing
            if not container:
                logger.info(f"Container {job_id} not found yet - deployment in progress (elapsed: {elapsed_time:.1f}s)")
                
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
                    # If taking longer than expected, show waiting state
                    progress = min(75, 70 + int((elapsed_time - 45) / 10 * 5))
                    stage = "container_setup"
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
                    # Container is on the network - check if it's been renamed (final step)
                    # Based on fastapi.log (178-179) - rename is the final step
                    expected_model_name = container_name  # The job_id should match final name
                    
                    # If container name looks like it's been properly renamed to model name
                    # (not a random Docker name like "romantic_khorana")
                    if any(model_part in container_name.lower() for model_part in ['llama', 'instruct', 'model']) or '-' not in container_name:
                        # Container renamed and finalized - deployment complete
                        progress = 100
                        stage = "complete"
                        message = "Deployment complete!"  # fastapi.log (169, 178-179)
                        status_value = "completed"
                        # Clean up start time tracking
                        if job_id in deployment_start_times:
                            del deployment_start_times[job_id]
                    else:
                        # On network but not renamed yet - almost done
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
                
        except docker.errors.NotFound:
            # Container not found - use time-based progress for early stages
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
        except docker.errors.APIError as e:
            logger.error(f"Docker API error fetching progress: {str(e)}")
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
                    # Check if pull already in progress
                    if model_id in pull_progress:
                        logger.info(f"Pull already in progress for {model_id}, streaming current progress")
                        yield f"data: {json.dumps(pull_progress[model_id])}\n\n"
                        return
                    
                    # Simple test first
                    initial_progress = {'status': 'starting', 'progress': 0, 'current': 0, 'total': 0, 'message': 'Starting pull...'}
                    pull_progress[model_id] = initial_progress
                    yield f"data: {json.dumps(initial_progress)}\n\n"
                    
                    # Now do the actual pull with progress
                    progress_data = {
                        "current_layer": 0,
                        "total_layers": 0,
                        "overall_progress": 0,
                        "current_bytes": 0,
                        "total_bytes": 0
                    }
                    
                    def progress_callback(progress):
                        # Process Docker API progress and convert to numeric values
                        nonlocal progress_data
                        
                        # Extract numeric progress if available
                        numeric_progress = 0
                        if 'progressDetail' in progress and progress['progressDetail']:
                            detail = progress['progressDetail']
                            if 'current' in detail and 'total' in detail:
                                current = detail['current']
                                total = detail['total']
                                if total > 0:
                                    numeric_progress = int((current / total) * 100)
                                    progress_data["current_layer"] = current
                                    progress_data["total_layers"] = total
                                    progress_data["current_bytes"] = current
                                    progress_data["total_bytes"] = total
                        
                        # Parse progress string (e.g., "50%" -> 50)
                        elif 'progress' in progress and progress['progress']:
                            try:
                                progress_str = progress['progress'].strip()
                                if progress_str.endswith('%'):
                                    numeric_progress = int(float(progress_str[:-1]))
                            except (ValueError, AttributeError):
                                numeric_progress = 0
                        
                        # Update overall progress
                        if numeric_progress > progress_data["overall_progress"]:
                            progress_data["overall_progress"] = numeric_progress
                        
                        # Calculate progress percentage based on bytes if available
                        progress_percentage = 0
                        if progress_data["total_bytes"] > 0:
                            progress_percentage = int((progress_data["current_bytes"] / progress_data["total_bytes"]) * 100)
                        else:
                            progress_percentage = progress_data["overall_progress"]
                        
                        formatted_progress = {
                            "status": progress.get('status', 'pulling'),
                            "progress": progress_percentage,
                            "current": progress_data["current_bytes"],
                            "total": progress_data["total_bytes"],
                            "message": progress.get('status', 'Pulling image...'),
                            "layer_id": progress.get('id', '')
                        }
                        
                        # Update global progress tracking
                        pull_progress[model_id] = formatted_progress
                        
                        logger.info(f"Sending progress update: {formatted_progress}")
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
                            if isinstance(line, dict) and 'status' in line:
                                progress_update = progress_callback(line)
                                yield progress_update
                        
                        # Verify the image was pulled successfully and send final status
                        try:
                            client.images.get(image)
                            final_result = {
                                "status": "success",
                                "progress": 100,
                                "current": progress_data["total_layers"],
                                "total": progress_data["total_layers"],
                                "message": f"Successfully pulled {image}"
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
                        
                        # Clear progress when done
                        pull_progress.pop(model_id, None)
                        
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
                        
                        # Clear progress on error
                        pull_progress.pop(model_id, None)
                
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

            impl = model_implmentations[model_id]
            image_name, image_tag = impl.image_version.split(':')
            logger.info(f"Looking for containers pulling image: {image_name}:{image_tag}")
            
            # Find and stop any ongoing pulls for this image
            containers_stopped = 0
            for container in client.containers.list():
                if container.image.tags and f"{image_name}:{image_tag}" in container.image.tags:
                    logger.info(f"Found container {container.id} pulling the image, stopping it")
                    try:
                        container.stop()
                        container.remove()
                        containers_stopped += 1
                    except Exception as e:
                        logger.error(f"Error stopping container {container.id}: {str(e)}")
            
            # Also try to remove the image if it exists
            try:
                image = client.images.get(f"{image_name}:{image_tag}")
                client.images.remove(image.id, force=True)
                logger.info(f"Removed partial image: {image_name}:{image_tag}")
            except docker.errors.ImageNotFound:
                pass  # Image doesn't exist, which is fine
            except Exception as e:
                logger.error(f"Error removing image: {str(e)}")
            
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
            
            # Serialize the data
            deployment_data = []
            for deployment in deployments:
                deployment_data.append({
                    'id': deployment.id,
                    'container_id': deployment.container_id,
                    'container_name': deployment.container_name,
                    'model_name': deployment.model_name,
                    'device': deployment.device,
                    'deployed_at': deployment.deployed_at.isoformat() if deployment.deployed_at else None,
                    'stopped_at': deployment.stopped_at.isoformat() if deployment.stopped_at else None,
                    'status': deployment.status,
                    'stopped_by_user': deployment.stopped_by_user,
                    'port': deployment.port,
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