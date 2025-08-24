# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from dataclasses import dataclass, asdict
from typing import Set, Dict, Any, Union
from pathlib import Path

from shared_config.device_config import DeviceConfigurations
from shared_config.backend_config import backend_config
from shared_config.setup_config import SetupTypes
from shared_config.model_type_config import ModelTypes
from shared_config.model_type_config import ModelTypes
from shared_config.logger_config import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


def load_dotenv_dict(env_path: Union[str, Path]) -> Dict[str, str]:
    if not env_path:
        return {}

    # instead, use tt-studio configured JWT_SECRET
    exluded_keys = ["JWT_SECRET"]
    env_path = Path(env_path)
    if not env_path.exists():
        logger.error(f"Env file not found: {env_path}")
    env_dict = {}
    logger.info(f"Using env file: {env_path}")
    with open(env_path) as f:
        lines = f.readlines()
    for line in lines:
        if line.strip() and not line.startswith('#'):
            key, value = line.strip().split('=', 1)
            # expand any $VAR or ${VAR} and ~
            if key not in exluded_keys:
                env_dict[key] = value
    return env_dict


@dataclass(frozen=True)
class ModelImpl:
    """
    Model implementation configuration defines everything known about a model
    implementations before runtime, e.g. not handling ports, available devices"""

    image_name: str
    image_tag: str
    device_configurations: Set["DeviceConfigurations"]
    docker_config: Dict[str, Any]
    service_route: str
    setup_type: SetupTypes
    model_type: ModelTypes
    hf_model_id: str = None
    model_name: str = None     # uses defaults based on hf_model_id
    model_id: str = None       # uses defaults based on hf_model_id
    impl_id: str = "tt-metal"  # implementation ID
    version: str = "0.0.1"
    shm_size: str = "32G"
    service_port: int = 7000
    env_file: str = ""
    health_route: str = "/health"

    def __post_init__(self):
        # _init methods compute values that are dependent on other values
        self._init_model_name()
        
        self.docker_config.update({"volumes": self.get_volume_mounts()})
        self.docker_config["shm_size"] = self.shm_size
        self.docker_config["environment"]["HF_MODEL_PATH"] = self.hf_model_id
        self.docker_config["environment"]["HF_HOME"] = Path(
            backend_config.model_container_cache_root
        ).joinpath("huggingface")
        
        # Set environment variable if N150_WH_ARCH_YAML, N300_WH_ARCH_YAML, or N300x4_WH_ARCH_YAML is in the device configurations
        if (
            DeviceConfigurations.N150_WH_ARCH_YAML in self.device_configurations
            or DeviceConfigurations.N300_WH_ARCH_YAML in self.device_configurations
            or DeviceConfigurations.N300x4_WH_ARCH_YAML in self.device_configurations
        ):
            self.docker_config["environment"]["WH_ARCH_YAML"] = (
                "wormhole_b0_80_arch_eth_dispatch.yaml"
            )

        # model env file must be interpreted here
        if not self.env_file:
            _env_file = self.get_model_env_file()
        else:
            _env_file = self.env_file

        # env file should be in persistent volume mounted
        env_dict = load_dotenv_dict(_env_file)
        # env file overrides any existing docker environment variables
        self.docker_config["environment"].update(env_dict)

    @property
    def image_version(self) -> str:
        return f"{self.image_name}:{self.image_tag}"

    @property
    def volume_name(self) -> str:
        # by default share volume with later versions of the image
        return f"volume_{self.model_id}"

    @property
    def container_base_name(self) -> str:
        return self.image_name.split("/")[-1]

    @property
    def host_path(self) -> Path:
        return Path(backend_config.host_peristent_storage_volume).joinpath(
            self.volume_name
        )

    @property
    def volume_path(self) -> Path:
        return Path(backend_config.persistent_storage_volume).joinpath(self.volume_name)

    @property
    def backend_weights_dir(self) -> Path:
        weights_dir = self.volume_path.joinpath(backend_config.weights_dir)
        return weights_dir

    @property
    def model_container_weights_dir(self) -> Path:
        weights_dir = Path(
            backend_config.model_container_cache_root, backend_config.weights_dir
        )
        return weights_dir

    @property
    def backend_hf_home(self) -> Path:
        return self.backend_weights_dir.joinpath("huggingface")

    def _init_model_name(self):
        # Note: ONLY run this in __post_init__
        # need to use __setattr__ because instance is frozen
        assert self.hf_model_id or self.model_name, "either hf_model_id or model_name must be set."
        if not self.model_name:
            # use basename of HF model ID to use same format as tt-transformers
            object.__setattr__(self, 'model_name', Path(self.hf_model_id).name)
        if not self.model_id:
            object.__setattr__(self, 'model_id', self.get_default_model_id())
        if not self.hf_model_id:
            logger.info(f"model_name:={self.model_name} does not have a hf_model_id set")

    def get_default_model_id(self):
        return f"id_{self.impl_id}-{self.model_name}-v{self.version}"
        
    def get_model_env_file(self):
        ret_env_file = None
        model_env_dir_name = "model_envs"
        model_env_dir = Path(backend_config.persistent_storage_volume).joinpath(model_env_dir_name)
        if model_env_dir.exists():
            env_fname = f"{self.model_name}.env"
            model_env_fpath = model_env_dir.joinpath(env_fname)
            if model_env_fpath.exists():
                ret_env_file = model_env_fpath
            else:
                logger.warning(f"for model {self.model_name} env file: {model_env_fpath} does not exist, have you run tt-inference-server setup.sh for the model?")
        else:
            logger.warning(f"{model_env_dir} does not exist, have you run tt-inference-server setup.sh?")
        return ret_env_file

    def get_volume_mounts(self):
        # use type=volume for persistent storage with a Docker managed named volume
        # target: this should be set to same location as the CACHE_ROOT environment var
        host_hugepages_path = "/dev/hugepages-1G"
        volume_mounts = {
            self.host_path: {
                "bind": backend_config.model_container_cache_root,
                "mode": "rw",
            },
            host_hugepages_path: {"bind": "/dev/hugepages-1G", "mode": "rw"},
        }
        return volume_mounts

    def setup(self):
        # verify model setup and runtime setup 
        self.init_volumes()

    def init_volumes(self):
        # check volumes
        if self.setup_type == SetupTypes.TT_INFERENCE_SERVER:
            if self.volume_path.exists():
                # logger.info(f"Found {self.volume_path}")  # Temporarily hidden
                pass
            else:
                # logger.info(f"Model volume does not exist: {self.volume_path}")  # Temporarily hidden
                # logger.error(f"Initialize this model by running the tt-inference-server setup.sh script")  # Temporarily hidden
                pass
        elif self.setup_type == SetupTypes.MAKE_VOLUMES:
            if not self.volume_path.exists():
                # if not setup is required for the model, backend can make the volume
                self.volume_path.mkdir(parents=True, exist_ok=True)
        elif self.setup_type == SetupTypes.NO_SETUP:
            # logger.info(f"Model {self.model_id} does not require a volume")  # Temporarily hidden
            pass

    def asdict(self):
        return asdict(self)


