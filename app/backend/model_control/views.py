# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/views.py
import os
from pathlib import Path
import requests
from PIL import Image
import io
import time
import datetime
import docker
from docker.errors import NotFound
import json
import jwt

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import StreamingHttpResponse
from django.http import HttpResponse
from rest_framework.renderers import JSONRenderer
from rest_framework.parsers import JSONParser
from rest_framework.negotiation import DefaultContentNegotiation
from django.views import View

# Add this renderer class for SSE support
class PlainTextRenderer(JSONRenderer):
    media_type = 'text/plain'
    format = 'txt'

class EventStreamRenderer(JSONRenderer):
    media_type = 'text/event-stream'
    format = 'txt'

# Add this negotiation class to bypass content type checks
class IgnoreClientContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix):
        # Force the first renderer without checking Accept headers
        return (renderers[0], renderers[0].media_type)

from .serializers import InferenceSerializer, ModelWeightsSerializer
from model_control.model_utils import (
    encoded_jwt,
    get_deploy_cache,
    stream_response_from_external_api,
    stream_response_from_agent_api,
    health_check,
    stream_to_cloud_model,
)
from shared_config.model_config import model_implmentations
from shared_config.logger_config import get_logger
from shared_config.backend_config import backend_config

logger = get_logger(__name__)
logger.info(f"importing {__name__}")




CLOUD_CHAT_UI_URL =os.environ.get("CLOUD_CHAT_UI_URL")
CLOUD_YOLOV4_API_URL = os.environ.get("CLOUD_YOLOV4_API_URL")
CLOUD_YOLOV4_API_AUTH_TOKEN = os.environ.get("CLOUD_YOLOV4_API_AUTH_TOKEN")
CLOUD_SPEECH_RECOGNITION_URL = os.environ.get("CLOUD_SPEECH_RECOGNITION_URL")
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN = os.environ.get("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN")
CLOUD_STABLE_DIFFUSION_URL = os.environ.get("CLOUD_STABLE_DIFFUSION_URL")
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN = os.environ.get("CLOUD_STABLE_DIFFUSION_AUTH_TOKEN")
CLOUD_SPEECH_RECOGNITION_URL = os.environ.get("CLOUD_SPEECH_RECOGNITION_URL")
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN = os.environ.get("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN")

class InferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"InferenceCloudView data:={data}")
        response_stream = stream_to_cloud_model(CLOUD_CHAT_UI_URL, data)
        return StreamingHttpResponse(response_stream, content_type="text/plain")

