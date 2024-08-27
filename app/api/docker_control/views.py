# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.shortcuts import render
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response

from .forms import DockerForm
from .docker_utils import run_container, stop_container, get_container_status, perform_reset
from shared_config.model_config import model_implmentations
from .serializers import DeploymentSerializer, StopSerializer
from shared_config.logger_config import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

class StopView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = StopSerializer(data=request.data)
        if serializer.is_valid():
            container_id = request.data.get("container_id")
            logger.info(f"Received request to stop container with ID: {container_id}")
            
            # Stop the container
            stop_response = stop_container(container_id)
            logger.info(f"Stop response: {stop_response}")
            
            # Perform reset if the stop was successful
            reset_response = None
            if stop_response.get("status") == "success":
                reset_response = perform_reset()
                logger.info(f"Reset response: {reset_response}")
            
            # Ensure that we always return a status field
            combined_status = "success" if stop_response.get("status") == "success" else "error"
            
            logger.info(f"Returning responses: {stop_response}, {reset_response}")
            return Response({
                "status": combined_status,
                "stop_response": stop_response,
                "reset_response": reset_response
            }, status=status.HTTP_200_OK)
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

            # Stream the response back to the client
            return StreamingHttpResponse(reset_response.get('output'), content_type='text/plain')
        except Exception as e:
            logger.exception("Exception occurred during reset operation.")
            return Response({'status': 'error', 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
