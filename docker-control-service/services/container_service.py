# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Container Service - Business logic for Docker container operations
"""

import docker
import logging
from typing import Dict, List, Any
from models.requests import ContainerRunRequest
from config import settings

logger = logging.getLogger(__name__)


class ContainerService:
    """Service for container operations with security validation"""

    def __init__(self):
        self._client = None

    @property
    def client(self):
        """Lazy initialization of Docker client"""
        if self._client is None:
            try:
                self._client = docker.from_env()
            except Exception as e:
                logger.error(f"Failed to connect to Docker daemon: {e}")
                raise docker.errors.DockerException(
                    f"Cannot connect to Docker daemon. "
                    f"Please ensure Docker is running and you have proper permissions. "
                    f"Error: {e}"
                )
        return self._client

    def run_container(self, request: ContainerRunRequest) -> Dict:
        """
        Run a container with validation against security policies.

        Args:
            request: ContainerRunRequest with container parameters

        Returns:
            Dict with status, container_id, container_name, and optional error message
        """
        # Validate request against security policies
        self._validate_container_request(request)

        # Build docker run kwargs
        run_kwargs = {
            "image": request.image,
            "detach": request.detach,
        }

        # Add optional parameters
        if request.name:
            run_kwargs["name"] = request.name

        if request.command:
            run_kwargs["command"] = request.command

        if request.environment:
            run_kwargs["environment"] = request.environment

        if request.ports:
            run_kwargs["ports"] = request.ports

        if request.volumes:
            run_kwargs["volumes"] = request.volumes

        if request.devices:
            run_kwargs["devices"] = request.devices

        if request.network:
            run_kwargs["network"] = request.network

        if request.hostname:
            run_kwargs["hostname"] = request.hostname

        if request.auto_remove:
            run_kwargs["auto_remove"] = request.auto_remove

        if request.user:
            run_kwargs["user"] = request.user

        try:
            logger.info(f"Running container with image: {request.image}")
            container = self.client.containers.run(**run_kwargs)

            # Get port bindings from container attributes
            port_bindings = {}
            if hasattr(container, 'attrs'):
                host_config = container.attrs.get("HostConfig", {})
                port_bindings = host_config.get("PortBindings", {})

            logger.info(f"Container started successfully: {container.id[:12]}")
            return {
                "status": "success",
                "id": container.id,  # Add 'id' for compatibility
                "container_id": container.id,
                "name": container.name,  # Add 'name' for compatibility
                "container_name": container.name,
                "port_bindings": port_bindings
            }

        except docker.errors.ImageNotFound:
            error_msg = f"Image {request.image} not found"
            logger.error(error_msg)
            return {
                "status": "error",
                "message": error_msg
            }

        except docker.errors.APIError as e:
            error_msg = str(e)
            logger.error(f"Docker API error: {error_msg}")
            return {
                "status": "error",
                "message": error_msg
            }

        except Exception as e:
            error_msg = f"Unexpected error: {str(e)}"
            logger.error(error_msg)
            return {
                "status": "error",
                "message": error_msg
            }

    def stop_container(self, container_id: str, timeout: int = 10) -> Dict:
        """
        Stop a running container.

        Args:
            container_id: Container ID or name
            timeout: Timeout in seconds before killing

        Returns:
            Dict with status and optional error message
        """
        try:
            container = self.client.containers.get(container_id)
            logger.info(f"Stopping container: {container_id[:12]}")
            container.stop(timeout=timeout)
            logger.info(f"Container stopped successfully: {container_id[:12]}")
            return {"status": "success"}

        except docker.errors.NotFound:
            error_msg = "Container not found"
            logger.error(f"{error_msg}: {container_id}")
            return {"status": "error", "message": error_msg}

        except docker.errors.APIError as e:
            error_msg = str(e)
            logger.error(f"Error stopping container: {error_msg}")
            return {"status": "error", "message": error_msg}

    def remove_container(self, container_id: str, force: bool = False) -> Dict:
        """
        Remove a container.

        Args:
            container_id: Container ID or name
            force: Force removal even if running

        Returns:
            Dict with status and optional error message
        """
        try:
            container = self.client.containers.get(container_id)
            logger.info(f"Removing container: {container_id[:12]}")
            container.remove(force=force)
            logger.info(f"Container removed successfully: {container_id[:12]}")
            return {"status": "success"}

        except docker.errors.NotFound:
            error_msg = "Container not found"
            logger.error(f"{error_msg}: {container_id}")
            return {"status": "error", "message": error_msg}

        except docker.errors.APIError as e:
            error_msg = str(e)
            logger.error(f"Error removing container: {error_msg}")
            return {"status": "error", "message": error_msg}

    def list_containers(self, all: bool = False) -> Dict:
        """
        List Docker containers with full details.

        Args:
            all: Include stopped containers

        Returns:
            Dict with status and list of containers (includes full attrs for compatibility)
        """
        try:
            containers = self.client.containers.list(all=all)

            container_list = []
            for container in containers:
                # Get image tags
                image_tags = container.image.tags if container.image.tags else []
                image = image_tags[0] if image_tags else container.image.short_id

                # Build comprehensive container info for backend compatibility
                container_list.append({
                    "id": container.id,
                    "name": container.name,
                    "status": container.status,
                    "image": image,
                    "image_tags": image_tags,
                    # Include full attrs for backend compatibility
                    "attrs": container.attrs,
                    # Convenience fields extracted from attrs
                    "Config": container.attrs.get("Config", {}),
                    "NetworkSettings": container.attrs.get("NetworkSettings", {}),
                    "HostConfig": container.attrs.get("HostConfig", {}),
                    "environment": container.attrs.get("Config", {}).get("Env", [])
                })

            logger.debug(f"Listed {len(container_list)} containers (all={all})")
            return {
                "status": "success",
                "containers": container_list
            }

        except docker.errors.APIError as e:
            error_msg = str(e)
            logger.error(f"Error listing containers: {error_msg}")
            return {"status": "error", "message": error_msg, "containers": []}

    def get_container(self, container_id: str) -> Dict:
        """
        Get detailed information about a container.

        Args:
            container_id: Container ID or name

        Returns:
            Dict with status and container details (includes full attrs for compatibility)
        """
        try:
            container = self.client.containers.get(container_id)

            # Get image tags
            image_tags = container.image.tags if container.image.tags else []
            image = image_tags[0] if image_tags else container.image.short_id

            # Get network information
            networks = list(container.attrs.get("NetworkSettings", {}).get("Networks", {}).keys())

            container_info = {
                "id": container.id,
                "name": container.name,
                "status": container.status,
                "image": image,
                "image_tags": image_tags,
                "created": container.attrs.get("Created"),
                "ports": container.attrs.get("NetworkSettings", {}).get("Ports", {}),
                "networks": networks,
                # Include full attrs for backend compatibility
                "attrs": container.attrs,
                "Config": container.attrs.get("Config", {}),
                "NetworkSettings": container.attrs.get("NetworkSettings", {}),
                "HostConfig": container.attrs.get("HostConfig", {}),
                "environment": container.attrs.get("Config", {}).get("Env", [])
            }

            logger.debug(f"Retrieved container info: {container_id[:12]}")
            return {
                "status": "success",
                **container_info  # Return container info directly (not nested under "container" key)
            }

        except docker.errors.NotFound:
            error_msg = "Container not found"
            logger.error(f"{error_msg}: {container_id}")
            return {"status": "error", "message": error_msg}

        except docker.errors.APIError as e:
            error_msg = str(e)
            logger.error(f"Error getting container: {error_msg}")
            return {"status": "error", "message": error_msg}

    def _validate_container_request(self, request: ContainerRunRequest):
        """
        Validate container run request against security policies.

        Args:
            request: ContainerRunRequest to validate

        Raises:
            ValueError: If validation fails
        """
        # Validate image registry
        allowed_images = settings.ALLOWED_IMAGES
        if not any(request.image.startswith(prefix) for prefix in allowed_images):
            raise ValueError(
                f"Image {request.image} not from allowed registry. "
                f"Allowed prefixes: {', '.join(allowed_images)}"
            )

        # Never allow privileged mode
        if request.privileged:
            raise ValueError("Privileged containers are not allowed for security reasons")

        # Validate network
        if request.network and request.network not in settings.ALLOWED_NETWORKS:
            raise ValueError(
                f"Network {request.network} not allowed. "
                f"Allowed networks: {', '.join(settings.ALLOWED_NETWORKS)}"
            )

        logger.debug(f"Container request validated successfully: {request.image}")

    def get_logs_stream(self, container_id: str, follow: bool = True, tail: int = 100):
        """
        Get container logs as a generator for streaming.

        Args:
            container_id: Container ID or name
            follow: Follow log output (stream in real-time)
            tail: Number of lines to show from end of logs (default: 100, "all" for all logs)

        Yields:
            Log lines as bytes

        Raises:
            docker.errors.NotFound: If container not found
            docker.errors.APIError: If Docker API error occurs
        """
        try:
            container = self.client.containers.get(container_id)
            logger.info(f"Streaming logs for container: {container_id[:12]}")

            # Stream logs
            for log_line in container.logs(stream=True, follow=follow, tail=tail):
                yield log_line

        except docker.errors.NotFound:
            logger.error(f"Container not found: {container_id}")
            raise
        except docker.errors.APIError as e:
            logger.error(f"Error streaming logs: {e}")
            raise
