# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import json

from django.http import StreamingHttpResponse, JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from shared_config.logger_config import get_logger

from .executor import execute_workflow
from .models import Workflow, WorkflowRun
from .serializers import (
    WorkflowRunInputSerializer,
    WorkflowRunSerializer,
    WorkflowSerializer,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Workflow CRUD
# ---------------------------------------------------------------------------


class WorkflowListCreateView(APIView):
    """GET  /workflows/          – list all workflows
    POST /workflows/          – create a new workflow
    """

    def get(self, request):
        workflows = Workflow.objects.filter(is_template=False)
        serializer = WorkflowSerializer(workflows, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = WorkflowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class WorkflowDetailView(APIView):
    """GET    /workflows/{id}/   – retrieve
    PUT    /workflows/{id}/   – full update
    DELETE /workflows/{id}/   – delete
    """

    def _get(self, pk):
        try:
            return Workflow.objects.get(pk=pk)
        except Workflow.DoesNotExist:
            return None

    def get(self, request, pk):
        wf = self._get(pk)
        if wf is None:
            return Response(
                {"error": "Workflow not found"}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(WorkflowSerializer(wf).data)

    def put(self, request, pk):
        wf = self._get(pk)
        if wf is None:
            return Response(
                {"error": "Workflow not found"}, status=status.HTTP_404_NOT_FOUND
            )
        serializer = WorkflowSerializer(wf, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        wf = self._get(pk)
        if wf is None:
            return Response(
                {"error": "Workflow not found"}, status=status.HTTP_404_NOT_FOUND
            )
        wf.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


class WorkflowTemplateListView(APIView):
    """GET /workflows/templates/ – list preset workflow templates."""

    def get(self, request):
        templates = Workflow.objects.filter(is_template=True)
        serializer = WorkflowSerializer(templates, many=True)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Workflow Run
# ---------------------------------------------------------------------------


@method_decorator(csrf_exempt, name="dispatch")
class WorkflowRunView(View):
    """POST /workflows/{pk}/run/ – execute a workflow, returns SSE stream."""

    async def post(self, request, pk):
        try:
            wf = await Workflow.objects.aget(pk=pk)
        except Workflow.DoesNotExist:
            return JsonResponse({"error": "Workflow not found"}, status=404)

        try:
            body = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({"error": "Invalid JSON body"}, status=400)

        serializer = WorkflowRunInputSerializer(data=body)
        if not serializer.is_valid():
            return JsonResponse({"errors": serializer.errors}, status=400)

        initial_input = serializer.validated_data["input"]
        graph_data = serializer.validated_data.get("graph_data") or wf.graph_data

        run = await WorkflowRun.objects.acreate(
            workflow=wf,
            initial_input=initial_input,
        )

        async def stream():
            async for chunk in execute_workflow(
                graph_data, initial_input, run
            ):
                yield chunk

        return StreamingHttpResponse(
            streaming_content=stream(),
            content_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )


# ---------------------------------------------------------------------------
# Run status
# ---------------------------------------------------------------------------


class WorkflowRunDetailView(APIView):
    """GET /workflows/runs/{run_id}/ – get run status & outputs."""

    def get(self, request, run_id):
        try:
            run = WorkflowRun.objects.get(pk=run_id)
        except WorkflowRun.DoesNotExist:
            return Response(
                {"error": "Run not found"}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(WorkflowRunSerializer(run).data)
