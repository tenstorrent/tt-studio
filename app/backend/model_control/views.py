# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/views.py
import os
from pathlib import Path
import asyncio
import threading
import requests
from PIL import Image
import io
import time
import datetime
import json
import jwt

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import StreamingHttpResponse, HttpResponse, JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
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
    get_model_name_from_container,
    get_max_tokens_limit,
    messages_to_prompt,
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




TTS_API_KEY = os.environ.get("TTS_API_KEY", "")
CLOUD_CHAT_UI_URL =os.environ.get("CLOUD_CHAT_UI_URL")
CLOUD_YOLOV4_API_URL = os.environ.get("CLOUD_YOLOV4_API_URL")
CLOUD_YOLOV4_API_AUTH_TOKEN = os.environ.get("CLOUD_YOLOV4_API_AUTH_TOKEN")
CLOUD_SPEECH_RECOGNITION_URL = os.environ.get("CLOUD_SPEECH_RECOGNITION_URL")
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN = os.environ.get("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN")
CLOUD_STABLE_DIFFUSION_URL = os.environ.get("CLOUD_STABLE_DIFFUSION_URL")
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN = os.environ.get("CLOUD_STABLE_DIFFUSION_AUTH_TOKEN")
CLOUD_SPEECH_RECOGNITION_URL = os.environ.get("CLOUD_SPEECH_RECOGNITION_URL")
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN = os.environ.get("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN")

@method_decorator(csrf_exempt, name="dispatch")
class InferenceCloudView(View):
    async def post(self, request, *args, **kwargs):
        data = json.loads(request.body)
        logger.info(f"InferenceCloudView data:={data}")

        async def generate():
            async for chunk in stream_to_cloud_model(CLOUD_CHAT_UI_URL, data):
                yield chunk

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

