# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import io
import json
import os
import glob
import subprocess
import urllib.request
import urllib.error
import zipfile
import docker
from datetime import datetime
from typing import Optional, Tuple
from urllib.parse import unquote, urlencode
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from shared_config.logger_config import get_logger

# Setting up logger
logger = get_logger(__name__)

# Use environment variable for the base storage volume
LOGS_ROOT = os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/path/to/fallback")
TT_STUDIO_ROOT = os.getenv("TT_STUDIO_ROOT", "/workspace")

# ---------------------------------------------------------------------------
# Bug report ZIP manifest — every file/source that ends up in the archive.
# Update this list whenever _collect_bug_report_data() or
# BugReportDownloadView changes.
# ---------------------------------------------------------------------------
BUG_REPORT_MANIFEST = [
    # key in data dict         zip path                         how it's fetched
    # ─────────────────────── ──────────────────────────────── ───────────────────────────────────────────
    ("backend_log",           "backend.log",                   "persistent volume: backend_volume/python_logs/"),
    ("fastapi_log",           "fastapi.log",                   "docker-control-service HTTP /api/v1/logs/fastapi"),
    ("fastapi_deployment_logs","fastapi_logs/<name>.log (×5)", "volume mount: TT_STUDIO_ROOT/fastapi_logs/ (ro)"),
    ("docker_control_log",    "docker-control-service.log",    "docker-control-service HTTP /api/v1/logs/service"),
    ("startup_log",           "startup.log",                   "docker-control-service HTTP /api/v1/logs/startup"),
    ("agent_log",             "agent.log",                     "docker-control-service HTTP /api/v1/containers/<id>/logs"),
    ("inference_run_logs",    "inference_artifacts/run_logs/ (×5)",         "volume mount: TT_STUDIO_ROOT/.artifacts/tt-inference-server/workflow_logs/run_logs/"),
    ("inference_docker_server_logs", "inference_artifacts/docker_server/ (×5)", "volume mount: …/workflow_logs/docker_server/"),
    ("inference_run_specs",   "inference_artifacts/run_specs/ (×5)",        "volume mount: …/workflow_logs/run_specs/"),
    ("tt_smi",                "tt_smi.json",                   "in-container: board_control.services.SystemResourceService"),
    ("deployments",           "deployments.json",              "persistent volume: backend_volume/deployments.json"),
    ("current_models",        "current_models.json",           "docker-control list_containers + model_control deploy cache summary"),
]


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


# ---------------------------------------------------------------------------
# Bug Report helpers and views
# ---------------------------------------------------------------------------

def _read_log_tail(file_path: str, max_lines: int = 500) -> str:
    """Read the last max_lines from a log file, with safe UTF-8 decoding."""
    try:
        with open(file_path, "r", errors="replace") as f:
            lines = f.readlines()
            return "".join(lines[-max_lines:])
    except Exception as e:
        return f"[Error reading {os.path.basename(file_path)}: {e}]"


