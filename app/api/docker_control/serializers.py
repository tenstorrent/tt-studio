from pathlib import Path

from rest_framework import serializers

from .backend_config import backend_config
from .model_config import model_implmentations


class DeploymentSerializer(serializers.Serializer):
    model_id = serializers.CharField(required=True)
    weights_path = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        model_id = data.get("model_id")
        weights_path = data.get("weights_path")
        # check if model_id has impl
        if model_id not in model_implmentations.keys():
            raise serializers.ValidationError(
                f"Invalid model_id={model_id}. No implementation in model config."
            )
        impl = model_implmentations[model_id]
        if weights_path:
            # check if weights_path exists in presistent storage
            weights_path = Path(
                backend_config.persistent_storage_volume, impl.image_volume
            )
            if not weights_path.exists() or not weights_path.is_dir():
                raise serializers.ValidationError(
                    f"The specified weights_path={weights_path} does not exist or is not a directory."
                )
        return data


class StopSerializer(serializers.Serializer):
    container_id = serializers.CharField(required=True)
