# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Docker Control Service API Client

This module provides a client wrapper for the docker-control-service API,
replacing direct Docker SDK usage for improved security.
"""

import os
import jwt
import requests
from typing import Dict, List, Optional, Any
from shared_config.logger_config import get_logger

logger = get_logger(__name__)


class DockerControlClient:
    """Client for interacting with the docker-control-service API"""

    def __init__(self, url: Optional[str] = None, jwt_secret: Optional[str] = None):
        """
        Initialize the Docker Control Service client

        Args:
            url: Base URL of the docker-control-service (default: from env DOCKER_CONTROL_SERVICE_URL)
            jwt_secret: JWT secret for authentication (default: from env DOCKER_CONTROL_JWT_SECRET)
        """
        self.url = url or os.getenv("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
        self.jwt_secret = jwt_secret or os.getenv("DOCKER_CONTROL_JWT_SECRET")

        if not self.jwt_secret:
            raise ValueError("DOCKER_CONTROL_JWT_SECRET environment variable is required")

        logger.info(f"Initialized DockerControlClient with URL: {self.url}")

    def _get_headers(self) -> Dict[str, str]:
        """Generate authentication headers with JWT token"""
        token = jwt.encode(
            {"service": "tt_studio_backend"},
            self.jwt_secret,
            algorithm="HS256"
        )
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def _request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Make an authenticated request to the docker-control-service"""
        url = f"{self.url}{endpoint}"
        headers = self._get_headers()

        try:
            response = requests.request(method, url, headers=headers, **kwargs)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            logger.error(f"Docker Control Service request failed: {method} {url} - {e}")
            raise

    # Container operations

    def list_containers(self, all: bool = False, filters: Optional[Dict] = None) -> List[Dict]:
        """
        List containers

        Args:
            all: Include stopped containers
            filters: Filter results (e.g., {"name": "my_container"})

        Returns:
            List of container information dicts
        """
        params = {}
        if all:
            params["all"] = "true"
        if filters:
            params["filters"] = filters

        response = self._request("GET", "/api/v1/containers", params=params)
        return response.json()

    def get_container(self, container_id: str) -> Dict:
        """Get detailed information about a specific container"""
        response = self._request("GET", f"/api/v1/containers/{container_id}")
        return response.json()

    def run_container(
        self,
        image: str,
        name: Optional[str] = None,
        command: Optional[str] = None,
        ports: Optional[Dict] = None,
        environment: Optional[Dict] = None,
        volumes: Optional[Dict] = None,
        network: Optional[str] = None,
        detach: bool = True,
        **kwargs
    ) -> Dict:
        """
        Run a new container

        Args:
            image: Docker image to run
            name: Container name
            command: Command to run
            ports: Port mappings (e.g., {"8000/tcp": 7001})
            environment: Environment variables
            volumes: Volume mounts
            network: Network to connect to
            detach: Run in detached mode
            **kwargs: Additional container run options

        Returns:
            Container information dict
        """
        payload = {
            "image": image,
            "detach": detach,
            **kwargs
        }

        if name:
            payload["name"] = name
        if command:
            payload["command"] = command
        if ports:
            payload["ports"] = ports
        if environment:
            payload["environment"] = environment
        if volumes:
            payload["volumes"] = volumes
        if network:
            payload["network"] = network

        response = self._request("POST", "/api/v1/containers/run", json=payload)
        return response.json()

    def stop_container(self, container_id: str, timeout: int = 10) -> Dict:
        """Stop a running container"""
        payload = {"timeout": timeout}
        response = self._request("POST", f"/api/v1/containers/{container_id}/stop", json=payload)
        return response.json()

    def remove_container(self, container_id: str, force: bool = False, v: bool = False) -> Dict:
        """Remove a container"""
        payload = {"force": force, "v": v}
        response = self._request("POST", f"/api/v1/containers/{container_id}/remove", json=payload)
        return response.json()

    def inspect_container(self, container_id: str) -> Dict:
        """Inspect a container (alias for get_container)"""
        return self.get_container(container_id)

    def get_logs_stream(self, container_id: str, follow: bool = True, tail: int = 100):
        """
        Stream logs from a container using Server-Sent Events.

        Args:
            container_id: Container ID or name
            follow: Follow log output in real-time (default: True)
            tail: Number of lines to show from end of logs (default: 100)

        Yields:
            Log lines from the container

        Note:
            This is a streaming method that yields log lines. It should be used
            in a streaming context (e.g., StreamingHttpResponse in Django).
        """
        url = f"{self.url}/api/v1/containers/{container_id}/logs"
        params = {"follow": str(follow).lower(), "tail": tail}
        headers = self._get_headers()

        try:
            # Use stream=True to get streaming response
            response = requests.get(url, headers=headers, params=params, stream=True, timeout=None)
            response.raise_for_status()

            # Stream the response in chunks (no buffering)
            # The docker-control-service already formats as SSE, so we just proxy the chunks
            for chunk in response.iter_content(chunk_size=None, decode_unicode=False):
                if chunk:
                    yield chunk

        except requests.exceptions.RequestException as e:
            logger.error(f"Error streaming logs from docker-control-service: {e}")
            raise

    # Image operations

    def list_images(self, name: Optional[str] = None) -> List[Dict]:
        """List Docker images"""
        params = {}
        if name:
            params["name"] = name

        response = self._request("GET", "/api/v1/images", params=params)
        return response.json()

    def remove_image(self, name: str, tag: str = "latest", force: bool = False) -> Dict:
        """Remove a Docker image"""
        # Use query parameters to avoid route parsing issues with special characters
        params = {"name": name, "tag": tag, "force": str(force).lower()}
        response = self._request("DELETE", "/api/v1/images/remove", params=params)
        return response.json()

    def image_exists(self, name: str, tag: str = "latest") -> bool:
        """Check if an image exists"""
        try:
            # Use query parameters instead of path parameters to avoid issues with special characters
            params = {"name": name, "tag": tag}
            response = self._request("GET", "/api/v1/images/exists", params=params)
            result = response.json()
            # The API returns an "exists" field
            return result.get("exists", False)
        except requests.exceptions.HTTPError:
            return False

    # Network operations

    def list_networks(self, names: Optional[List[str]] = None) -> List[Dict]:
        """List Docker networks"""
        params = {}
        if names:
            params["names"] = names

        response = self._request("GET", "/api/v1/networks", params=params)
        return response.json()

    def create_network(self, name: str, driver: str = "bridge", **kwargs) -> Dict:
        """Create a Docker network"""
        payload = {"name": name, "driver": driver, **kwargs}
        response = self._request("POST", "/api/v1/networks/create", json=payload)
        return response.json()

    def remove_network(self, name: str) -> Dict:
        """Remove a Docker network"""
        response = self._request("DELETE", f"/api/v1/networks/{name}")
        return response.json()

    def connect_container_to_network(self, network_name: str, container: str) -> Dict:
        """Connect a container to a network"""
        payload = {"container": container}
        response = self._request("POST", f"/api/v1/networks/{network_name}/connect", json=payload)
        return response.json()

    def disconnect_container_from_network(self, network_name: str, container: str, force: bool = False) -> Dict:
        """Disconnect a container from a network"""
        payload = {"container": container, "force": force}
        response = self._request("POST", f"/api/v1/networks/{network_name}/disconnect", json=payload)
        return response.json()

    # Health check

    def health(self) -> Dict:
        """Check the health of the docker-control-service"""
        # Health endpoint doesn't require authentication
        url = f"{self.url}/api/v1/health"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        return response.json()


# Singleton instance
_client: Optional[DockerControlClient] = None


def get_docker_client() -> DockerControlClient:
    """Get the singleton DockerControlClient instance"""
    global _client
    if _client is None:
        _client = DockerControlClient()
    return _client
