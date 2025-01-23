# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/views.py
from pathlib import Path
import requests
from PIL import Image
import io

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import StreamingHttpResponse

from .serializers import InferenceSerializer, ModelWeightsSerializer
from model_control.model_utils import (
    encoded_jwt,
    get_deploy_cache,
    stream_response_from_external_api,
    health_check,
)
from shared_config.model_config import model_implmentations
from shared_config.logger_config import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


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
            data["model"] = deploy["model_impl"].hf_model_path
            response_stream = stream_response_from_external_api(internal_url, data)
            return StreamingHttpResponse(response_stream, content_type="text/plain")
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

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
                content = {"message": "Unavaliable", "details": health_content}
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
        logger.info(f"InferenceView data:={data}")
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


class ImageGenerationInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special image generation inference view that performs special file handling"""
        data = request.data
        logger.info(f"InferenceView data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            image = data.get("prompt")  # we should only receive 1 prompt
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            breakpoint()
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