class InferenceView(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"InferenceView data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.pop("deploy_id")
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            logger.info(f"internal_url:= {internal_url}")
            logger.info(f"using vllm model:= {deploy["model_impl"].model_name}")
            data["model"] = deploy["model_impl"].hf_model_id
            
            # Create a generator that can be cancelled
            def generate_response():
                try:
                    for chunk in stream_response_from_external_api(internal_url, data):
                        yield chunk
                except Exception as e:
                    logger.error(f"Error in stream: {str(e)}")
                    yield f"error: {str(e)}"
            
            response = StreamingHttpResponse(generate_response(), content_type="text/plain")
            return response
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
class AgentView(APIView):
    def post(self, request, *agrs, **kwargs):
        logger.info('[TRACE_FLOW_STEP_2_BACKEND_AGENT_ENTRY] AgentView.post called', extra={'request_data': request.data})        
        data = request.data.copy()  # Make a copy to avoid modifying the original
        logger.info(f"AgentView data:={data}")
        
        # For agent requests, we don't need to validate deploy_id since agents can work with cloud models
        deploy_id = data.get("deploy_id", "")
        logger.info(f"Deploy ID: {deploy_id}")
        
        # Check if we have a valid deployment, if not, proceed without it (for cloud/agent mode)
        deploy_cache = get_deploy_cache()
        if deploy_id and deploy_id in deploy_cache:
            deploy = deploy_cache[deploy_id]
            logger.info(f"using vllm model:= {deploy['model_impl'].model_name}")
            data["model"] = deploy["model_impl"].hf_model_id
        else:
            logger.info("No valid deployment found, proceeding with agent-only mode (cloud LLM)")
            # Remove deploy_id from data since it's not needed for agent
            data.pop("deploy_id", None)
        
        # Use the enhanced agent service with discovery capabilities
        agent_url = "http://tt_studio_agent:8080/poll_requests"
        logger.info(f"agent_url:= {agent_url}")
        logger.info(f"Using enhanced agent with auto-discovery: {agent_url}")
        
        # Add agent-specific metadata to help with discovery
        if not deploy_id:
            # If no specific deploy_id, let the agent use its discovery mechanism
            data["use_agent_discovery"] = True
            logger.info("Enabling agent auto-discovery mode")
        
        response_stream = stream_response_from_agent_api(agent_url, data)
        return StreamingHttpResponse(response_stream, content_type="text/plain")


class AgentStatusView(APIView):
    def get(self, request, *args, **kwargs):
        """Get agent status and discovery information"""
        try:
            import time
            # Get agent status directly from the agent service
            agent_status_url = "http://tt_studio_agent:8080/status"
            response = requests.get(agent_status_url, timeout=10)
            
            if response.status_code == 200:
                agent_status = response.json()
                
                # Add backend-specific information
                backend_info = {
                    "backend_status": "running",
                    "deployed_models_count": len(get_deploy_cache()),
                    "agent_integration": "enhanced",
                    "discovery_enabled": True
                }
                
                # Merge agent and backend status
                full_status = {
                    "agent": agent_status,
                    "backend": backend_info,
                    "timestamp": time.time()
                }
                
                return Response(full_status, status=status.HTTP_200_OK)
            else:
                return Response(
                    {"error": "Agent service unavailable", "status_code": response.status_code},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to get agent status: {e}")
            return Response(
                {"error": "Failed to connect to agent service", "details": str(e)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        except Exception as e:
            logger.error(f"Unexpected error in AgentStatusView: {e}")
            return Response(
                {"error": "Internal server error", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ModelHealthView(APIView):
    def get(self, request, *args, **kwargs):
        data = request.query_params
        logger.info(f"HealthView data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            deploy = get_deploy_cache()[deploy_id]
            health_url = "http://" + deploy["health_url"]
            check_passed, health_content = health_check(health_url, json_data=None)
            if check_passed:
                ret_status = status.HTTP_200_OK
                content = {"message": "Healthy", "details": health_content}
            else:
                ret_status = status.HTTP_503_SERVICE_UNAVAILABLE
                content = {"message": "Unavailable", "details": health_content}
            return Response(content, status=ret_status)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class DeployedModelsView(APIView):
    def get(self, request, *args, **kwargs):
        """user filtered version of deploy_cache, add more data as needed."""
        deployed_data = get_deploy_cache()
        for k, v in deployed_data.items():
            # serialize
            v["model_impl"] = v["model_impl"].asdict()
            v["model_impl"]["device_configurations"] = [
                e.name for e in v["model_impl"]["device_configurations"]
            ]
            # Convert enum values to their string representations for JSON serialization
            if hasattr(v["model_impl"]["model_type"], 'value'):
                v["model_impl"]["model_type"] = v["model_impl"]["model_type"].value
            if hasattr(v["model_impl"]["setup_type"], 'value'):
                v["model_impl"]["setup_type"] = v["model_impl"]["setup_type"].value
            # for security reasons remove variables
            del v["model_impl"]["docker_config"]
            del v["env_vars"]

        logger.info(f"deployed_data:={deployed_data}")
        return Response(deployed_data, status=status.HTTP_200_OK)


class ModelWeightsView(APIView):
    def get(self, request, *args, **kwargs):
        data = request.query_params
        logger.info(f"request.query_params:={data}")
        serializer = ModelWeightsSerializer(data=data)
        if serializer.is_valid():
            model_id = data.get("model_id")
            impl = model_implmentations[model_id]
            weights_dir = impl.backend_weights_dir
            assert weights_dir.exists(), f"weights_dir:={weights_dir} does not exist. Check models API initiliazation."
            weights = [
                {"weights_id": f"id_{w.name}", "name": w.name}
                for w in weights_dir.iterdir()
            ]
            return Response(weights, status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ObjectDetectionInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            image = data.get("image").file  # we should only receive 1 file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            # construct file to send
            pil_image = Image.open(image)
            pil_image = pil_image.resize((320, 320))  # Resize to target dimensions
            buf = io.BytesIO()
            pil_image.save(
                buf,
                format="JPEG",
            )
            byte_im = buf.getvalue()
            file = {"file": byte_im}
            try:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response(inference_data.json(), status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ObjectDetectionInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        
        # Get image directly instead of using serializer
        image = data.get("image")
        if not image:
            return Response({"error": "image is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        image = image.file  # we should only receive 1 file
        
        # Get deploy_id and handle the case where it's the string "null" or empty
        deploy_id = data.get("deploy_id")
        if deploy_id == "null" or not deploy_id:
            # Use cloud URL when deploy_id is "null" or empty
            internal_url = CLOUD_YOLOV4_API_URL
            logger.info(f"Using cloud URL: {internal_url}")
            headers = {"Authorization": f"Bearer {CLOUD_YOLOV4_API_AUTH_TOKEN}"}
            logger.info(f"Using cloud auth token: {CLOUD_YOLOV4_API_AUTH_TOKEN}")
        else:
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            headers = {"Authorization": f"Bearer {CLOUD_YOLOV4_API_AUTH_TOKEN}"}
            
        # construct file to send
        pil_image = Image.open(image)
        pil_image = pil_image.resize((320, 320))  # Resize to target dimensions
        buf = io.BytesIO()
        pil_image.save(
            buf,
            format="JPEG",
        )
        byte_im = buf.getvalue()
        file = {"file": byte_im}
        
        try:
            # log request
            logger.info(f"internal_url:={internal_url}")
            logger.info(f"headers:={headers}")
            # logger.info(f"file:={file}")
            inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
            inference_data.raise_for_status()
        except requests.exceptions.HTTPError as http_err:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)


class ImageGenerationInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special image generation inference view that performs special file handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            prompt = data.get("prompt")  # we should only receive 1 prompt
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            try:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                data = {"prompt": prompt}
                inference_data = requests.post(internal_url, json=data, headers=headers, timeout=5)
                inference_data.raise_for_status()

                # begin fetch status loop
                ready_latest = False
                task_id = inference_data.json().get("task_id")
                get_status_url = internal_url.replace("/enqueue", f"/status/{task_id}")
                while (not ready_latest):
                    latest_prompt = requests.get(get_status_url, headers=headers)
                    if latest_prompt.status_code != status.HTTP_404_NOT_FOUND:
                        latest_prompt.raise_for_status()
                        if latest_prompt.json()["status"] == "Completed":
                            ready_latest = True
                    time.sleep(1)

                # call get_image to get image
                get_image_url = internal_url.replace("/enqueue", f"/fetch_image/{task_id}")
                latest_image = requests.get(get_image_url, headers=headers, stream=True)
                latest_image.raise_for_status()
                content_type = latest_image.headers.get('Content-Type', 'application/octet-stream')
                content_disposition = f'attachment; filename=image.png'
                
                # Create a Django HttpResponse with the content of the file from Flask
                django_response = HttpResponse(latest_image.content, content_type=content_type)
                django_response['Content-Disposition'] = content_disposition
                return django_response

            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                    return Response(status=status.HTTP_503_SERVICE_UNAVAILABLE)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SpeechRecognitionInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special automatic speec recognition inference view"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            audio_file = data.get("file")  # we should only receive 1 file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
            try:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response(inference_data.json(), status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class SpeechRecognitionInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling for cloud speech recognition"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        
        # Get audio file directly instead of using serializer
        audio_file = data.get("file")
        if not audio_file:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        # Get deploy_id and handle the case where it's the string "null"
        deploy_id = data.get("deploy_id")
        if deploy_id == "null" or not deploy_id:
            # Use cloud URL when deploy_id is "null" or empty
            internal_url = CLOUD_SPEECH_RECOGNITION_URL
            if not internal_url:
                return Response(
                    {"error": "Cloud speech recognition URL not configured"}, 
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            logger.info(f"Using cloud URL: {internal_url}")
            headers = {"Authorization": f"Bearer {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}"}
            logger.info(f"Using cloud auth token: {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}")
        else:
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            
        file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
        
        try:
            # log request
            logger.info(f"internal_url:={internal_url}")
            logger.info(f"headers:={headers}")
            inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
            inference_data.raise_for_status()
        except requests.exceptions.HTTPError as http_err:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)

class ImageGenerationInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special image generation inference view that performs special file handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} received request data: {data}")
        
        # Get prompt directly since we don't need deploy_id validation for cloud
        prompt = data.get("prompt")
        if not prompt:
            logger.error("No prompt provided in request")
            return Response({"error": "prompt is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        logger.info(f"Processing prompt: {prompt}")
        base_url = CLOUD_STABLE_DIFFUSION_URL
        if not base_url:
            logger.error("Cloud stable diffusion URL not configured")
            return Response(
                {"error": "Cloud stable diffusion URL not configured"}, 
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        try:
            headers = {"Authorization": f"Bearer {CLOUD_STABLE_DIFFUSION_AUTH_TOKEN}"}
            data = {"prompt": prompt}
            
            # Use /enqueue endpoint for initial request
            enqueue_url = f"{base_url}/enqueue"
            logger.info(f"Making request to cloud endpoint: {enqueue_url}")
            logger.info(f"Request headers: {headers}")
            logger.info(f"Request data: {data}")
            
            inference_data = requests.post(enqueue_url, json=data, headers=headers, timeout=5)
            inference_data.raise_for_status()
            logger.info(f"Initial request successful, response: {inference_data.json()}")

            # begin fetch status loop
            ready_latest = False
            task_id = inference_data.json().get("task_id")
            logger.info(f"Got task_id: {task_id}")
            status_url = f"{base_url}/status/{task_id}"
            logger.info(f"Status check URL: {status_url}")
            
            while (not ready_latest):
                logger.info(f"Checking status for task {task_id}")
                latest_prompt = requests.get(status_url, headers=headers)
                if latest_prompt.status_code != status.HTTP_404_NOT_FOUND:
                    latest_prompt.raise_for_status()
                    status_data = latest_prompt.json()
                    logger.info(f"Status response: {status_data}")
                    if status_data["status"] == "Completed":
                        ready_latest = True
                        logger.info("Task completed successfully")
                time.sleep(1)

            # call get_image to get image
            image_url = f"{base_url}/fetch_image/{task_id}"
            logger.info(f"Fetching image from: {image_url}")
            latest_image = requests.get(image_url, headers=headers, stream=True)
            latest_image.raise_for_status()
            logger.info("Successfully retrieved image")
            
            content_type = latest_image.headers.get('Content-Type', 'application/octet-stream')
            content_disposition = f'attachment; filename=image.png'
            
            # Create a Django HttpResponse with the content of the file from Flask
            django_response = HttpResponse(latest_image.content, content_type=content_type)
            django_response['Content-Disposition'] = content_disposition
            logger.info("Returning image response")
            return django_response

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"HTTP Error occurred: {str(http_err)}")
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                logger.error("Unauthorized access to cloud endpoint")
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                logger.error("Cloud service unavailable")
                return Response(status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                logger.error(f"Unexpected error: {str(http_err)}")
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class SpeechRecognitionInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special automatic speec recognition inference view"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            audio_file = data.get("file")  # we should only receive 1 file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
            try:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response(inference_data.json(), status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class SpeechRecognitionInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling for cloud speech recognition"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        
        # Get audio file directly instead of using serializer
        audio_file = data.get("file")
        if not audio_file:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        # Get deploy_id and handle the case where it's the string "null"
        deploy_id = data.get("deploy_id")
        if deploy_id == "null" or not deploy_id:
            # Use cloud URL when deploy_id is "null" or empty
            internal_url = CLOUD_SPEECH_RECOGNITION_URL
            if not internal_url:
                return Response(
                    {"error": "Cloud speech recognition URL not configured"}, 
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            logger.info(f"Using cloud URL: {internal_url}")
            headers = {"Authorization": f"Bearer {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}"}
            logger.info(f"Using cloud auth token: {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}")
        else:
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            
        file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
        
        try:
            # log request
            logger.info(f"internal_url:={internal_url}")
            logger.info(f"headers:={headers}")
            inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
            inference_data.raise_for_status()
        except requests.exceptions.HTTPError as http_err:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)

class ContainerLogsView(View):
    def get(self, request, container_id, *args, **kwargs):
        """Stream logs, events, and metrics from a Docker container using Server-Sent Events"""
        logger.info(f"ContainerLogsView received request for container_id: {container_id}")
        
        try:
            logger.info("Initializing Docker client")
            client = docker.from_env()
            
            logger.info(f"Attempting to get container: {container_id}")
            container = client.containers.get(container_id)
            logger.info(f"Found container: {container.name} (ID: {container.id})")
            
            def generate_container_data():
                try:
                    # Set SSE headers in initial response
                    yield "retry: 1000\n\n"  # Reconnection time in ms
                    
                    # Stream logs in real-time with better formatting
                    for log in container.logs(stream=True, follow=True, tail=100):
                        try:
                            # Decode and handle potential multi-line logs
                            log_text = log.decode('utf-8', errors='replace')
                            
                            # Split into individual lines and process each
                            for line in log_text.split('\n'):
                                line = line.rstrip('\r')  # Remove carriage returns
                                if line:  # Only send non-empty lines
                                    # Add timestamp if not present
                                    import datetime
                                    timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                                    
                                    # Determine if this should be an event or a log
                                    line_upper = line.upper()
                                    message_type = "log"  # Default to log
                                    
                                    # Check for event-worthy log levels
                                    if any(level in line_upper for level in ['[ERROR]', '[FATAL]', '[CRITICAL]']):
                                        message_type = "event"
                                    elif any(level in line_upper for level in ['[WARN]', '[WARNING]']):
                                        message_type = "event"  
                                    elif 'RESPONSE_Q OUT OF SYNC' in line_upper:
                                        message_type = "event"
                                    elif 'ABORTED' in line_upper or 'CORE DUMPED' in line_upper:
                                        message_type = "event"
                                    elif 'TERMINATED' in line_upper or 'EXCEPTION' in line_upper:
                                        message_type = "event"
                                    elif 'DESTINATION UNREACHABLE' in line_upper:
                                        message_type = "event"
                                    elif 'CLUSTER GENERATION FAILED' in line_upper:
                                        message_type = "event"
                                    # Application startup and ready state events
                                    elif 'APPLICATION STARTUP COMPLETE' in line_upper:
                                        message_type = "event"
                                    elif 'UVICORN RUNNING ON' in line_upper:
                                        message_type = "event"
                                    elif 'STARTED SERVER PROCESS' in line_upper:
                                        message_type = "event"
                                    elif 'WAITING FOR APPLICATION STARTUP' in line_upper:
                                        message_type = "event"
                                    elif 'WH_ARCH_YAML:' in line_upper:
                                        message_type = "event"
                                    elif 'DEVICE |' in line_upper and 'OPENING USER MODE DEVICE DRIVER' in line_upper:
                                        message_type = "event"
                                    elif 'SILICONDRIVER' in line_upper and ('OPENED PCI DEVICE' in line_upper or 'DETECTED PCI' in line_upper):
                                        message_type = "event"
                                    elif 'SOFTWARE VERSION' in line_upper and 'ETHERNET FW VERSION' in line_upper:
                                        message_type = "event"
                                    elif 'PLATFORM LINUX' in line_upper or 'PYTEST-' in line_upper:
                                        message_type = "event"
                                    elif 'ROOTDIR:' in line_upper or 'PLUGINS:' in line_upper:
                                        message_type = "event"
                                    elif 'COLLECTED' in line_upper and 'ITEM' in line_upper:
                                        message_type = "event"
                                    
                                    # Format the message
                                    log_data = {
                                        "type": message_type,
                                        "message": line,
                                        "timestamp": timestamp,
                                        "raw": True  # Indicates this preserves original formatting
                                    }
                                    yield f"data: {json.dumps(log_data)}\n\n"
                        except Exception as decode_error:
                            # Fallback for problematic log lines
                            error_msg = f"[LOG DECODE ERROR] {str(decode_error)}"
                            log_data = {
                                "type": "log", 
                                "message": error_msg,
                                "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                                "raw": True
                            }
                            yield f"data: {json.dumps(log_data)}\n\n"
                    
                    # Get container stats for metrics
                    stats = container.stats(stream=True, decode=True)
                    for stat in stats:
                        # Format metrics data
                        metrics_data = {
                            "type": "metric",
                            "name": "cpu_usage",
                            "value": stat.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
                        }
                        yield f"data: {json.dumps(metrics_data)}\n\n"
                        
                        metrics_data = {
                            "type": "metric",
                            "name": "memory_usage",
                            "value": stat.get("memory_stats", {}).get("usage", 0)
                        }
                        yield f"data: {json.dumps(metrics_data)}\n\n"
                        
                        # Format as an event when significant changes occur
                        if stat.get("precpu_stats"):
                            event_data = {
                                "type": "event",
                                "message": f"Container stats updated at {time.strftime('%Y-%m-%d %H:%M:%S')}"
                            }
                            yield f"data: {json.dumps(event_data)}\n\n"
                            
                except Exception as e:
                    logger.error(f"Error in data stream: {str(e)}")
                    error_data = {
                        "type": "log",
                        "message": f"Error streaming data: {str(e)}"
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"
            
            response = StreamingHttpResponse(
                generate_container_data(),
                content_type='text/event-stream'
            )
            
            # Set required headers for SSE
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'
            
            return response
            
        except NotFound:
            logger.error(f"Container not found: {container_id}")
            return HttpResponse(
                status=404,
                content=f"Container {container_id} not found"
            )
        except Exception as e:
            logger.error(f"Error streaming container data: {str(e)}")
            return HttpResponse(
                status=500,
                content=str(e)
            )


class ModelAPIInfoView(APIView):
    """Get API endpoint information for deployed models"""
    def get(self, request, *args, **kwargs):
        """Return API endpoint details for all deployed models"""
        try:
            deployed_data = get_deploy_cache()
            api_info = {}
            
            for deploy_id, deploy_info in deployed_data.items():
                # Get the base URL from the request
                base_url = request.build_absolute_uri('/').rstrip('/')
                
                # Extract model information
                model_impl = deploy_info.get("model_impl", {})
                model_name = getattr(model_impl, "model_name", "Unknown") if model_impl else "Unknown"
                model_type_obj = getattr(model_impl, "model_type", None) if model_impl else None
                model_type = getattr(model_type_obj, "value", "ChatModel") if model_type_obj else "ChatModel"
                
                # Get internal URL and construct proper vLLM endpoints
                internal_url = deploy_info.get("internal_url", "")
                health_url = deploy_info.get("health_url", "")
                
                # Construct the proper vLLM endpoints
                # The internal_url format is: hostname:port/service_route
                # We need to extract hostname:port and construct the proper vLLM endpoints
                if internal_url:
                    # Extract hostname:port from internal_url
                    # internal_url format: hostname:port/service_route
                    if "/v1/chat/completions" in internal_url:
                        base_internal_url = internal_url.replace("/v1/chat/completions", "")
                    elif "/v1/completions" in internal_url:
                        base_internal_url = internal_url.replace("/v1/completions", "")
                    else:
                        # If no service route found, assume it's just hostname:port
                        base_internal_url = internal_url
                    
                    # Construct the proper vLLM endpoints
                    # These should be the actual vLLM server endpoints
                    chat_completions_url = f"http://{base_internal_url}/v1/chat/completions"
                    completions_url = f"http://{base_internal_url}/v1/completions"
                    health_endpoint_url = f"http://{health_url}" if health_url else f"http://{base_internal_url}/health"
                else:
                    chat_completions_url = ""
                    completions_url = ""
                    health_endpoint_url = ""
                
                # Generate JWT token for this model
                json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
                jwt_secret = backend_config.jwt_secret
                encoded_jwt = jwt.encode(json_payload, jwt_secret, algorithm="HS256")
                
                # Create example payload based on model type
                example_payload = self._get_example_payload(model_type, deploy_info)
                
                # Create curl examples for both chat completions and completions APIs
                chat_curl_example = self._get_chat_curl_example(chat_completions_url, encoded_jwt, deploy_info)
                completions_curl_example = self._get_completions_curl_example(completions_url, encoded_jwt, deploy_info)
                
                api_info[deploy_id] = {
                    "model_name": model_name,
                    "model_type": model_type,
                    "hf_model_id": getattr(model_impl, "hf_model_id", None) if model_impl else None,
                    "jwt_secret": jwt_secret,
                    "jwt_token": encoded_jwt,
                    "example_payload": example_payload,
                    "chat_curl_example": chat_curl_example,
                    "completions_curl_example": completions_curl_example,
                    "internal_url": internal_url,
                    "health_url": health_url,
                    "endpoints": {
                        "chat_completions": chat_completions_url,
                        "completions": completions_url,
                        "health": health_endpoint_url,
                        "tt_studio_backend": f"{base_url}/models-api/inference/"
                    },
                    "deploy_info": {
                        "model_impl": getattr(model_impl, "asdict", lambda: {})() if model_impl else {},
                        "internal_url": internal_url,
                        "health_url": health_url
                    }
                }
            
            return Response(api_info, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error getting API info: {str(e)}")
            return Response(
                {"error": "Failed to get API information", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def _get_endpoint_path(self, model_type):
        """Get the appropriate endpoint path based on model type"""
        endpoint_map = {
            "ChatModel": "/inference/",
            "ImageGeneration": "/image-generation/",
            "ObjectDetectionModel": "/object-detection/",
            "SpeechRecognitionModel": "/speech-recognition/"
        }
        return endpoint_map.get(model_type, "/inference/")
    
    def _get_example_payload(self, model_type, deploy_info):
        """Get example payload based on model type"""
        # Get the actual deploy_id for this specific model
        deploy_id = None
        current_model_impl = deploy_info.get("model_impl", {})
        current_model_name = getattr(current_model_impl, "model_name", None) if current_model_impl else None
        
        for did, dinfo in get_deploy_cache().items():
            dinfo_model_impl = dinfo.get("model_impl", {})
            dinfo_model_name = getattr(dinfo_model_impl, "model_name", None) if dinfo_model_impl else None
            if dinfo_model_name == current_model_name:
                deploy_id = did
                break
        
        # Get the HF model ID for the model
        hf_model_id = getattr(current_model_impl, "hf_model_id", "meta-llama/Llama-3.2-1B-Instruct") if current_model_impl else "meta-llama/Llama-3.2-1B-Instruct"
        
        if model_type == "ChatModel":
            # Return OpenAI-compatible format for direct model testing
            return {
                "model": hf_model_id,
                "messages": [
                    {
                        "role": "user",
                        "content": "What is Tenstorrent?"
                    }
                ],
                "temperature": 0.7,
                "max_tokens": 100,
                "stream": False
            }
        elif model_type == "ImageGeneration":
            return {
                "deploy_id": deploy_id or "your_deploy_id",
                "prompt": "A beautiful sunset over mountains"
            }
        elif model_type == "ObjectDetectionModel":
            return {
                "deploy_id": deploy_id or "your_deploy_id",
                "image": "base64_encoded_image_or_file_upload"
            }
        elif model_type == "SpeechRecognitionModel":
            return {
                "deploy_id": deploy_id or "your_deploy_id",
                "file": "audio_file_upload"
            }
        
        # Fallback for unknown model types
        return {
            "deploy_id": deploy_id or "your_deploy_id",
            "prompt": "What is Tenstorrent?",
            "temperature": 1.0,
            "top_k": 20,
            "top_p": 0.9,
            "max_tokens": 128,
            "stream": True,
            "stop": ["<|eot_id|>"]
        }
    
    def _get_chat_curl_example(self, chat_url, jwt_token, deploy_info):
        """Generate curl example for chat completions API"""
        if not chat_url:
            return "# Chat completions endpoint not available"
        
        model_impl = deploy_info.get("model_impl", {})
        hf_model_id = getattr(model_impl, "hf_model_id", "your-model-name") if model_impl else "your-model-name"
        
        return f"""curl -X POST "{chat_url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -d '{{
    "model": "{hf_model_id}",
    "messages": [
      {{
        "role": "user",
        "content": "What is Tenstorrent?"
      }}
    ],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": false
  }}'"""
    
    def _get_completions_curl_example(self, completions_url, jwt_token, deploy_info):
        """Generate curl example for completions API"""
        if not completions_url:
            return "# Completions endpoint not available"
        
        model_impl = deploy_info.get("model_impl", {})
        hf_model_id = getattr(model_impl, "hf_model_id", "your-model-name") if model_impl else "your-model-name"
        
        return f"""curl -X POST "{completions_url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -d '{{
    "model": "{hf_model_id}",
    "prompt": "What is Tenstorrent?",
    "temperature": 0.9,
    "top_k": 20,
    "top_p": 0.9,
    "max_tokens": 128,
    "stream": false,
    "stop": ["<|eot_id|>"]
  }}'"""
    
    def _get_curl_example(self, api_url, jwt_token, payload, model_type):
        """Generate curl example for the API endpoint (legacy method)"""
        if model_type == "ObjectDetectionModel":
            return f"""curl -X POST "{api_url}" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -H "Content-Type: multipart/form-data" \\
  -F "deploy_id=your_deploy_id" \\
  -F "image=@your_image.jpg"
"""
        elif model_type == "SpeechRecognitionModel":
            return f"""curl -X POST "{api_url}" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -H "Content-Type: multipart/form-data" \\
  -F "deploy_id=your_deploy_id" \\
  -F "file=@your_audio.wav"
"""
        else:
            # For JSON payloads (Chat models)
            json_payload = json.dumps(payload, indent=2)
            return f"""curl -X POST "{api_url}" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -H "Content-Type: application/json" \\
  -d '{json_payload}'
"""