def _collect_current_models_snapshot() -> dict:
    """
    Lightweight snapshot of running containers and deploy-cache entries.
    Intended for bug reports — JSON-serializable, no secrets.
    """
    out: dict = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "docker_containers": [],
        "deploy_cache_entries": [],
    }

    try:
        from docker_control.docker_control_client import DockerControlClient

        client = DockerControlClient()
        raw = client.list_containers(all=True)
        if isinstance(raw, list):
            container_list = raw
        elif isinstance(raw, dict):
            container_list = raw.get("containers", [])
        else:
            container_list = []

        for c in container_list:
            if not isinstance(c, dict):
                continue
            cid = str(c.get("id") or "")
            out["docker_containers"].append(
                {
                    "id": (cid[:12] + "…") if len(cid) > 12 else cid,
                    "name": c.get("name"),
                    "image": c.get("image") or c.get("image_id"),
                    "status": c.get("status"),
                    "health": c.get("health"),
                }
            )
    except Exception as e:
        out["docker_containers_error"] = str(e)
        logger.warning("Bug report: could not list docker containers: %s", e)

    try:
        from model_control.model_utils import get_deploy_cache

        cache = get_deploy_cache()
        for con_id, entry in cache.items():
            if not isinstance(entry, dict):
                continue
            model_impl = entry.get("model_impl")
            mi_summary = None
            if model_impl is not None:
                mt = getattr(model_impl, "model_type", None)
                mi_summary = {
                    "model_name": getattr(model_impl, "model_name", None),
                    "hf_model_id": getattr(model_impl, "hf_model_id", None),
                    "model_type": getattr(mt, "value", str(mt)) if mt is not None else None,
                }
            pb = entry.get("port_bindings") or {}
            port_hints = []
            if isinstance(pb, dict):
                for cp, bindings in pb.items():
                    if not bindings:
                        continue
                    for b in bindings:
                        if isinstance(b, dict):
                            port_hints.append(
                                f"{b.get('HostIp')}:{b.get('HostPort')}->{cp}"
                            )
            cid = str(con_id or "")
            out["deploy_cache_entries"].append(
                {
                    "container_id_prefix": cid[:12] if cid else None,
                    "internal_url": entry.get("internal_url"),
                    "health_url": entry.get("health_url"),
                    "max_model_len": entry.get("max_model_len"),
                    "cached_model_name": entry.get("cached_model_name"),
                    "model_impl": mi_summary,
                    "port_bindings_summary": port_hints[:24],
                }
            )
    except Exception as e:
        out["deploy_cache_error"] = str(e)
        logger.warning("Bug report: could not read deploy cache: %s", e)

    return out


