# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Docker Control Service - FastAPI Application

Secure Docker operations API for TT-Studio.
Runs on host (not containerized) with direct access to docker.sock.
Port: 8002
Authentication: JWT
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from config import settings
from middleware.auth import authenticate_request
from routers import health, containers, images, networks

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create FastAPI application
app = FastAPI(
    title="Docker Control Service",
    description="Secure Docker operations API for TT-Studio",
    version="1.0.0",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
    openapi_url="/api/v1/openapi.json"
)

# CORS configuration - only allow backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://tt-studio-backend-api:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add JWT authentication middleware
app.middleware("http")(authenticate_request)

# Include routers
app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(containers.router, prefix="/api/v1", tags=["containers"])
app.include_router(images.router, prefix="/api/v1", tags=["images"])
app.include_router(networks.router, prefix="/api/v1", tags=["networks"])


@app.on_event("startup")
async def startup_event():
    """Application startup event handler"""
    logger.info("=" * 60)
    logger.info("Docker Control Service starting up...")
    logger.info(f"Listening on {settings.HOST}:{settings.PORT}")
    logger.info(f"Development mode: {settings.DEV_MODE}")
    logger.info(f"API documentation: http://{settings.HOST}:{settings.PORT}/api/v1/docs")
    logger.info("=" * 60)


@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown event handler"""
    logger.info("Docker Control Service shutting down...")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEV_MODE,
        log_level="info"
    )
