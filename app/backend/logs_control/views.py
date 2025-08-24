# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
import glob
import docker
from typing import Optional, Tuple
from urllib.parse import unquote
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from shared_config.logger_config import get_logger

# Setting up logger
logger = get_logger(__name__)

# Use environment variable for the base storage volume
LOGS_ROOT = os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/path/to/fallback")
TT_STUDIO_ROOT = os.getenv("TT_STUDIO_ROOT", "/workspace")


class ListLogsView(APIView):
    """
    Lists all available directories and log files within the base logs directory
    """

    def get(self, request, *args, **kwargs):
        logger.info("ListLogsView endpoint hit")
        try:
            logs_tree = self.build_logs_tree(LOGS_ROOT)
            logger.info(f"Log tree built: {logs_tree}")
            return JsonResponse({"logs": logs_tree}, status=200)
        except Exception as e:
            logger.error(f"Error listing logs: {e}")
            return JsonResponse({"error": str(e)}, status=500)

    def build_logs_tree(self, directory):
        """
        Recursively build a tree of directories and files.
        """
        tree = []
        for entry in os.listdir(directory):
            path = os.path.join(directory, entry)
            if os.path.isdir(path):
                tree.append(
                    {
                        "name": entry,
                        "type": "directory",
                        "children": self.build_logs_tree(path),
                    }
                )
            elif entry.endswith(".log"):
                tree.append({"name": entry, "type": "file"})
        return tree


class GetLogView(APIView):
    """
    Retrieves the content of a specific log file from the logs directory.
    """

    def get(self, request, filename, *args, **kwargs):
        decoded_filename = unquote(filename)

        file_path = os.path.normpath(os.path.join(LOGS_ROOT, decoded_filename))

        # Security check: Ensure the resolved path is within LOGS_ROOT
        if not file_path.startswith(os.path.abspath(LOGS_ROOT)):
            logger.error(f"Invalid log file path: {file_path}")
            raise Http404("Invalid file path.")

        logger.info(f"Looking for log file at: {file_path}")

        if os.path.exists(file_path) and os.path.isfile(file_path):
            try:
                with open(file_path, "r") as file:
                    content = file.read()
                logger.info(
                    f"Successfully retrieved content for log: {decoded_filename}"
                )
                return HttpResponse(content, content_type="text/plain")
            except Exception as e:
                logger.error(f"Error reading log file {decoded_filename}: {e}")
                return JsonResponse({"error": str(e)}, status=500)
        else:
            logger.error(f"Log file {decoded_filename} not found at {file_path}")
            raise Http404(f"Log file {decoded_filename} not found.")


class FastAPILogsView(APIView):
    """
    Retrieves FastAPI logs specifically for bug reporting and system monitoring.
    """

    def get(self, request, *args, **kwargs):
        logger.info("FastAPILogsView endpoint hit")
        
        # Check if fastapi.log exists in multiple possible locations using relative paths
        possible_fastapi_logs = [
            "fastapi.log",  # Current directory
            os.path.join(os.getcwd(), "fastapi.log"),  # Current working directory
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "fastapi.log"),  # Go up from backend/logs_control/views.py
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "fastapi.log"),  # Relative to backend directory
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "..", "fastapi.log"),  # Two levels up from backend
            os.path.join(LOGS_ROOT, "fastapi.log"),  # Try in logs directory
            "/app/fastapi.log",  # Container path as fallback
        ]
        
        fastapi_log_found = False
        log_content = ""
        
        for fastapi_log_path in possible_fastapi_logs:
            if os.path.exists(fastapi_log_path):
                try:
                    with open(fastapi_log_path, 'r') as f:
                        lines = f.readlines()
                        # Get last 20 lines and limit size
                        log_content = ''.join(lines[-20:])
                        if len(log_content) > 2000:
                            log_content = log_content[-2000:] + "\n\n... (truncated)"
                    fastapi_log_found = True
                    logger.info(f"Successfully read FastAPI logs from: {fastapi_log_path}")
                    break
                except Exception as read_error:
                    logger.error(f"Error reading {fastapi_log_path}: {str(read_error)}")
                    continue
        
        if not fastapi_log_found:
            log_content = "fastapi.log not accessible from container (logs available from Docker containers above)"
            logger.warning("FastAPI log file not found in any expected location")
        
        return JsonResponse({
            "fastapi_logs": log_content,
            "found": fastapi_log_found,
            "timestamp": os.path.getmtime(fastapi_log_path) if fastapi_log_found else None
        }, status=200)