def _collect_bug_report_data() -> dict:
    """
    Aggregate log content from all TT-Studio sources into a single dict.
    Each key maps to a dict with 'file' (path or None) and 'content' (str),
    or a list of such dicts for multi-file sources.
    """
    data: dict = {}

    # 1. Latest Django backend log
    python_logs_dir = os.path.join(LOGS_ROOT, "backend_volume", "python_logs")
    if os.path.isdir(python_logs_dir):
        log_files = sorted(
            [
                os.path.join(python_logs_dir, f)
                for f in os.listdir(python_logs_dir)
                if f.endswith(".log")
            ],
            key=os.path.getmtime,
            reverse=True,
        )
        if log_files:
            data["backend_log"] = {"file": log_files[0], "content": _read_log_tail(log_files[0], 500)}
        else:
            data["backend_log"] = {"file": None, "content": "No backend log files found"}
    else:
        data["backend_log"] = {"file": None, "content": f"python_logs directory not found: {python_logs_dir}"}

    # 2. FastAPI inference main log — fetched from docker-control-service running on host
    try:
        from docker_control.docker_control_client import DockerControlClient as _DCSClient0
        _fastapi_result = _DCSClient0().get_fastapi_log(tail=500)
        data["fastapi_log"] = {"file": _fastapi_result.get("file"), "content": _fastapi_result.get("content", "")}
    except Exception as _e0:
        data["fastapi_log"] = {"file": None, "content": f"fastapi.log not accessible: {_e0}"}

    # 3. Per-deployment FastAPI logs (fastapi_logs/ directory, newest 5)
    fastapi_logs_dir = os.path.join(TT_STUDIO_ROOT, "fastapi_logs")
    if os.path.isdir(fastapi_logs_dir):
        dep_logs = sorted(
            [
                os.path.join(fastapi_logs_dir, f)
                for f in os.listdir(fastapi_logs_dir)
                if f.endswith(".log")
            ],
            key=os.path.getmtime,
            reverse=True,
        )[:5]
        data["fastapi_deployment_logs"] = [
            {"file": f, "content": _read_log_tail(f, 300)} for f in dep_logs
        ]
    else:
        data["fastapi_deployment_logs"] = []

    # 4 & 5. Docker control service log + startup log — fetched from docker-control-service on host
    try:
        from docker_control.docker_control_client import DockerControlClient as _DCSClient
        _dcs = _DCSClient()
        _dcs_result = _dcs.get_service_log(tail=500)
        data["docker_control_log"] = {"file": _dcs_result.get("file"), "content": _dcs_result.get("content", "")}
        _startup_result = _dcs.get_startup_log(tail=200)
        data["startup_log"] = {"file": _startup_result.get("file"), "content": _startup_result.get("content", "")}
    except Exception as _e:
        data["docker_control_log"] = {"file": None, "content": f"docker-control-service.log not accessible: {_e}"}
        data["startup_log"] = {"file": None, "content": f"startup.log not accessible: {_e}"}

    # 6. Agent Docker logs — fetched via docker-control-service (runs on host, has docker socket)
    try:
        from docker_control.docker_control_client import DockerControlClient
        import requests as _req
        import jwt as _jwt

        client = DockerControlClient()
        containers_resp = client.list_containers(all=True)
        # Response is a dict with a "containers" key or directly a list depending on version
        container_list = containers_resp if isinstance(containers_resp, list) else containers_resp.get("containers", [])
        agent_container = next(
            (c for c in container_list if "agent" in c.get("name", "").lower()),
            None,
        )
        if agent_container:
            container_id = agent_container["id"]
            jwt_secret = os.getenv("DOCKER_CONTROL_JWT_SECRET", "")
            dcs_url = os.getenv("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
            token = _jwt.encode({"service": "backend"}, jwt_secret, algorithm="HS256")
            resp = _req.get(
                f"{dcs_url}/api/v1/containers/{container_id}/logs",
                headers={"Authorization": f"Bearer {token}"},
                params={"follow": "false", "tail": 200},
                timeout=10,
                stream=False,
            )
            data["agent_log"] = {"content": resp.text.strip() or "No agent logs"}
        else:
            data["agent_log"] = {"content": "Agent container not found via docker-control-service"}
    except Exception as e:
        data["agent_log"] = {"content": f"Could not fetch agent logs: {e}"}

    # 7. Inference server artifact workflow logs
    #    Check .artifacts/ path first (artifact-mode), then plain path
    artifact_workflow_root = os.path.join(TT_STUDIO_ROOT, ".artifacts", "tt-inference-server", "workflow_logs")
    plain_workflow_root = os.path.join(TT_STUDIO_ROOT, "tt-inference-server", "workflow_logs")
    workflow_root = artifact_workflow_root if os.path.isdir(artifact_workflow_root) else plain_workflow_root

    def _collect_workflow_subdir(subdir_name: str):
        d = os.path.join(workflow_root, subdir_name)
        if not os.path.isdir(d):
            return []
        files = sorted(
            [os.path.join(d, f) for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))],
            key=os.path.getmtime,
            reverse=True,
        )[:5]
        return [{"file": f, "content": _read_log_tail(f, 300)} for f in files]

    data["inference_run_logs"] = _collect_workflow_subdir("run_logs")
    data["inference_docker_server_logs"] = _collect_workflow_subdir("docker_server")
    data["inference_run_specs"] = _collect_workflow_subdir("run_specs")

    # 8. tt-smi hardware telemetry
    try:
        from board_control.services import SystemResourceService
        tt_smi = SystemResourceService.get_tt_smi_data(timeout=15)
        data["tt_smi"] = tt_smi if tt_smi is not None else {"error": "tt-smi returned no data"}
    except Exception as e:
        data["tt_smi"] = {"error": f"Failed to get tt-smi data: {e}"}

    # 9. Deployment history JSON
    deployments_path = os.path.join(LOGS_ROOT, "backend_volume", "deployments.json")
    try:
        with open(deployments_path, "r") as f:
            data["deployments"] = json.load(f)
    except FileNotFoundError:
        data["deployments"] = []
    except Exception as e:
        data["deployments"] = {"error": str(e)}

    # 10. Current deployed models / containers snapshot (for bug triage)
    data["current_models"] = _collect_current_models_snapshot()

    return data


class BugReportDataView(APIView):
    """
    Returns aggregated log data from all TT-Studio log sources as JSON.
    Used by the frontend to preview log content before creating an issue.
    """

    def get(self, request, *args, **kwargs):
        logger.info("BugReportDataView endpoint hit")
        try:
            data = _collect_bug_report_data()
            return JsonResponse(data, status=200)
        except Exception as e:
            logger.error(f"Error collecting bug report data: {e}")
            return JsonResponse({"error": str(e)}, status=500)


