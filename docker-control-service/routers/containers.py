# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Container Management Router
"""

import docker
import logging
import json
import datetime
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.requests import ContainerRunRequest, ContainerStopRequest, ContainerDirSizeRequest
from models.responses import (
    ContainerRunResponse,
    ContainerListResponse,
    ContainerDetailsResponse,
    ContainerDirSizeResponse,
    OperationResponse
)
from services.container_service import ContainerService

router = APIRouter()
logger = logging.getLogger(__name__)

# Drop uvicorn per-request access logs from the streamed view. tt-studio's own
# health pollers and the agent's discovery loop generate thousands of these
# `INFO:     <ip>:<port> - "GET /path HTTP/1.1" <code>` lines per warmup window,
# burying real lifecycle events. Matches the same shape the backend classifier
# uses (app/backend/model_control/log_classifier.py).
_UVICORN_ACCESS_LOG_RE = re.compile(
    r'^\s*INFO:\s+\S+:\d+\s+-\s+"\S+\s+/\S*\s+HTTP/[\d.]+"\s+\d+'
)


def get_service():
    """Dependency to get container service instance"""
    return ContainerService()


@router.post("/containers/run", response_model=ContainerRunResponse)
async def run_container(request: ContainerRunRequest):
    """
    Run a new Docker container with security validation.

    - Validates image against allowed registries
    - Prevents privileged mode
    - Validates network access
    """
    try:
        logger.info(f"Received run container request: {request.image}")
        result = get_service().run_container(request)

        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result.get("message", "Unknown error"))

        return result

    except ValueError as e:
        # Validation errors
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        logger.error(f"Error running container: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/stop", response_model=OperationResponse)
async def stop_container(container_id: str, request: ContainerStopRequest = ContainerStopRequest()):
    """
    Stop a running container.

    - container_id: Container ID or name
    - timeout: Seconds to wait before killing (default: 10)
    """
    try:
        logger.info(f"Received stop container request: {container_id}")
        result = get_service().stop_container(container_id, timeout=request.timeout)

        if result["status"] == "error":
            if "not found" in result.get("message", "").lower():
                raise HTTPException(status_code=404, detail=result["message"])
            raise HTTPException(status_code=400, detail=result.get("message", "Unknown error"))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error stopping container: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/remove", response_model=OperationResponse)
async def remove_container(container_id: str, force: bool = False):
    """
    Remove a container.

    - container_id: Container ID or name
    - force: Force removal even if running
    """
    try:
        logger.info(f"Received remove container request: {container_id} (force={force})")
        result = get_service().remove_container(container_id, force=force)

        if result["status"] == "error":
            if "not found" in result.get("message", "").lower():
                raise HTTPException(status_code=404, detail=result["message"])
            raise HTTPException(status_code=400, detail=result.get("message", "Unknown error"))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing container: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/containers", response_model=ContainerListResponse)
async def list_containers(all: bool = False):
    """
    List Docker containers.

    - all: Include stopped containers (default: False)
    """
    try:
        logger.info(f"Received list containers request (all={all})")
        result = get_service().list_containers(all=all)
        return result

    except Exception as e:
        logger.error(f"Error listing containers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/containers/{container_id}", response_model=ContainerDetailsResponse)
async def get_container(container_id: str):
    """
    Get detailed information about a container.

    - container_id: Container ID or name
    """
    try:
        logger.info(f"Received get container request: {container_id}")
        result = get_service().get_container(container_id)

        if result["status"] == "error":
            if "not found" in result.get("message", "").lower():
                raise HTTPException(status_code=404, detail=result["message"])
            raise HTTPException(status_code=400, detail=result.get("message", "Unknown error"))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting container: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/rename", response_model=OperationResponse)
async def rename_container(container_id: str, new_name: str):
    """
    Rename a container.

    - container_id: Container ID or name
    - new_name: New name for the container (query parameter)
    """
    try:
        client = docker.from_env()

        logger.info(f"Renaming container {container_id} to {new_name}")

        container = client.containers.get(container_id)
        container.rename(new_name)

        logger.info(f"Container renamed successfully: {container_id} -> {new_name}")
        return {
            "status": "success",
            "message": f"Container renamed to {new_name}"
        }

    except docker.errors.NotFound:
        error_msg = f"Container {container_id} not found"
        logger.error(error_msg)
        raise HTTPException(status_code=404, detail=error_msg)

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error renaming container: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error renaming container: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/dir-size", response_model=ContainerDirSizeResponse)
async def container_dir_size(container_id: str, request: ContainerDirSizeRequest):
    """Recursive byte count of an absolute path inside a running container.

    Read-only helper used by the backend's download-progress display. The body
    is intentionally narrow — a single absolute path and a timeout — so this
    endpoint cannot be repurposed as a generic exec.
    """
    if not request.path.startswith("/"):
        raise HTTPException(status_code=400, detail="path must be absolute")
    if "\x00" in request.path:
        raise HTTPException(status_code=400, detail="path contains NUL")

    try:
        client = docker.from_env()
        try:
            container = client.containers.get(container_id)
        except docker.errors.NotFound:
            raise HTTPException(status_code=404, detail=f"container {container_id} not found")

        # Single-quote escape for `sh -c`. stderr discarded so a transient ENOENT
        # (path being created mid-download) returns "" rather than erroring.
        quoted = "'" + request.path.replace("'", "'\\''") + "'"
        cmd = ["sh", "-c", f"du -sb {quoted} 2>/dev/null | cut -f1"]

        result = container.exec_run(cmd, demux=False, stream=False, tty=False)
        output = result.output
        if isinstance(output, bytes):
            text = output.decode("utf-8", errors="ignore").strip()
        elif isinstance(output, str):
            text = output.strip()
        else:
            text = ""

        if not text:
            return ContainerDirSizeResponse(status="success", bytes=0)
        first = text.splitlines()[0].strip()
        if not first.isdigit():
            return ContainerDirSizeResponse(status="success", bytes=0)
        return ContainerDirSizeResponse(status="success", bytes=int(first))

    except HTTPException:
        raise
    except docker.errors.APIError as e:
        logger.warning(f"dir-size docker API error on {container_id[:12]}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning(f"dir-size failed on {container_id[:12]}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/containers/{container_id}/logs")
async def get_container_logs(container_id: str, follow: bool = True, tail: int = 100):
    """
    Stream container logs using Server-Sent Events.

    - container_id: Container ID or name
    - follow: Follow log output in real-time (default: True)
    - tail: Number of lines to show from end of logs (default: 100)
    """
    try:
        logger.info(f"Received logs stream request: {container_id} (follow={follow}, tail={tail})")

        def generate_sse_logs():
            """Generate Server-Sent Events from container logs"""
            try:
                # Send SSE retry configuration
                yield "retry: 1000\n\n"

                # Stream logs from container
                service = get_service()
                for log_line in service.get_logs_stream(container_id, follow=follow, tail=tail):
                    try:
                        # Decode log line
                        log_text = log_line.decode('utf-8', errors='replace')

                        # Split into individual lines and process each
                        for line in log_text.split('\n'):
                            line = line.rstrip('\r')  # Remove carriage returns
                            if not line:
                                continue
                            # Only filter access-log noise when the caller is
                            # streaming for the UI Logs tab (follow=True). One-shot
                            # callers (e.g. the backend classifier via tail_logs)
                            # need the full tail — they apply their own filter and
                            # would otherwise see an empty list when the tail is
                            # dominated by /health / /v1/models access lines.
                            if follow and _UVICORN_ACCESS_LOG_RE.match(line):
                                continue
                            # Create log data with timestamp
                            timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                            # Determine message type (simple heuristic)
                            message_type = "log"
                            line_upper = line.upper()
                            if any(keyword in line_upper for keyword in ["ERROR", "EXCEPTION", "FAILED", "FATAL"]):
                                message_type = "error"
                            elif any(keyword in line_upper for keyword in ["WARNING", "WARN"]):
                                message_type = "warning"
                            elif any(keyword in line_upper for keyword in ["INFO", "STARTED", "LISTENING", "READY"]):
                                message_type = "event"

                            log_data = {
                                "type": message_type,
                                "message": line,
                                "timestamp": timestamp,
                                "raw": True
                            }
                            yield f"data: {json.dumps(log_data)}\n\n"

                    except Exception as decode_error:
                        # Fallback for problematic log lines
                        error_msg = f"[LOG DECODE ERROR] {str(decode_error)}"
                        log_data = {
                            "type": "log",
                            "message": error_msg,
                            "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                            "raw": True
                        }
                        yield f"data: {json.dumps(log_data)}\n\n"

            except docker.errors.NotFound:
                error_data = {
                    "type": "error",
                    "message": f"Container {container_id} not found",
                    "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                yield f"data: {json.dumps(error_data)}\n\n"
            except Exception as e:
                logger.error(f"Error in logs stream: {str(e)}")
                error_data = {
                    "type": "error",
                    "message": f"Error streaming logs: {str(e)}",
                    "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                yield f"data: {json.dumps(error_data)}\n\n"

        # Return streaming response with SSE content type
        return StreamingResponse(
            generate_sse_logs(),
            media_type='text/event-stream',
            headers={
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no'
            }
        )

    except Exception as e:
        logger.error(f"Error setting up logs stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))
