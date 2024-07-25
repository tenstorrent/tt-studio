# docker_control/views.py


import subprocess

from django.shortcuts import render

# from django.http import JsonResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response

from .forms import DockerForm
from .docker_utils import run_container, stop_container, get_container_status
from shared_config.model_config import model_implmentations
from .serializers import DeploymentSerializer, StopSerializer


class StopView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = StopSerializer(data=request.data)
        if serializer.is_valid():
            container_id = request.data.get("container_id")
            response = stop_container(container_id)
            return Response(response, status=status.HTTP_200_OK)
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


# tt-smi reset command view
class ResetBoardView(APIView):
    def post(self, request, *args, **kwargs):
        def run_command(command, shell=False):
            try:
                result = subprocess.run(command, shell=shell, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                return result.stdout, result.stderr, result.returncode
            except subprocess.CalledProcessError as e:
                return e.stdout, e.stderr, e.returncode

        try:
            # Install Rust
            stdout, stderr, returncode = run_command(['curl', '--proto', '=https', '--tlsv1.2', '-sSf', 'https://sh.rustup.rs', '|', 'sh'], shell=True)
            if returncode != 0:
                return Response({'status': 'error', 'message': f'Error installing Rust: {stderr}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Source Rust environment
            stdout, stderr, returncode = run_command(['source', '$HOME/.cargo/env'], shell=True)
            if returncode != 0:
                return Response({'status': 'error', 'message': f'Error sourcing Rust environment: {stderr}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Install tt-smi
            stdout, stderr, returncode = run_command(['cargo', 'install', 'tt-smi'])
            if returncode != 0:
                return Response({'status': 'error', 'message': f'Error installing tt-smi: {stderr}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Run the tt-smi command
            stdout, stderr, returncode = run_command(['tt-smi', '-lr', '0'])
            if returncode != 0:
                return Response({'status': 'error', 'message': f'Error running tt-smi: {stderr}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response({'status': 'success', 'message': 'Board reset successfully.', 'output': stdout}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'status': 'error', 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)