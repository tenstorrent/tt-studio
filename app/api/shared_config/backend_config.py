# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class BackendConfig:
    host_tt_studio_root: str
    host_peristent_storage_volume: str
    persistent_storage_volume: str
    backend_cache_root: str
    docker_bridge_network_name: str
    django_deploy_cache_name: str
    weights_dir: str
    model_container_cache_root: str
    jwt_secret: str
    hf_token: str


# environment variables are ideally terminated on import to fail-fast and provide obvious
# feedback to developers on configuration
# TODO: add path validation where possible
backend_config = BackendConfig(
    host_tt_studio_root=os.environ["TT_STUDIO_ROOT"],
    host_peristent_storage_volume=os.environ["HOST_PERSISTENT_STORAGE_VOLUME"],
    persistent_storage_volume=os.environ["INTERNAL_PERSISTENT_STORAGE_VOLUME"],
    backend_cache_root=Path(os.environ["INTERNAL_PERSISTENT_STORAGE_VOLUME"]).joinpath(
        "backend_volume"
    ),
    django_deploy_cache_name="deploy_cache",
    docker_bridge_network_name="llm_studio_network",
    weights_dir="model_weights",
    model_container_cache_root="/home/user/cache_root",
    jwt_secret=os.environ["JWT_SECRET"],
    hf_token=os.environ["HF_TOKEN"],
)

# make backend volume if not existing
if not Path(backend_config.backend_cache_root).exists():
    Path(backend_config.backend_cache_root).mkdir(parents=True, exist_ok=True)
