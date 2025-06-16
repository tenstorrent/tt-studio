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
        logger.info(f"URL '/agent/' accessed via POST method by {request.META['REMOTE_ADDR']}")        
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
        
        # Use the standalone agent service instead of dynamically created containers
        internal_url = "http://tt_studio_agent:8080/poll_requests"
        logger.info(f"internal_url:= {internal_url}")
        logger.info(f"Using internal url: {internal_url}")
        response_stream = stream_response_from_agent_api(internal_url, data)
        return StreamingHttpResponse(response_stream, content_type="text/plain")

class ModelHealthView(APIView):
    def get(self, request, *args, **kwargs):
        data = request.query_params
        logger.info(f"HealthView data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            deploy = get_deploy_cache()[deploy_id]
            health_url = "http://" + deploy["health_url"]
            logger.info(f"health_url:= {health_url}")
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

