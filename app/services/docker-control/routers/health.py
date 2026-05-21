# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Health Check Router - No authentication required
"""

import docker
import logging
import shutil
from datetime import datetime
from fastapi import APIRouter
from models.responses import HealthResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Comprehensive health check endpoint.
    Does not require authentication.
    """
    health_status = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "checks": {}
    }

    # Check Docker daemon
    try:
        client = docker.from_env()
        client.ping()
        health_status["checks"]["docker"] = "healthy"
        logger.debug("Docker daemon health check: OK")
    except Exception as e:
        health_status["checks"]["docker"] = f"unhealthy: {str(e)}"
        health_status["status"] = "unhealthy"
        logger.error(f"Docker daemon health check failed: {e}")

    # Check disk space
    try:
        total, used, free = shutil.disk_usage("/")
        free_gb = free / (1024**3)
        if free_gb < 10:
            health_status["checks"]["disk"] = f"warning: only {free_gb:.1f}GB free"
            health_status["status"] = "degraded"
            logger.warning(f"Low disk space: {free_gb:.1f}GB free")
        else:
            health_status["checks"]["disk"] = "healthy"
            logger.debug(f"Disk space check: {free_gb:.1f}GB free")
    except Exception as e:
        health_status["checks"]["disk"] = f"error: {str(e)}"
        logger.error(f"Disk space check failed: {e}")

    return health_status