class TtInferenceLogsView(APIView):
    """
    Retrieves latest tt-inference-server workflow logs (run logs and docker server logs)
    filtered by an optional model name query parameter.

    Query params:
      - model: optional model name substring to match (case-insensitive)
      - max_lines: optional int for how many tail lines to return (default 200)
    """

    def _find_latest_file(self, directory: str, pattern_contains: Optional[str]) -> Optional[str]:
        if not os.path.isdir(directory):
            return None

        # Glob all .log files
        search_pattern = os.path.join(directory, "*.log")
        candidates = glob.glob(search_pattern)
        if pattern_contains:
            needle = pattern_contains.lower()
            candidates = [p for p in candidates if needle in os.path.basename(p).lower()]

        if not candidates:
            return None

        # Return most recently modified
        candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return candidates[0]

    def _tail_file(self, file_path: str, max_lines: int) -> str:
        try:
            with open(file_path, 'r') as f:
                lines = f.readlines()
                tail = ''.join(lines[-max_lines:])
                # safety truncate
                if len(tail) > 5000:
                    return tail[-5000:] + "\n\n... (truncated)"
                return tail
        except Exception as e:
            logger.error(f"Error reading log file {file_path}: {e}")
            return f"Failed to read log file: {str(e)}"

    def _extract_container_id_from_run_log(self, run_log_path: Optional[str]) -> Optional[str]:
        if not run_log_path or not os.path.isfile(run_log_path):
            return None
        try:
            with open(run_log_path, 'r') as f:
                text = f.read()
                # Common line in run logs: "Created Docker container ID: <id>"
                import re
                m = re.search(r"Created Docker container ID:\s*([0-9a-f]{6,64})", text)
                if m:
                    return m.group(1)
        except Exception as e:
            logger.error(f"Failed to parse run log for container id: {e}")
        return None

    def _find_candidate_container_id(self, model_query: Optional[str]) -> Optional[str]:
        try:
            client = docker.from_env()
            containers = client.containers.list(all=True)
            # Prefer running containers first
            def sort_key(c):
                return (c.status != 'running', -c.attrs.get('Created', 0))
            containers = sorted(containers, key=sort_key)

            def name_or_image_contains(c, needle: str) -> bool:
                needle = needle.lower()
                name_ok = any(needle in nm.lower() for nm in ([c.name] + [a for a in c.attrs.get('Name', '') if a]))
                image_ok = needle in (c.image.tags[0].lower() if c.image.tags else c.image.short_id.lower())
                return name_ok or image_ok

            # Heuristic: container likely from tt-inference-server/vllm image
            candidates = [
                c for c in containers
                if any(sub in (c.image.tags[0] if c.image.tags else '') for sub in ['tt-inference-server', 'vllm'])
            ]
            if model_query:
                candidates = [c for c in candidates if name_or_image_contains(c, model_query)] or candidates

            if candidates:
                return candidates[0].id
        except Exception as e:
            logger.error(f"Failed to find candidate tt-inference container: {e}")
        return None

    def _fetch_container_logs(self, container_id: str, max_lines: int) -> Optional[str]:
        try:
            client = docker.from_env()
            container = client.containers.get(container_id)
            log_bytes = container.logs(tail=max_lines, timestamps=False)
            text = log_bytes.decode('utf-8', errors='replace').strip()
            if len(text) > 5000:
                text = text[-5000:] + "\n\n... (truncated)"
            return text
        except Exception as e:
            logger.error(f"Error fetching docker container logs for {container_id}: {e}")
            return None

    def get(self, request, *args, **kwargs):
        model_query = request.GET.get('model', '').strip()
        try:
            max_lines = int(request.GET.get('max_lines', '200'))
        except ValueError:
            max_lines = 200

        # Base path to tt-inference-server workflow logs inside repo root
        workflow_root = os.path.join(TT_STUDIO_ROOT, 'tt-inference-server', 'workflow_logs')
        run_logs_dir = os.path.join(workflow_root, 'run_logs')
        docker_server_dir = os.path.join(workflow_root, 'docker_server')

        latest_run_log = self._find_latest_file(run_logs_dir, model_query or None)
        latest_docker_log = self._find_latest_file(docker_server_dir, model_query or None)

        run_log_content = self._tail_file(latest_run_log, max_lines) if latest_run_log else "No matching run logs found"
        file_docker_log_content = self._tail_file(latest_docker_log, max_lines) if latest_docker_log else None

        # Try to fetch docker container logs using Docker SDK (more reliable inside container)
        container_id = self._extract_container_id_from_run_log(latest_run_log)
        if not container_id:
            container_id = self._find_candidate_container_id(model_query or None)
        docker_container_log = self._fetch_container_logs(container_id, max_lines) if container_id else None

        response = {
            "model_query": model_query or None,
            "run_log_file": latest_run_log,
            "run_log": run_log_content,
            "docker_server_log_file": latest_docker_log,
            "docker_server_log": file_docker_log_content or "",
            "docker_container_id": container_id,
            "docker_container_log": docker_container_log or "",
        }

        return JsonResponse(response, status=200)