class BugReportDownloadView(APIView):
    """
    Returns a ZIP archive containing all TT-Studio log files for download.
    Each log source is written as a named file inside the archive.
    """

    def get(self, request, *args, **kwargs):
        logger.info("BugReportDownloadView endpoint hit")
        try:
            data = _collect_bug_report_data()
            buf = io.BytesIO()

            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("backend.log", data["backend_log"]["content"])
                zf.writestr("fastapi.log", data["fastapi_log"]["content"])
                zf.writestr("docker-control-service.log", data["docker_control_log"]["content"])
                zf.writestr("startup.log", data["startup_log"]["content"])
                zf.writestr("agent.log", data["agent_log"]["content"])

                for entry in data["fastapi_deployment_logs"]:
                    fname = os.path.basename(entry["file"])
                    zf.writestr(f"fastapi_logs/{fname}", entry["content"])

                for entry in data["inference_run_logs"]:
                    fname = os.path.basename(entry["file"])
                    zf.writestr(f"inference_artifacts/run_logs/{fname}", entry["content"])

                for entry in data["inference_docker_server_logs"]:
                    fname = os.path.basename(entry["file"])
                    zf.writestr(f"inference_artifacts/docker_server/{fname}", entry["content"])

                for entry in data["inference_run_specs"]:
                    fname = os.path.basename(entry["file"])
                    zf.writestr(f"inference_artifacts/run_specs/{fname}", entry["content"])

                zf.writestr("tt_smi.json", json.dumps(data["tt_smi"], indent=2))
                zf.writestr("deployments.json", json.dumps(data["deployments"], indent=2, default=str))
                zf.writestr(
                    "current_models.json",
                    json.dumps(data["current_models"], indent=2, default=str),
                )

            buf.seek(0)
            timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            filename = f"tt-studio-logs-{timestamp}.zip"
            response = HttpResponse(buf.read(), content_type="application/zip")
            response["Content-Disposition"] = f'attachment; filename="{filename}"'
            return response

        except Exception as e:
            logger.error(f"Error generating bug report ZIP: {e}")
            return JsonResponse({"error": str(e)}, status=500)


class GitHubIssueView(APIView):
    """
    Creates a GitHub issue via the API using GITHUB_PAT from backend config.
    Falls back to returning a pre-built browser URL if no PAT is configured.

    POST body (JSON): { title, body, labels? }
    Success response: { issue_url, issue_number, created_via_api }  (201)
                   or { url, created_via_api: false }               (200, fallback)
    """

    GITHUB_API_URL = "https://api.github.com/repos/tenstorrent/tt-studio/issues"
    GITHUB_NEW_ISSUE_URL = "https://github.com/tenstorrent/tt-studio/issues/new"

    def post(self, request, *args, **kwargs):
        from shared_config.backend_config import backend_config

        try:
            body_data = json.loads(request.body)
        except Exception:
            return JsonResponse({"error": "Invalid JSON body"}, status=400)

        title = body_data.get("title", "").strip()
        body = body_data.get("body", "").strip()
        labels = body_data.get("labels", ["bug", "auto-generated"])

        if not title:
            return JsonResponse({"error": "title is required"}, status=400)

        pat = backend_config.github_pat
        if not pat:
            # Graceful fallback: return a pre-built browser URL (body truncated for URL safety)
            params = urlencode({"title": title, "body": body[:8000], "labels": ",".join(labels)})
            url = f"{self.GITHUB_NEW_ISSUE_URL}?{params}"
            return JsonResponse({"url": url, "created_via_api": False}, status=200)

        # Create the issue via GitHub REST API
        payload = json.dumps({"title": title, "body": body, "labels": labels}).encode("utf-8")
        req = urllib.request.Request(
            self.GITHUB_API_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {pat}",
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json",
                "User-Agent": "tt-studio-bug-reporter",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                return JsonResponse(
                    {
                        "issue_url": result.get("html_url"),
                        "issue_number": result.get("number"),
                        "created_via_api": True,
                    },
                    status=201,
                )
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            logger.error(f"GitHub API error {e.code}: {error_body}")
            return JsonResponse({"error": f"GitHub API error: {e.code}", "detail": error_body}, status=502)
        except Exception as e:
            logger.error(f"Failed to create GitHub issue: {e}")
            return JsonResponse({"error": str(e)}, status=500)
