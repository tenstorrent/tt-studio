# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Container Management Router
"""

import docker
import logging
import json
import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.requests import ContainerRunRequest, ContainerStopRequest
from models.responses import (
    ContainerRunResponse,
    ContainerListResponse,
    ContainerDetailsResponse,
    OperationResponse
)
from services.container_service import ContainerService

router = APIRouter()
logger = logging.getLogger(__name__)


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
                            if line:  # Only send non-empty lines
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
