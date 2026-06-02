# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Pydantic Request Models for Docker Control Service
"""

from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class ContainerRunRequest(BaseModel):
    """Request model for running a container"""
    image: str = Field(..., description="Docker image name:tag")
    name: Optional[str] = Field(None, description="Container name")
    command: Optional[str] = Field(None, description="Command to run")
    environment: Dict[str, str] = Field(default_factory=dict, description="Environment variables")
    ports: Dict[str, int] = Field(default_factory=dict, description="Port mappings (container_port: host_port)")
    volumes: Dict[str, str] = Field(default_factory=dict, description="Volume mounts (host_path: container_path)")
    devices: List[str] = Field(default_factory=list, description="Device mounts")
    network: Optional[str] = Field(None, description="Network name")
    hostname: Optional[str] = Field(None, description="Container hostname")
    detach: bool = Field(True, description="Run in background")
    auto_remove: bool = Field(False, description="Remove container on exit")
    privileged: bool = Field(False, description="Run in privileged mode (NOT ALLOWED)")
    user: Optional[str] = Field(None, description="User to run as (e.g., '1000:1000')")
    cap_add: List[str] = Field(default_factory=list, description="Linux capabilities to add (e.g., ['SYS_ADMIN', 'IPC_LOCK'])")
    shm_size: Optional[str] = Field(None, description="Shared memory size (e.g., '32G')")


class ContainerStopRequest(BaseModel):
    """Request model for stopping a container"""
    timeout: int = Field(10, description="Timeout in seconds before killing")


class ContainerDirSizeRequest(BaseModel):
    """Request model for `du -sb` inside a running container.

    Read-only: only used to report download progress to the UI. Path must be
    an absolute container path; the service refuses anything else.
    """
    path: str = Field(..., description="Absolute path inside the container to size")
    timeout: float = Field(4.0, description="Hard cap on the `du` exec, in seconds")


class ImagePullRequest(BaseModel):
    """Request model for pulling an image"""
    image_name: str = Field(..., description="Image name")
    image_tag: str = Field("latest", description="Image tag")
    registry_auth: Optional[Dict] = Field(None, description="Registry credentials")


class ImagePullStartRequest(BaseModel):
    """Request model for starting a streamed (progress-tracked) image pull.

    Unlike ImagePullRequest (which blocks), this kicks off a background pull keyed
    by `pull_id`; the caller polls GET /images/pull/progress/{pull_id} for byte-level
    progress aggregated from Docker's per-layer event stream.
    """
    image_name: str = Field(..., description="Image name")
    image_tag: str = Field("latest", description="Image tag")
    pull_id: str = Field(..., description="Caller-supplied id used to poll progress")


class NetworkCreateRequest(BaseModel):
    """Request model for creating a network"""
    name: str = Field(..., description="Network name")
    driver: str = Field("bridge", description="Network driver")
