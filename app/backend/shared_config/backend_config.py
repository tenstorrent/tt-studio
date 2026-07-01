# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Optional


# NOTE: "host.docker.internal" requires the extra_hosts mapping in
# docker-compose.yml ("host.docker.internal:host-gateway") to resolve
# on Linux. This is already configured in app/docker-compose.yml.
DEFAULT_TT_INFERENCE_API_URL = "http://host.docker.internal:8001"


def normalize_tt_inference_api_url(value: Optional[str]) -> str:
    """Return a base URL without trailing slashes."""
    normalized = (value or DEFAULT_TT_INFERENCE_API_URL).strip().rstrip("/")
    return normalized or DEFAULT_TT_INFERENCE_API_URL


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
    tt_inference_api_url: str
    github_username: str = os.environ.get("GITHUB_USERNAME", "")
    github_pat: str = os.environ.get("GITHUB_PAT", "")


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
    docker_bridge_network_name="tt_studio_network",
    weights_dir="model_weights",
    model_container_cache_root="/home/container_app_user/cache_root",
    jwt_secret=os.environ["JWT_SECRET"],
    tt_inference_api_url=normalize_tt_inference_api_url(
        os.getenv("TT_INFERENCE_API_URL")
    ),
    github_username=os.environ.get("GITHUB_USERNAME", ""),
    github_pat=os.environ.get("GITHUB_PAT", ""),
)

# make backend volume if not existing
if not Path(backend_config.backend_cache_root).exists():
    Path(backend_config.backend_cache_root).mkdir(parents=True, exist_ok=True)
    # Set permissions on newly created directory only (we own it)
    # Docker containers will handle subdirectory permissions via docker-entrypoint.sh
    try:
        os.chmod(backend_config.backend_cache_root, 0o777)
    except (OSError, PermissionError):
        # Silently continue if permission setting fails - Docker will handle it
        pass