def base_docker_config():
    return {
        # Note: mounts and devices are determined in `docker_utils.py`
        "auto_remove": True,
        "cap_add": "ALL",  # TODO: add minimal permissions
        "detach": True,
        "environment": {
            "JWT_SECRET": backend_config.jwt_secret,
            "CACHE_ROOT": backend_config.model_container_cache_root,
        },
    }


# model_ids are unique strings to define a model, they could be uuids but
# using friendly strings prefixed with id_ is more helpful for debugging

# Helper device configuration sets for easier management
N150_N300 = {DeviceConfigurations.N150, DeviceConfigurations.N150_WH_ARCH_YAML, DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML}
ALL_BOARDS = {DeviceConfigurations.N150, DeviceConfigurations.N150_WH_ARCH_YAML, DeviceConfigurations.N300, DeviceConfigurations.N300_WH_ARCH_YAML, DeviceConfigurations.N300x4, DeviceConfigurations.N300x4_WH_ARCH_YAML}
T3000_ONLY = {DeviceConfigurations.N300x4, DeviceConfigurations.N300x4_WH_ARCH_YAML}

model_implmentations_list = [
    # Speech Recognition - Can run on N150 and N300
    ModelImpl(
        model_name="Whisper-Distil-Large-v3",
        model_id="id_whisper_distil_large_v3_v0.1.0",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-whisper-distil-large-v3-dev",
        image_tag="v0.0.1-tt-metal-1a1a9e2bb102",
        device_configurations=ALL_BOARDS,  # Can run on N150 and N300
        docker_config=base_docker_config(),
        shm_size="32G",
        service_port=7000,
        service_route="/inference",
        health_route="/",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.SPEECH_RECOGNITION,
    ),
    # TODO: add this model back in when its in tt-inference-server-main branch
    # Image Generation - Can run on N150 and N300
    # ModelImpl(
    #     model_name="Stable-Diffusion-3.5-medium",
    #     model_id="id_stable_diffusion_3.5_mediumv0.1.0",
    #     image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-stable-diffusion-3.5-src-base",
    #     image_tag="v0.0.1-tt-metal-a0560feb3eed",
    #     device_configurations=ALL_BOARDS,  # Can run on N150 and N300
    #     docker_config=base_docker_config(),
    #     shm_size="32G",
    #     service_port=7000,
    #     service_route="/enqueue",
    #     health_route="/",
    #     setup_type=SetupTypes.TT_INFERENCE_SERVER,
    #     model_type=ModelTypes.IMAGE_GENERATION,
    # ),

    # Image Generation - Can run on N150 and N300
    ModelImpl(
        model_name="Stable-Diffusion-1.4",
        model_id="id_stable_diffusionv0.1.0",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-stable-diffusion-1.4-src-base",
        image_tag="v0.0.1-tt-metal-cc8b4e1dac99",
        device_configurations=ALL_BOARDS,  # Can run on N150 and N300
        docker_config=base_docker_config(),
        shm_size="32G",
        service_port=7000,
        service_route="/enqueue",
        health_route="/",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.IMAGE_GENERATION,
    ),

    # Object Detection - Can run on all boards
    ModelImpl(
        model_name="YOLOv4",
        model_id="id_yolov4v0.0.1",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-yolov4-src-base",
        image_tag="v0.0.1-tt-metal-65d246482b3f",
        device_configurations=ALL_BOARDS,  # Can run on all boards
        docker_config=base_docker_config(),
        shm_size="32G",
        service_port=7000,
        service_route="/objdetection_v2",
        setup_type=SetupTypes.NO_SETUP,
        model_type=ModelTypes.OBJECT_DETECTION
    ),

    # Mock Chat 
    # TODO: currently not working.
    # remove this model for now until its in tt-inference-server-main branch
    #  TODO: add / make a new mock model
    # ModelImpl(
    #     hf_model_id="meta-llama/Llama-3.1-70B-Instruct",
    #     model_name="Mock-Llama-3.1-70B-Instruct",
    #     model_id="id_mock_vllm_modelv0.0.1",
    #     image_name="ghcr.io/tenstorrent/tt-inference-server/mock.vllm.openai.api",
    #     image_tag="v0.0.1-tt-metal-385904186f81-384f1790c3be",
    #     device_configurations={DeviceConfigurations.CPU},
    #     docker_config=base_docker_config(),
    #     shm_size="1G",
    #     service_port=7000,
    #     service_route="/v1/chat/completions",
    #     setup_type=SetupTypes.MAKE_VOLUMES,
    #     model_type=ModelTypes.MOCK
    # ),

    # --- Chat Models ---

    # 1B, 3B, 8B, 11B models - Can run on all boards
    ModelImpl(
        hf_model_id="meta-llama/Llama-3.2-1B-Instruct",
        image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
        image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
        device_configurations=ALL_BOARDS,  # Can run on all boards
        docker_config=base_docker_config(),
        service_route="/v1/chat/completions",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.CHAT

    ),
    ModelImpl(
        hf_model_id="meta-llama/Llama-3.2-3B-Instruct",
        image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
        image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
        device_configurations=ALL_BOARDS,  # Can run on all boards
        docker_config=base_docker_config(),
        service_route="/v1/chat/completions",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.CHAT
  
    ),
    ModelImpl(
        hf_model_id="meta-llama/Llama-3.1-8B-Instruct",
        image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
        image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
        device_configurations=ALL_BOARDS,  # Can run on all boards
        docker_config=base_docker_config(),
        service_route="/v1/chat/completions",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.CHAT

    ),
    # TODO: add this model back in when its in tt-inference-server-main branch
    # ModelImpl(
    #     hf_model_id="meta-llama/Llama-3.2-11B-Vision-Instruct",
    #     image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
    #     image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
    #     device_configurations=ALL_BOARDS,  # Can run on all boards
    #     docker_config=base_docker_config(),
    #     service_route="/v1/chat/completions",
    #     setup_type=SetupTypes.TT_INFERENCE_SERVER,
    #     model_type=ModelTypes.CHAT
 
    # ),


    # 70B models - Only T3000

    ModelImpl(
        hf_model_id="meta-llama/Llama-3.1-70B-Instruct",
        image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
        image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
        device_configurations=T3000_ONLY,  # Only T3000
        docker_config=base_docker_config(),
        shm_size="32G",
        service_port=7000,
        service_route="/v1/chat/completions",
        env_file=os.environ.get("VLLM_LLAMA31_ENV_FILE"),
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.CHAT
    ),
    # ModelImpl(
    #     hf_model_id="meta-llama/Llama-3.1-70B-Instruct",
    #     image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
    #     image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
    #     device_configurations=T3000_ONLY,  # Only T3000
    #     docker_config=base_docker_config(),
    #     service_route="/v1/chat/completions",
    #     setup_type=SetupTypes.TT_INFERENCE_SERVER,
    #     model_type=ModelTypes.CHAT
    # ),
    ModelImpl(
        hf_model_id="meta-llama/Llama-3.3-70B-Instruct",
        image_name="ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64",
        image_tag="0.0.4-v0.56.0-rc47-e2e0002ac7dc",
        device_configurations=T3000_ONLY,  # Only T3000
        docker_config=base_docker_config(),
        service_route="/v1/chat/completions",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.CHAT
    ),
    #! Add new model vLLM model implementations here
]

def validate_model_implemenation_config(impl):
    # no / in model_id strings, model_id will be used in path names
    assert not "/" in impl.model_id


# build and validate the model_implmentations config
model_implmentations = {}
for impl in model_implmentations_list:
    validate_model_implemenation_config(impl)
    model_implmentations[impl.model_id] = impl