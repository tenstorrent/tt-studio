from .device_config import DeviceConfigurations
from dataclasses import dataclass
from typing import Set, Dict, Any
from pathlib import Path
import os

from .backend_config import backend_config


@dataclass(frozen=True)
class ModelImpl:
    """
    Model implementation configuration defines everything known about a model
    implementations before runtime, e.g. not handling ports, available devices"""

    model_name: str
    model_id: str
    image_name: str
    image_tag: str
    device_configurations: Set[
        "DeviceConfigurations"
    ]  # Assuming DeviceConfigurations is an enum or similar
    docker_config: Dict[str, Any]
    user_uid: int  # user inside docker container uid (for file permissions)
    user_gid: int  # user inside docker container gid (for file permissions)
    shm_size: str
    service_port: int
    service_route: str

    def __post_init__(self):
        self.docker_config.update({"volumes": self.get_volume_mounts()})
        self.docker_config["shm_size"] = self.shm_size

    @property
    def image_version(self) -> str:
        return f"{self.image_name}:{self.image_tag}"

    @property
    def image_volume(self) -> str:
        # by default share volume with later versions of the image
        return f"{self.container_base_name}_volume"

    @property
    def container_base_name(self) -> str:
        return self.image_name.split("/")[-1]

    def get_volume_mounts(self):
        # use type=volume for persistent storage with a Docker managed named volume
        # target: this should be set to same location as the CACHE_ROOT environment var
        host_path = Path(backend_config.host_peristent_storage_volume).joinpath(
            self.image_volume
        )
        # need to make directory in app backend container to allow for correct perimission to be set
        volume_path = Path(backend_config.persistent_storage_volume).joinpath(
            self.image_volume
        )
        volume_path.mkdir(parents=True, exist_ok=True)
        os.chown(volume_path, uid=self.user_uid, gid=self.user_gid)
        host_hugepages_path = "/dev/hugepages-1G"
        volume_mounts = {
            host_path: {"bind": "/home/user/cache_root", "mode": "rw"},
            host_hugepages_path: {"bind": "/dev/hugepages-1G", "mode": "rw"},
        }
        return volume_mounts


base_docker_config = {
    # Note: mounts and devices are determined in `docker_utils.py`
    "user": "user",
    "auto_remove": True,
    "cap_add": "ALL",  # TODO: add minimal permissions
    "detach": True,
    "environment": {
        "JWT_SECRET": backend_config.jwt_secret,
        "CACHE_ROOT": "/home/user/cache_root",
        "HF_HOME": "/home/user/cache_root/huggingface",
    },
}

model_implmentations = {
    "0": ModelImpl(
        model_name="echo",
        model_id="0",
        image_name="dummy_echo_model",
        image_tag="v0.0.1",
        device_configurations={DeviceConfigurations.CPU},
        docker_config=base_docker_config,
        user_uid=1000,
        user_gid=1000,
        shm_size="1G",
        service_port=7000,
        service_route="/inference/dummy_echo",
    ),
    "1": ModelImpl(
        model_name="Falcon-7B-Instruct",
        model_id="1",
        image_name="ghcr.io/tenstorrent/tt-studio/tt-metal-falcon-7b",
        image_tag="v0.0.11",
        device_configurations={DeviceConfigurations.N150},
        docker_config=base_docker_config,
        user_uid=1000,
        user_gid=1000,
        shm_size="32G",
        service_port=7000,
        service_route="/inference/falcon7b",
    ),
}
