# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import os
from dataclasses import dataclass, asdict
from typing import Set, Dict, Any, Union
from pathlib import Path

from shared_config.device_config import DeviceConfigurations
from shared_config.backend_config import backend_config
from shared_config.setup_config import SetupTypes
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
    display_model_type: str = "LLM"

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


# ---------------------------------------------------------------------------
# JSON-based model loader
# ---------------------------------------------------------------------------

CATALOG_JSON = Path(__file__).parent / "models_from_inference_server.json"

# device_type strings in the catalog → DeviceConfigurations member names
# (only names that actually exist in the enum; others are skipped)
_CATALOG_DEVICE_MAP = {
    "N150": "N150",
    "N300": "N300",
    "T3K": "T3K",
    "N150X4": "N150X4",
    "P100": "P100",
    "P150": "P150",
    "P150X4": "P150X4",
    "P150X8": "P150X8",
    "GALAXY": "GALAXY",
    "GALAXY_T3K": "GALAXY_T3K",
}


def load_model_implementations_from_json(json_path: Path) -> list:
    with open(json_path) as f:
        catalog = json.load(f)
    impls = []
    for entry in catalog["models"]:
        docker_image = entry.get("docker_image") or ""
        if ":" in docker_image:
            image_name, image_tag = docker_image.rsplit(":", 1)
        else:
            image_name, image_tag = docker_image, "latest"

        device_configs = {
            DeviceConfigurations[_CATALOG_DEVICE_MAP[d]]
            for d in entry.get("device_configurations", [])
            if d in _CATALOG_DEVICE_MAP
        }

        try:
            model_type = ModelTypes[entry["model_type"]]
        except KeyError:
            model_type = ModelTypes.CHAT

        try:
            setup_type = SetupTypes[entry["setup_type"]]
        except KeyError:
            setup_type = SetupTypes.TT_INFERENCE_SERVER

        cfg = base_docker_config()
        cfg["environment"].update(entry.get("env_vars") or {})

        impl = ModelImpl(
            model_name=entry["model_name"],
            hf_model_id=entry.get("hf_model_id"),
            image_name=image_name,
            image_tag=image_tag,
            device_configurations=device_configs,
            docker_config=cfg,
            service_route=entry["service_route"],
            setup_type=setup_type,
            model_type=model_type,
            version=entry.get("version", "0.0.1"),
            shm_size=entry.get("shm_size", "32G"),
            display_model_type=entry.get("display_model_type", "LLM"),
        )
        impls.append(impl)
    return impls


# ---------------------------------------------------------------------------
# Hardcoded models NOT present in tt-inference-server catalog
# ---------------------------------------------------------------------------

_ALL_WH_BOARDS = {
    DeviceConfigurations.N150,
    DeviceConfigurations.N150_WH_ARCH_YAML,
    DeviceConfigurations.N300,
    DeviceConfigurations.N300_WH_ARCH_YAML,
    DeviceConfigurations.N300x4,
    DeviceConfigurations.N300x4_WH_ARCH_YAML,
}

_hardcoded_impls = [
    # Object Detection - legacy YOLOv4 (not in tt-inference-server catalog)
    ModelImpl(
        model_name="YOLOv4",
        model_id="id_yolov4v0.0.1",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-yolov4-src-base",
        image_tag="v0.0.1-tt-metal-65d246482b3f",
        device_configurations=_ALL_WH_BOARDS,
        docker_config=base_docker_config(),
        shm_size="32G",
        service_port=7000,
        service_route="/objdetection_v2",
        setup_type=SetupTypes.NO_SETUP,
        model_type=ModelTypes.OBJECT_DETECTION,
        display_model_type="CNN",
    ),
    # Legacy Stable-Diffusion-1.4 (not in tt-inference-server catalog)
    ModelImpl(
        model_name="Stable-Diffusion-1.4",
        model_id="id_stable_diffusionv0.1.0",
        image_name="ghcr.io/tenstorrent/tt-inference-server/tt-metal-stable-diffusion-1.4-src-base",
        image_tag="v0.0.1-tt-metal-cc8b4e1dac99",
        device_configurations=_ALL_WH_BOARDS,
        docker_config=base_docker_config(),
        shm_size="32G",
        service_port=7000,
        service_route="/enqueue",
        health_route="/",
        setup_type=SetupTypes.TT_INFERENCE_SERVER,
        model_type=ModelTypes.IMAGE_GENERATION,
        display_model_type="IMAGE",
    ),
]


def validate_model_implemenation_config(impl):
    # no / in model_id strings, model_id will be used in path names
    assert "/" not in impl.model_id


# ---------------------------------------------------------------------------
# Build final model_implmentations dict
# ---------------------------------------------------------------------------

_json_impls = load_model_implementations_from_json(CATALOG_JSON)

model_implmentations = {}
for impl in _json_impls + _hardcoded_impls:
    validate_model_implemenation_config(impl)
    model_implmentations[impl.model_id] = impl