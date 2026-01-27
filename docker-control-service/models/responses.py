# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Pydantic Response Models for Docker Control Service
"""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


class ContainerRunResponse(BaseModel):
    """Response model for container run operation"""
    status: str = Field(..., description="Operation status: 'success' or 'error'")
    container_id: Optional[str] = Field(None, description="Container ID")
    container_name: Optional[str] = Field(None, description="Container name")
    message: Optional[str] = Field(None, description="Error message if failed")
    port_bindings: Optional[Dict] = Field(None, description="Actual port bindings")


class ContainerInfo(BaseModel):
    """Container information model"""
    id: str
    name: str
    status: str
    image: str
    created: Optional[str] = None
    ports: Optional[Dict] = None
    networks: Optional[List[str]] = None


class ContainerListResponse(BaseModel):
    """Response model for listing containers"""
    status: str
    containers: List[Dict[str, Any]]


class ContainerDetailsResponse(BaseModel):
    """Response model for container details"""
    status: str
    container: Optional[ContainerInfo] = None
    message: Optional[str] = None


class OperationResponse(BaseModel):
    """Generic operation response"""
    status: str
    message: Optional[str] = None
    exists: Optional[bool] = Field(None, description="Whether the resource exists (for existence checks)")


class ImagePullProgress(BaseModel):
    """Progress update for image pull operation"""
    status: str = Field(..., description="'pulling', 'success', or 'error'")
    progress: int = Field(..., description="Progress percentage (0-100)")
    current: int = Field(0, description="Current bytes downloaded")
    total: int = Field(0, description="Total bytes to download")
    message: str = Field("", description="Status message")
    layer_id: Optional[str] = Field(None, description="Layer ID being pulled")


class ImageListResponse(BaseModel):
    """Response model for listing images"""
    status: str
    images: List[Dict[str, Any]]


class NetworkListResponse(BaseModel):
    """Response model for listing networks"""
    status: str
    networks: List[Dict[str, Any]]


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: str
    checks: Dict[str, str]
