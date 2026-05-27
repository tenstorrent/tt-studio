# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import logging
from fastapi import APIRouter, HTTPException
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


def _read_tail(path: str, lines: int) -> str:
    try:
        with open(path, "r") as f:
            content = f.readlines()
        return "".join(content[-lines:])
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Log file not found: {path}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs/service")
async def get_service_log(tail: int = 500):
    if not settings.SERVICE_LOG_FILE:
        raise HTTPException(status_code=503, detail="Service log path not configured")
    logger.debug(f"Serving service log: {settings.SERVICE_LOG_FILE}")
    return {"content": _read_tail(settings.SERVICE_LOG_FILE, tail), "file": settings.SERVICE_LOG_FILE}


@router.get("/logs/startup")
async def get_startup_log(tail: int = 200):
    if not settings.STARTUP_LOG_FILE:
        raise HTTPException(status_code=503, detail="Startup log path not configured")
    logger.debug(f"Serving startup log: {settings.STARTUP_LOG_FILE}")
    return {"content": _read_tail(settings.STARTUP_LOG_FILE, tail), "file": settings.STARTUP_LOG_FILE}


@router.get("/logs/fastapi")
async def get_fastapi_log(tail: int = 500):
    if not settings.FASTAPI_LOG_FILE:
        raise HTTPException(status_code=503, detail="FastAPI log path not configured")
    logger.debug(f"Serving fastapi log: {settings.FASTAPI_LOG_FILE}")
    return {"content": _read_tail(settings.FASTAPI_LOG_FILE, tail), "file": settings.FASTAPI_LOG_FILE}
