from pathlib import Path

from rest_framework import serializers

from shared_config.backend_config import backend_config
from shared_config.model_config import model_implmentations
from model_control.model_utils import get_deploy_cache


class InferenceSerializer(serializers.Serializer):
    deploy_id = serializers.CharField(required=True)

    def validate(self, data):
        deploy_id = data.get("deploy_id")
        # check if model_id has impl
        deploy_cache = get_deploy_cache()
        if deploy_id not in deploy_cache.keys():
            raise serializers.ValidationError(
                f"Invalid deploy_id={deploy_id}. Deployed ids are: {list(deploy_cache.keys())}"
            )
        return data


class ModelWeightsSerializer(serializers.Serializer):
    model_id = serializers.CharField(required=True)

    def validate(self, data):
        model_id = data.get("model_id")
        # check if model_id has impl
        if model_id not in model_implmentations.keys():
            raise serializers.ValidationError(
                f"Invalid model_id={model_id}. Valid model_ids are: {list(model_implmentations.keys())}"
            )
        return data