@method_decorator(csrf_exempt, name="dispatch")
class InferenceView(View):
    async def post(self, request, *args, **kwargs):
        data = json.loads(request.body)
        logger.info(f"InferenceView data:={data}")
        serializer = InferenceSerializer(data=data)
        if not serializer.is_valid():
            return JsonResponse(serializer.errors, status=400)

        deploy_id = data.pop("deploy_id")
        deploy = get_deploy_cache()[deploy_id]
        internal_url = "http://" + deploy["internal_url"]
        logger.info(f"internal_url:= {internal_url}")
        logger.info(f"using vllm model:= {deploy['model_impl'].model_name}")
        data["model"] = deploy.get("cached_model_name") or get_model_name_from_container(
            deploy["internal_url"], fallback=deploy["model_impl"].hf_model_id
        )

        # Clamp max_tokens to 75% of the model's context window so there is
        # always headroom for input tokens (conversation history, system prompt, etc).
        # Falls back to a param_count-based estimate when max_model_len is not yet cached.
        raw_limit = deploy.get("max_model_len") or get_max_tokens_limit(deploy["model_impl"].param_count)
        max_tokens_limit = max(1, raw_limit * 3 // 4)
        if data.get("max_tokens"):
            data["max_tokens"] = min(int(data["max_tokens"]), max_tokens_limit)

        # Route base/completion models to /v1/completions with a plain prompt
        service_route = deploy["model_impl"].service_route
        logger.info(f"service_route:= {service_route}")
        if service_route == "/v1/completions":
            messages = data.pop("messages", [])
            data["prompt"] = messages_to_prompt(messages)
            data.pop("stream_options", None)

        async def generate():
            try:
                async for chunk in stream_response_from_external_api(internal_url, data):
                    yield chunk
            except Exception as e:
                logger.error(f"Error in stream: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

@method_decorator(csrf_exempt, name="dispatch")
class AgentView(View):
    async def post(self, request, *args, **kwargs):
        logger.info('[TRACE_FLOW_STEP_2_BACKEND_AGENT_ENTRY] AgentView.post called')
        data = json.loads(request.body)
        logger.info(f"AgentView data:={data}")

        deploy_id = data.get("deploy_id", "")
        logger.info(f"Deploy ID: {deploy_id}")

        deploy_cache = get_deploy_cache()
        if deploy_id and deploy_id in deploy_cache:
            deploy = deploy_cache[deploy_id]
            logger.info(f"using vllm model:= {deploy['model_impl'].model_name}")
            data["model"] = deploy.get("cached_model_name") or get_model_name_from_container(
                deploy["internal_url"], fallback=deploy["model_impl"].hf_model_id
            )
        else:
            logger.info("No valid deployment found, proceeding with agent-only mode (cloud LLM)")
            data.pop("deploy_id", None)

        agent_url = "http://tt_studio_agent:8080/poll_requests"
        logger.info(f"agent_url:= {agent_url}")

        if not deploy_id:
            data["use_agent_discovery"] = True
            logger.info("Enabling agent auto-discovery mode")

        async def generate():
            async for chunk in stream_response_from_agent_api(agent_url, data):
                yield chunk

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


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
            if check_passed is True:
                ret_status = status.HTTP_200_OK
                content = {"message": "Healthy", "details": health_content}
            elif check_passed is None:
                ret_status = status.HTTP_202_ACCEPTED
                content = {"message": "Starting", "details": health_content}
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


class ImageClassificationInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """Proxy image classification requests to a deployed Forge CNN container."""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            image = data.get("image").file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]

            top_k = int(data.get("top_k", 5))
            min_confidence = float(data.get("min_confidence", 1.0))
            response_format = data.get("response_format", "json")

            pil_image = Image.open(image)
            if pil_image.mode in ("RGBA", "LA", "P"):
                pil_image = pil_image.convert("RGB")
            buf = io.BytesIO()
            pil_image.save(buf, format="JPEG")
            file = {"file": ("image.jpg", buf.getvalue(), "image/jpeg")}
            form_data = {
                "top_k": (None, str(top_k)),
                "min_confidence": (None, str(min_confidence)),
                "response_format": (None, response_format),
            }
            try:
                headers = {"Authorization": f"Bearer {backend_config.jwt_secret}"}
                inference_data = requests.post(
                    internal_url, files={**file, **form_data}, headers=headers, timeout=30
                )
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                return Response(
                    {"detail": f"Forge container error: {inference_data.text}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            except requests.exceptions.RequestException as e:
                logger.error(f"Image classification request failed: {e}")
                return Response(
                    {"detail": str(e)},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

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
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
            file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
            try:
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
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
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

class FaceRecognitionRecognizeView(APIView):
    """Proxy view for face recognition - recognize faces in an image"""
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")

        deploy_id = data.get("deploy_id")
        image = data.get("image")
        if not image:
            return Response({"error": "image is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/recognize-face"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            files = {"image": (image.name, image.file, image.content_type)}
            inference_data = requests.post(internal_url, files=files, headers=headers, timeout=30)
            inference_data.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                return Response({"error": "Models not loaded"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face recognition error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)


class FaceRecognitionRegisterView(APIView):
    """Proxy view for face recognition - register a new face"""
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")

        deploy_id = data.get("deploy_id")
        image = data.get("image")
        name = data.get("name")

        if not image:
            return Response({"error": "image is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not name:
            return Response({"error": "name is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/register-face"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            files = {"image": (image.name, image.file, image.content_type)}
            form_data = {"name": name}
            inference_data = requests.post(internal_url, files=files, data=form_data, headers=headers, timeout=30)
            inference_data.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif inference_data.status_code == status.HTTP_409_CONFLICT:
                return Response({"error": "Identity already exists"}, status=status.HTTP_409_CONFLICT)
            elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                return Response({"error": "Models not loaded"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face registration error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)


class FaceRecognitionListView(APIView):
    """Proxy view for face recognition - list registered faces"""
    def get(self, request, *args, **kwargs):
        deploy_id = request.query_params.get("deploy_id")
        logger.info(f"{self.__class__.__name__} deploy_id:={deploy_id}")

        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/registered-faces"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            response = requests.get(internal_url, headers=headers, timeout=10)
            response.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face list error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(response.json(), status=status.HTTP_200_OK)


class FaceRecognitionDeleteView(APIView):
    """Proxy view for face recognition - delete a registered face"""
    def delete(self, request, name, *args, **kwargs):
        deploy_id = request.query_params.get("deploy_id")
        logger.info(f"{self.__class__.__name__} deploy_id:={deploy_id} name:={name}")

        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not name:
            return Response({"error": "name is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/registered-faces/{name}"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            response = requests.delete(internal_url, headers=headers, timeout=10)
            response.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            if response.status_code == status.HTTP_404_NOT_FOUND:
                return Response({"error": f"Identity '{name}' not found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face delete error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(response.json(), status=status.HTTP_200_OK)


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
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
            file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
            try:
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
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
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

class TtsInferenceView(APIView):
    """Text-to-speech inference: supports both OpenAI-style and enqueue-style endpoints."""
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            text = data.get("text") or data.get("prompt")
            if not text:
                return Response({"error": "text is required"}, status=status.HTTP_400_BAD_REQUEST)
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            try:
                model_impl = deploy.get("model_impl")
                model_name = getattr(model_impl, "model_name", None) if model_impl else None
                inference_engine = getattr(model_impl, "inference_engine", None)
                
                if inference_engine == "media":
                    headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
                    payload = {"model": model_name, "text": text, "voice": "default"}
                else:
                    headers = {"Authorization": f"Bearer {encoded_jwt}"}
                    payload = {"model": model_name, "input": text, "voice": "default"}
                
                audio_resp = requests.post(internal_url, json=payload, headers=headers, timeout=120)
                
                # If 404 on /enqueue for TTS media model, retry with /v1/audio/speech
                if audio_resp.status_code == 404 and inference_engine == "media" and "/enqueue" in internal_url:
                    logger.info(f"TTS 404 on {internal_url}, retrying with /v1/audio/speech")
                    fallback_url = internal_url.replace("/enqueue", "/v1/audio/speech")
                    audio_resp = requests.post(fallback_url, json=payload, headers=headers, timeout=120)
                
                audio_resp.raise_for_status()

                content_type = audio_resp.headers.get("Content-Type", "audio/wav")
                django_response = HttpResponse(audio_resp.content, content_type=content_type)
                django_response["Content-Disposition"] = "attachment; filename=tts_output.wav"
                django_response["Cache-Control"] = "no-cache, no-store, must-revalidate"
                return django_response

            except requests.exceptions.HTTPError as http_err:
                logger.error(f"TTS HTTP error: {http_err}")
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class OpenAIAudioSpeechView(APIView):
    """OpenAI-compatible POST /v1/audio/speech — looks up deployed TTS model by name."""
    def post(self, request, *args, **kwargs):
        data = request.data
        model_name = data.get("model")
        text = data.get("input") or data.get("text")
        if not model_name:
            return Response({"error": "model is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not text:
            return Response({"error": "input is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Find a running TTS deployment matching the requested model name
        deploy = None
        for entry in get_deploy_cache().values():
            impl = entry.get("model_impl")
            if impl and getattr(impl, "model_name", None) == model_name:
                deploy = entry
                break
        if deploy is None:
            return Response(
                {"error": f"No running deployment found for model '{model_name}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        internal_url = "http://" + deploy["internal_url"]
        try:
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
                payload = {"model": model_name, "text": text, "voice": data.get("voice", "default")}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                payload = {"model": model_name, "input": text, "voice": data.get("voice", "default")}
            
            audio_resp = requests.post(internal_url, json=payload, headers=headers, timeout=120)
            
            # If 404 on /enqueue for TTS media model, retry with /v1/audio/speech
            if audio_resp.status_code == 404 and inference_engine == "media" and "/enqueue" in internal_url:
                logger.info(f"OpenAI audio/speech 404 on {internal_url}, retrying with /v1/audio/speech")
                fallback_url = internal_url.replace("/enqueue", "/v1/audio/speech")
                audio_resp = requests.post(fallback_url, json=payload, headers=headers, timeout=120)
            
            audio_resp.raise_for_status()

            content_type = audio_resp.headers.get("Content-Type", "audio/wav")
            django_response = HttpResponse(audio_resp.content, content_type=content_type)
            django_response["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return django_response

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"OpenAI audio/speech HTTP error: {http_err}")
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ContainerLogsView(View):
    # Define event detection configuration before the get method
    SIMPLE_EVENT_KEYWORDS = [
        '[ERROR]', '[FATAL]', '[CRITICAL]',
        '[WARN]', '[WARNING]',
        'RESPONSE_Q OUT OF SYNC',
        'ABORTED', 'CORE DUMPED',
        'TERMINATED', 'EXCEPTION',
        'DESTINATION UNREACHABLE',
        'CLUSTER GENERATION FAILED',
        'APPLICATION STARTUP COMPLETE',
        'UVICORN RUNNING ON',
        'STARTED SERVER PROCESS',
        'WAITING FOR APPLICATION STARTUP',
        'WH_ARCH_YAML:',
        'PLATFORM LINUX',
        'PYTEST-',
        'ROOTDIR:',
        'PLUGINS:'
    ]
    
    @staticmethod
    def _is_complex_event(line_upper):
        """
        Check for event patterns that require multiple keyword combinations.
        
        Args:
            line_upper: Uppercase version of the log line
            
        Returns:
            bool: True if line matches a complex event pattern
        """
        if 'DEVICE |' in line_upper and 'OPENING USER MODE DEVICE DRIVER' in line_upper:
            return True

        if 'SILICONDRIVER' in line_upper and ('OPENED PCI DEVICE' in line_upper or 'DETECTED PCI' in line_upper):
            return True
        
        if 'SOFTWARE VERSION' in line_upper and 'ETHERNET FW VERSION' in line_upper:
            return True
        
        if 'COLLECTED' in line_upper and 'ITEM' in line_upper:
            return True
        
        return False
    
    @classmethod
    def _determine_message_type(cls, line):
        """
        Determine if a log line should be classified as an event or regular log.
        
        Args:
            line: The log line to classify
            
        Returns:
            str: Either "event" or "log"
        """
        line_upper = line.upper()
        
        # Check simple keyword patterns
        if any(keyword in line_upper for keyword in cls.SIMPLE_EVENT_KEYWORDS):
            return "event"
        
        # Check complex multi-keyword patterns
        if cls._is_complex_event(line_upper):
            return "event"
        
        return "log"
    
    async def get(self, request, container_id, *args, **kwargs):
        """Stream logs from a Docker container using Server-Sent Events via docker-control-service"""
        logger.info(f"ContainerLogsView received request for container_id: {container_id}")

        try:
            logger.info("Getting docker-control-service client")
            from docker_control.docker_control_client import get_docker_client
            client = get_docker_client()

            logger.info(f"Setting up log stream for container: {container_id}")

            async def generate_container_data():
                queue: asyncio.Queue = asyncio.Queue()
                loop = asyncio.get_running_loop()

                def sync_stream():
                    try:
                        for log_line in client.get_logs_stream(container_id, follow=True, tail=100):
                            loop.call_soon_threadsafe(queue.put_nowait, log_line)

                    except requests.exceptions.ConnectionError as e:
                        logger.error(f"docker-control-service unreachable: {str(e)}")
                        error_data = {
                            "type": "service_unavailable",
                            "message": "Cannot reach the docker-control-service (port 8002). Make sure it is running on the host.",
                            "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        }
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            f"data: {json.dumps(error_data)}\n\n".encode('utf-8')
                        )

                    except Exception as e:
                        logger.error(f"Error in data stream: {str(e)}")
                        error_data = {
                            "type": "error",
                            "message": f"Error streaming data: {str(e)}",
                            "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        }
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            f"data: {json.dumps(error_data)}\n\n".encode('utf-8')
                        )

                    finally:
                        loop.call_soon_threadsafe(queue.put_nowait, None)

                thread = threading.Thread(target=sync_stream, daemon=True)
                thread.start()

                while True:
                    chunk = await queue.get()
                    if chunk is None:
                        break
                    yield chunk

            response = StreamingHttpResponse(
                generate_container_data(),
                content_type='text/event-stream'
            )

            # Set required headers for SSE
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'

            return response

        except Exception as e:
            logger.error(f"Error streaming container data: {str(e)}")

            async def error_stream():
                error_data = {
                    "type": "service_unavailable",
                    "message": f"Failed to initialize log stream: {str(e)}",
                    "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                yield f"data: {json.dumps(error_data)}\n\n".encode('utf-8')

            response = StreamingHttpResponse(error_stream(), content_type='text/event-stream')
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'
            return response


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
                
                # Get internal URL and port bindings for external URL construction
                internal_url = deploy_info.get("internal_url", "")
                health_url = deploy_info.get("health_url", "")
                port_bindings = deploy_info.get("port_bindings", {})
                
                # Construct external URLs using port bindings
                chat_completions_url = ""
                completions_url = ""
                health_endpoint_url = ""
                
                if internal_url and port_bindings:
                    # Extract the service port from internal_url (e.g., "container_name:7000/v1/chat/completions" -> "7000")
                    service_port = None
                    if ":" in internal_url:
                        service_port = internal_url.split(":")[1].split("/")[0]
                    
                    # Find the external port mapping for this service port
                    external_host = "localhost"  # Default to localhost for external access
                    external_port = None
                    
                    # Look for the port binding that matches the service port
                    for container_port, host_bindings in port_bindings.items():
                        if container_port and host_bindings:
                            # container_port format: "7000/tcp"
                            container_port_num = container_port.split("/")[0]
                            if container_port_num == service_port:
                                # host_bindings format: [{"HostIp": "0.0.0.0", "HostPort": "8013"}]
                                if host_bindings and len(host_bindings) > 0:
                                    external_port = host_bindings[0].get("HostPort")
                                    host_ip = host_bindings[0].get("HostIp", "0.0.0.0")
                                    # Use localhost for external access instead of 0.0.0.0
                                    if host_ip == "0.0.0.0":
                                        external_host = "localhost"
                                    else:
                                        external_host = host_ip
                                break
                    
                    # Construct external URLs if we found the port mapping
                    if external_port:
                        base_external_url = f"http://{external_host}:{external_port}"
                        chat_completions_url = f"{base_external_url}/v1/chat/completions"
                        completions_url = f"{base_external_url}/v1/completions"
                        health_endpoint_url = f"{base_external_url}/health"
                    else:
                        # Fallback to internal URL if no port mapping found
                        logger.warning(f"No port mapping found for service port {service_port} in {deploy_id}")
                        if internal_url:
                            # Extract hostname:port from internal_url
                            if "/v1/chat/completions" in internal_url:
                                base_internal_url = internal_url.replace("/v1/chat/completions", "")
                            elif "/v1/completions" in internal_url:
                                base_internal_url = internal_url.replace("/v1/completions", "")
                            else:
                                base_internal_url = internal_url
                            
                            chat_completions_url = f"http://{base_internal_url}/v1/chat/completions"
                            completions_url = f"http://{base_internal_url}/v1/completions"
                            health_endpoint_url = f"http://{health_url}" if health_url else f"http://{base_internal_url}/health"
                
                # Generate JWT token for this model
                team_id = os.getenv("TEAM_ID", "tenstorrent")
                token_id = os.getenv("TOKEN_ID", "debug-test")
                json_payload = {"team_id": team_id, "token_id": token_id}
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
                        "model_impl": {
                            "model_name": getattr(model_impl, "model_name", None) if model_impl else None,
                            "hf_model_id": getattr(model_impl, "hf_model_id", None) if model_impl else None,
                            "model_type": model_type,  # Use the string value instead of the enum object
                        } if model_impl else {},
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
