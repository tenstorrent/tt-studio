# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from rest_framework import serializers

from .models import Workflow, WorkflowRun


class WorkflowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workflow
        fields = [
            "id",
            "name",
            "description",
            "graph_data",
            "is_template",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class WorkflowRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowRun
        fields = [
            "id",
            "workflow",
            "status",
            "initial_input",
            "node_outputs",
            "error",
            "started_at",
            "completed_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "node_outputs",
            "error",
            "started_at",
            "completed_at",
        ]


class WorkflowRunInputSerializer(serializers.Serializer):
    """Validates the POST body for /workflows/{id}/run/"""

    input = serializers.CharField(required=True, help_text="Initial user input text")
