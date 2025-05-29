# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.shortcuts import render
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response

import docker
import os 
from .forms import DockerForm
from .docker_utils import (
    run_container,
    run_agent_container, 
    stop_container,
    get_container_status,
    perform_reset,
)
from shared_config.model_config import model_implmentations
from shared_config.model_type_config import ModelTypes
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

            # Find agent container 
            client = docker.from_env()
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
            is_external = request.data.get("is_external", False)
            external_port = request.data.get("external_port", 7000)
            external_container_id = request.data.get("external_container_id")
            
            impl = model_implmentations[impl_id]
            response = run_container(
                impl, 
                weights_id, 
                is_external=is_external, 
                external_port=external_port,
                external_container_id=external_container_id
            )
            
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
