# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
JWT Authentication Middleware for Docker Control Service
"""

import logging
from fastapi import Request
from fastapi.responses import JSONResponse
import jwt

from config import settings

logger = logging.getLogger(__name__)


async def authenticate_request(request: Request, call_next):
    """
    Middleware to validate JWT token on every request.
    Skips authentication for health endpoint.
    """
    # Skip auth for health endpoint
    if request.url.path == "/api/v1/health":
        return await call_next(request)

    # Verify JWT token
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()

    if not token:
        logger.warning(f"Missing authentication token from {request.client.host}")
        return JSONResponse(
            status_code=401,
            content={"error": "Missing authentication token"}
        )

    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        request.state.auth_payload = payload
        logger.debug(f"Authenticated request from service: {payload.get('service', 'unknown')}")
    except jwt.ExpiredSignatureError:
        logger.warning(f"Expired JWT token from {request.client.host}")
        return JSONResponse(
            status_code=401,
            content={"error": "Token has expired"}
        )
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid JWT token from {request.client.host}: {e}")
        return JSONResponse(
            status_code=401,
            content={"error": "Invalid authentication token"}
        )

    return await call_next(request)
