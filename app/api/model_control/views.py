# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/views.py
from pathlib import Path

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import StreamingHttpResponse

from .serializers import InferenceSerializer, ModelWeightsSerializer
from model_control.model_utils import (
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
        data = request.data
        logger.info(f"HealthView data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.pop("deploy_id")
            deploy = get_deploy_cache()[deploy_id]
            health_url = "http://" + deploy["health_url"]
            logger.info(f"health_url:= {health_url}")
            check_passed, data = health_check(health_url, json_data=None)
            if check_passed:
                ret_status = status.HTTP_200_OK
            else:
                ret_status = status.HTTP_503_SERVICE_UNAVAILABLE
            return Response(data, status=ret_status)
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
            assert (
                weights_dir.exists()
            ), f"weights_dir:={weights_dir} does not exist. Check models API initiliazation."
            weights = [
                {"weights_id": f"id_{w.name}", "name": w.name}
                for w in weights_dir.iterdir()
            ]
            return Response(weights, status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
