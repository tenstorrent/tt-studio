# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from dataclasses import dataclass, asdict
from typing import Set, Dict, Any, Union
from pathlib import Path

from shared_config.device_config import DeviceConfigurations
from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


def load_dotenv_dict(env_path: Union[str, Path]) -> Dict[str, str]:
    env_path = Path(env_path)
    if not env_path.exists():
        logger.error(f"Env file not found: {env_path}")
    env_dict = {}
    with open(env_path) as f:
        lines = f.readlines()
    for line in lines:
        if line.strip() and not line.startswith('#'):
            key, value = line.strip().split('=', 1)
            # expand any $VAR or ${VAR} and ~
            value = os.path.expandvars(value)
            env_dict[key] = value
    return env_dict


@dataclass(frozen=True)
class ModelImpl:
    """
    Model implementation configuration defines everything known about a model
    implementations before runtime, e.g. not handling ports, available devices"""

    model_name: str
    model_id: str
    image_name: str
    image_tag: str
    device_configurations: Set["DeviceConfigurations"]
    docker_config: Dict[str, Any]
    user_uid: int  # user inside docker container uid (for file permissions)
    user_gid: int  # user inside docker container gid (for file permissions)
    shm_size: str
    service_port: int
    service_route: str
    env_file: str = ""
    health_route: str = "/health"
    hf_model_path: str = ""

    def __post_init__(self):
        self.docker_config.update({"volumes": self.get_volume_mounts()})
        self.docker_config["shm_size"] = self.shm_size
        self.docker_config["environment"]["HF_MODEL_PATH"] = self.hf_model_path
        self.docker_config["environment"]["HF_HOME"] = Path(
            backend_config.model_container_cache_root
        ).joinpath("huggingface")
        
        # Set environment variable if N150 or N300x4 is in the device configurations
        if DeviceConfigurations.N150 in self.device_configurations or DeviceConfigurations.N300x4 in self.device_configurations:
            self.docker_config["environment"]["WH_ARCH_YAML"] = "wormhole_b0_80_arch_eth_dispatch.yaml"

        if self.env_file:
            logger.info(f"Using env file: {self.env_file}")
            # env file should be in persistent volume mounted
            env_dict = load_dotenv_dict(self.env_file)
            # env file overrides any existing docker environment variables
            self.docker_config["environment"].update(env_dict)
      

        # Set environment variable if N150_WH_ARCH_YAML or N300x4_WH_ARCH_YAML is in the device configurations
        if (
            DeviceConfigurations.N150_WH_ARCH_YAML in self.device_configurations
            or DeviceConfigurations.N300x4_WH_ARCH_YAML in self.device_configurations
        ):
            self.docker_config["environment"]["WH_ARCH_YAML"] = (
                "wormhole_b0_80_arch_eth_dispatch.yaml"
            )

        if self.env_file:
            logger.info(f"Using env file: {self.env_file}")
            # env file should be in persistent volume mounted
            env_dict = load_dotenv_dict(self.env_file)
            # env file overrides any existing docker environment variables
            self.docker_config["environment"].update(env_dict)

        # Set environment variable if N150_WH_ARCH_YAML or N300x4_WH_ARCH_YAML is in the device configurations
        if (
            DeviceConfigurations.N150_WH_ARCH_YAML in self.device_configurations
            or DeviceConfigurations.N300x4_WH_ARCH_YAML in self.device_configurations
        ):
            self.docker_config["environment"]["WH_ARCH_YAML"] = (
                "wormhole_b0_80_arch_eth_dispatch.yaml"
            )

        if self.env_file:
            logger.info(f"Using env file: {self.env_file}")
            # env file should be in persistent volume mounted
            env_dict = load_dotenv_dict(self.env_file)
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

    def init_volumes(self):
        # need to make directory in app backend container to allow for correct perimission to be set
        self.volume_path.mkdir(parents=True, exist_ok=True)
        os.chown(self.volume_path, uid=self.user_uid, gid=self.user_gid)
        self.backend_weights_dir.mkdir(parents=True, exist_ok=True)
        os.chown(self.backend_weights_dir, uid=self.user_uid, gid=self.user_gid)
        # self.backend_hf_home.mkdir(parents=True, exist_ok=True)
        # os.chown(self.backend_hf_home, uid=self.user_uid, gid=self.user_gid)

    def asdict(self):
        return asdict(self)


