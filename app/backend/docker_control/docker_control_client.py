# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Docker Control Service API Client

This module provides a client wrapper for the docker-control-service API,
replacing direct Docker SDK usage for improved security.
"""

import json
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
            url: Base URL of the docker-control-service (default: env DOCKER_CONTROL_SERVICE_URL)
            jwt_secret: JWT secret for authentication (default: env DOCKER_CONTROL_JWT_SECRET)
        """
        self.url = url or os.getenv("DOCKER_CONTROL_SERVICE_URL")
        self.jwt_secret = jwt_secret or os.getenv("DOCKER_CONTROL_JWT_SECRET")

        if not self.url:
            raise ValueError("DOCKER_CONTROL_SERVICE_URL environment variable is required")
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

    def rename_container(self, container_id: str, new_name: str) -> Dict:
        """Rename a container"""
        response = self._request("POST", f"/api/v1/containers/{container_id}/rename", params={"new_name": new_name})
        return response.json()

    def inspect_container(self, container_id: str) -> Dict:
        """Inspect a container (alias for get_container)"""
        return self.get_container(container_id)

    def dir_size(self, container_id: str, path: str, timeout: float = 4.0) -> Optional[int]:
        """Recursive byte count of `path` inside the running container.

        Wraps the docker-control-service's read-only `du` helper. Returns None
        on transport failure / 404; callers should treat that as "no signal".
        Returns 0 (not None) when the path exists but is empty or missing
        inside the container — see download_progress.py for the difference.
        """
        url = f"{self.url}/api/v1/containers/{container_id}/dir-size"
        try:
            response = requests.post(
                url,
                headers=self._get_headers(),
                json={"path": path, "timeout": timeout},
                timeout=max(2.0, timeout + 2.0),
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()
            n = data.get("bytes")
            return int(n) if isinstance(n, int) else None
        except requests.exceptions.RequestException as e:
            logger.warning(f"dir_size({container_id[:12]}, {path}) failed: {e}")
            return None
        except (ValueError, TypeError) as e:
            logger.warning(f"dir_size({container_id[:12]}) parse failure: {e}")
            return None

    def tail_logs(self, container_id: str, tail: int = 200, timeout: float = 5.0) -> List[str]:
        """Fetch a one-shot snapshot of the most recent container log lines.

        Wraps the SSE-based logs endpoint with follow=false: the upstream stream
        terminates after emitting the requested tail, so we collect chunks and
        unwrap the `data: {"message": ...}\\n\\n` payloads into plain strings.

        Args:
            container_id: container id or name
            tail: number of trailing lines to fetch
            timeout: hard cap on total wait, in seconds

        Returns:
            list of raw log lines (oldest first). Empty list on failure.
        """
        url = f"{self.url}/api/v1/containers/{container_id}/logs"
        params = {"follow": "false", "tail": tail}
        try:
            response = requests.get(
                url,
                headers=self._get_headers(),
                params=params,
                stream=True,
                timeout=timeout,
            )
            response.raise_for_status()

            lines: List[str] = []
            for raw_line in response.iter_lines(decode_unicode=True):
                if not raw_line or not raw_line.startswith("data: "):
                    continue
                payload = raw_line[len("data: "):]
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                msg = obj.get("message")
                if isinstance(msg, str):
                    lines.append(msg)
            return lines
        except requests.exceptions.RequestException as e:
            logger.warning(f"tail_logs({container_id[:12]}) failed: {e}")
            return []

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

    def start_image_pull(self, name: str, tag: str, pull_id: str) -> Dict:
        """Start a background, progress-tracked image pull.

        Returns immediately; poll get_image_pull_progress(pull_id) for byte-level
        progress aggregated from Docker's per-layer event stream.
        """
        payload = {"image_name": name, "image_tag": tag, "pull_id": pull_id}
        response = self._request("POST", "/api/v1/images/pull/start", json=payload)
        return response.json()

    def get_image_pull_progress(self, pull_id: str, timeout: float = 5.0) -> Optional[Dict]:
        """Fetch the latest progress snapshot for a streamed pull.

        Returns None if the pull is not tracked (404) or the service is unreachable,
        so callers can degrade gracefully without raising.
        """
        try:
            response = self._request(
                "GET", f"/api/v1/images/pull/progress/{pull_id}", timeout=timeout
            )
            return response.json()
        except requests.exceptions.RequestException:
            return None

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

    # Host log files

    def get_service_log(self, tail: int = 500) -> Dict:
        """Fetch docker-control-service log content from the host"""
        response = self._request("GET", "/api/v1/logs/service", params={"tail": tail})
        return response.json()

    def get_startup_log(self, tail: int = 200) -> Dict:
        """Fetch startup.log content from the host"""
        response = self._request("GET", "/api/v1/logs/startup", params={"tail": tail})
        return response.json()

    def get_model_run_log(self, tail: int = 500) -> Dict:
        """Fetch model_run.log content from the host"""
        response = self._request("GET", "/api/v1/logs/fastapi", params={"tail": tail})
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
