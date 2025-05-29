# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

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

import docker
import os 
from .forms import DockerForm
from .docker_utils import (
    run_container,
    run_agent_container, 
    stop_container,
    get_container_status,
    perform_reset,
    check_image_exists,
    pull_image_with_progress,
)
from shared_config.model_config import model_implmentations
from shared_config.model_type_config import ModelTypes
from .serializers import DeploymentSerializer, StopSerializer
from shared_config.logger_config import get_logger
from shared_config.backend_config import backend_config

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

# Create docker client for use across views
client = docker.from_env()

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

            # Find agent container 
            container_name = client.containers.get(container_id).name
            last_underscore_index = container_name.rfind('_')
            llm_host_port = container_name[last_underscore_index + 1:]

            agent_container_name = f"ai_agent_container_{llm_host_port}"
            all_containers = client.containers.list(all=True)
            for container in all_containers:
                if container.name == agent_container_name: # if the agent corresponding agent container is found
                    stop_container(container.id) # remove the agent container 

            # Stop the container
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
        data = [
            {"id": impl_id, "name": impl.model_name}
            for impl_id, impl in model_implmentations.items()
        ]
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
            if os.getenv("TAVILY_API_KEY") == "your-tavily-api-key":
                agent_api_key_set = False 
            else:
                agent_api_key_set = True
            if impl.model_type == ModelTypes.CHAT and agent_api_key_set:
                run_agent_container(response["container_name"], response["port_bindings"], impl) # run agent container that maps to appropriate LLM container
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
                    # Simple test first
                    yield f"data: {json.dumps({'status': 'starting', 'progress': 0, 'current': 0, 'total': 0, 'message': 'Starting pull...'})}\n\n"
                    
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
                                yield f"data: {json.dumps(error_result)}\n\n"
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
            return Response({
                "status": "success",
                "message": f"Successfully cancelled pull for model {model_id}"
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