def base_docker_config():
    return {
        # Note: mounts and devices are determined in `docker_utils.py`
        "user": "user",
        "auto_remove": True,
        "cap_add": "ALL",  # TODO: add minimal permissions
        "detach": True,
        "environment": {
            "JWT_SECRET": backend_config.jwt_secret,
            "CACHE_ROOT": backend_config.model_container_cache_root,
            "HF_TOKEN": backend_config.hf_token,
        },
    }


# model_ids are unique strings to define a model, they could be uuids but
# using friendly strings prefixed with id_ is more helpful for debugging
model_implmentations_list = [
    ModelImpl(
        model_name="Stable-Diffusion-1.4",
        model_id="id_stable_diffusionv0.1.0",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-stable-diffusion-1.4-src-base",
        image_tag="v0.0.1-tt-metal-923f47eafd5a",
        device_configurations={DeviceConfigurations.N150},
        docker_config=base_docker_config(),
        user_uid=1000,
        user_gid=1000,
        shm_size="32G",
        service_port=7000,
        service_route="/submit",
    ),
    ModelImpl(
        model_name="YOLOv4",
        model_id="id_yolov4v0.0.1",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-yolov4-src-base",
        image_tag="v0.0.1-tt-metal-65d246482b3f",
        device_configurations={DeviceConfigurations.N150},
        docker_config=base_docker_config(),
        user_uid=1000,
        user_gid=1000,
        shm_size="32G",
        service_port=7000,
        service_route="/objdetection_v2",
    ),
    ModelImpl(
        model_name="Mock-Llama-3.1-70B-Instruct",
        model_id="id_mock_vllm_modelv0.0.1",
        image_name="ghcr.io/tenstorrent/tt-inference-server/mock.vllm.openai.api",
        image_tag="v0.0.1-tt-metal-385904186f81-384f1790c3be",
        hf_model_path="meta-llama/Llama-3.1-70B-Instruct",
        device_configurations={DeviceConfigurations.CPU},
        docker_config=base_docker_config(),
        user_uid=1000,
        user_gid=1000,
        shm_size="1G",
        service_port=7000,
        service_route="/v1/chat/completions",
    ),
    ModelImpl(
        model_name="Falcon-7B-Instruct",
        model_id="id_tt-metal-falcon-7bv0.0.13",
        image_name="tt-metal-falcon-7b",
        image_tag="v0.0.13",
        device_configurations={DeviceConfigurations.N150_WH_ARCH_YAML},
        hf_model_path="tiiuae/falcon-7b-instruct",
        docker_config=base_docker_config(),
        user_uid=1000,
        user_gid=1000,
        shm_size="32G",
        service_port=7000,
        service_route="/inference/falcon7b",
    ),
    ModelImpl(
        model_name="Llama-3.1-70B-Instruct",
        model_id="id_tt-metal-llama-3.1-70b-instructv0.0.1",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-llama3-70b-src-base-vllm",
        image_tag="v0.0.3-tt-metal-385904186f81-384f1790c3be",
        hf_model_path="meta-llama/Llama-3.1-70B-Instruct",
        device_configurations={DeviceConfigurations.N300x4_WH_ARCH_YAML},
        docker_config=base_docker_config(),
        user_uid=1000,
        user_gid=1000,
        shm_size="32G",
        service_port=7000,
        service_route="/v1/chat/completions",
        env_file=os.environ.get("VLLM_LLAMA31_ENV_FILE"),
    ),
    #! Add new model vLLM model implementations here
    #     ModelImpl(
    #     model_name="", #? Add the model name for the vLLM model based on persistent storage
    #     model_id="", #? Add the model id for the vLLM model based on persistent storage
    #     image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-llama3-70b-src-base-vllm",
    #     image_tag="v0.0.1-tt-metal-685ef1303b5a-54b9157d852b",
    #     hf_model_path="meta-llama/Llama-3.1-70B-Instruct",
    #     device_configurations={DeviceConfigurations.N300x4},
    #     docker_config=base_docker_config(),
    #     user_uid=1000,
    #     user_gid=1000,
    #     shm_size="32G",
    #     service_port=7000,
    #     service_route="/inference/**",  #? Add the correct route for the vLLM model
    #     env_file=os.environ.get("VLLM_LLAMA31_ENV_FILE"),
    # )
]

def validate_model_implemenation_config(impl):
    # no / in model_id strings, model_id will be used in path names
    assert not "/" in impl.model_id


# build and validate the model_implmentations config
model_implmentations = {}
for impl in model_implmentations_list:
    validate_model_implemenation_config(impl)
    model_implmentations[impl.model_id] = impl