# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from pathlib import Path

from rest_framework import serializers

from shared_config.backend_config import backend_config
from shared_config.model_config import model_implmentations
from .docker_utils import get_model_weights_path


class DeploymentSerializer(serializers.Serializer):
    model_id = serializers.CharField(required=True)
    weights_id = serializers.CharField(required=False, allow_blank=True)
    # device_id accepts a single integer OR a comma-separated list (e.g. "0,1") for
    # multi-chip single-card deployments where --device-id 0,1 is passed to the inference server.
    device_id = serializers.CharField(required=False, default="0", allow_blank=True)
    host_port = serializers.IntegerField(required=False, default=None, min_value=1024, max_value=65535, allow_null=True)

    def validate_device_id(self, value):
        parts = str(value).split(",")
        for part in parts:
            part = part.strip()
            if not part.isdigit() or not (0 <= int(part) <= 3):
                raise serializers.ValidationError(
                    f"Each device_id value must be an integer between 0 and 3, got '{part}'."
                )
        return ",".join(p.strip() for p in parts)

    def validate(self, data):
        model_id = data.get("model_id")
        weights_id = data.get("weights_id")
        # check if model_id has impl
        if model_id not in model_implmentations.keys():
            raise serializers.ValidationError(
                f"Invalid model_id={model_id}. No implementation in model config."
            )
        impl = model_implmentations[model_id]
        if weights_id:
            # check if weights_path exists in presistent storage
            # TODO: use weight_id that is not file name
            weights_path = get_model_weights_path(impl.backend_weights_dir, weights_id)
            if not weights_path.exists() or not weights_path.is_dir():
                raise serializers.ValidationError(
                    f"The specified weights_path={weights_path} does not exist or is not a directory."
                )
        return data


class StopSerializer(serializers.Serializer):
    container_id = serializers.CharField(required=True)