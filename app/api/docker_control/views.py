# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import subprocess

from django.shortcuts import render
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response

from .forms import DockerForm
from .docker_utils import run_container, stop_container, get_container_status
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
                reset_response = self.perform_reset()
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

    def perform_reset(self):
        try:
            logger.info("Running tt-smi reset command.")
            
            def stream_command_output(command):
                logger.info(f"Executing command: {' '.join(command)}")
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                output = []
                for line in iter(process.stdout.readline, ''):
                    logger.info(f"Command output: {line.strip()}")
                    output.append(line)
                process.stdout.close()
                return_code = process.wait()
                if return_code != 0:
                    logger.info(f"Command failed with return code {return_code}")
                    output.append(f"Command failed with return code {return_code}")
                    return {
                        "status": "error",
                        "output": ''.join(output)
                    }
                else:
                    logger.info(f"Command completed successfully with return code {return_code}")
                    return {
                        "status": "success",
                        "output": ''.join(output)
                    }

            # Run the tt-smi reset command
            reset_result = stream_command_output(['tt-smi', '-r', '0'])

            # Ensure a valid response is returned
            return reset_result or {"status": "error", "output": "No output from reset command"}

        except Exception as e:
            logger.exception("Exception occurred during reset operation.")
            return {"status": "error", "message": str(e)}




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


# tt-smi reset command view
class ResetBoardView(APIView):
    def post(self, request, *args, **kwargs):
        def stream_command_output(command):
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in iter(process.stdout.readline, ''):
                yield f"{line}\n"
            process.stdout.close()
            return_code = process.wait()
            if return_code != 0:
                yield f"Command failed with return code {return_code}\n"

        def stream_response(command):
            return StreamingHttpResponse(stream_command_output(command), content_type='text/plain')

        try:
            # Run the tt-smi reset command
            reset_response = stream_response(['tt-smi', '-r', '0'])
            
            # Verify the reset by listing available boards
            # verify_response = stream_response(['tt-smi', '-ls'])
            
            # Combine the outputs
            def combined_stream():
                yield "Running tt-smi reset command:\n"
                yield from reset_response.streaming_content
                yield "\nVerifying board status:\n"
                # yield from verify_response.streaming_content

            return StreamingHttpResponse(combined_stream(), content_type='text/plain')
        except Exception as e:
            return Response({'status': 'error', 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
