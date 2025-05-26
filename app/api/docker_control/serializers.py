# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from pathlib import Path

from rest_framework import serializers

from shared_config.backend_config import backend_config
from shared_config.model_config import model_implmentations
from .docker_utils import get_model_weights_path


class DeploymentSerializer(serializers.Serializer):
    model_id = serializers.CharField(required=False, allow_blank=True)
    weights_id = serializers.CharField(required=False, allow_blank=True)
    is_external = serializers.BooleanField(required=False, default=False)
    external_port = serializers.IntegerField(required=False, default=7000)
    external_container_id = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        model_id = data.get("model_id")
        weights_id = data.get("weights_id")
        is_external = data.get("is_external", False)
        external_port = data.get("external_port", 7000)
        external_container_id = data.get("external_container_id")
        
        # For external containers, model_id is optional
        if not is_external and not model_id:
            raise serializers.ValidationError(
                "model_id is required for non-external containers"
            )
            
        # For external containers with container_id, model_id is optional
        if is_external and external_container_id:
            return data
            
        # For external containers without container_id, model_id is required
        if is_external and not external_container_id and not model_id:
            raise serializers.ValidationError(
                "Either model_id or external_container_id is required for external containers"
            )
            
        # check if model_id has impl
        if model_id and model_id not in model_implmentations.keys():
            raise serializers.ValidationError(
                f"Invalid model_id={model_id}. No implementation in model config."
            )
            
        impl = model_implmentations[model_id] if model_id else None
        
        # Only validate weights if not external
        if not is_external and weights_id:
            # check if weights_path exists in presistent storage
            # TODO: use weight_id that is not file name
            weights_path = get_model_weights_path(impl.backend_weights_dir, weights_id)
            if not weights_path.exists() or not weights_path.is_dir():
                raise serializers.ValidationError(
                    f"The specified weights_path={weights_path} does not exist or is not a directory."
                )
                
        # Validate external port if external
        if is_external and (external_port < 1 or external_port > 65535):
            raise serializers.ValidationError(
                f"Invalid external_port={external_port}. Port must be between 1 and 65535."
            )
            
        return data


class StopSerializer(serializers.Serializer):
    container_id = serializers.CharField(required=True)
