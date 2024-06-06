# docker_control/views.py
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
