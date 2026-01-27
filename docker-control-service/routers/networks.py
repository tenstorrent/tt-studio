# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Network Management Router
"""

import docker
import logging
from fastapi import APIRouter, HTTPException

from models.requests import NetworkCreateRequest
from models.responses import NetworkListResponse, OperationResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/networks/create", response_model=OperationResponse)
async def create_network(request: NetworkCreateRequest):
    """
    Create a Docker network.

    - name: Network name
    - driver: Network driver (default: 'bridge')
    """
    try:
        client = docker.from_env()

        logger.info(f"Creating network: {request.name} (driver={request.driver})")

        network = client.networks.create(
            name=request.name,
            driver=request.driver
        )

        logger.info(f"Network created successfully: {request.name}")
        return {
            "status": "success",
            "message": f"Network {request.name} created successfully"
        }

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error creating network: {error_msg}")

        if "already exists" in error_msg.lower():
            raise HTTPException(status_code=409, detail=f"Network {request.name} already exists")

        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error creating network: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/networks/{name}", response_model=OperationResponse)
async def remove_network(name: str):
    """
    Remove a Docker network.

    - name: Network name or ID
    """
    try:
        client = docker.from_env()

        logger.info(f"Removing network: {name}")

        network = client.networks.get(name)
        network.remove()

        logger.info(f"Network removed successfully: {name}")
        return {
            "status": "success",
            "message": f"Network {name} removed successfully"
        }

    except docker.errors.NotFound:
        error_msg = f"Network {name} not found"
        logger.error(error_msg)
        raise HTTPException(status_code=404, detail=error_msg)

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error removing network: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error removing network: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/networks", response_model=NetworkListResponse)
async def list_networks():
    """
    List all Docker networks.
    """
    try:
        client = docker.from_env()

        logger.info("Listing networks")
        networks = client.networks.list()

        network_list = []
        for network in networks:
            network_list.append({
                "id": network.id,
                "name": network.name,
                "driver": network.attrs.get("Driver", ""),
                "scope": network.attrs.get("Scope", ""),
                "created": network.attrs.get("Created", "")
            })

        logger.info(f"Listed {len(network_list)} networks")
        return {
            "status": "success",
            "networks": network_list
        }

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error listing networks: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error listing networks: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/networks/{name}/connect", response_model=OperationResponse)
async def connect_container_to_network(name: str, container_id: str):
    """
    Connect a container to a network.

    - name: Network name or ID
    - container_id: Container ID or name
    """
    try:
        client = docker.from_env()

        logger.info(f"Connecting container {container_id} to network {name}")

        network = client.networks.get(name)
        network.connect(container_id)

        logger.info(f"Container connected successfully: {container_id} -> {name}")
        return {
            "status": "success",
            "message": f"Container {container_id} connected to network {name}"
        }

    except docker.errors.NotFound as e:
        error_msg = str(e)
        logger.error(f"Not found: {error_msg}")
        raise HTTPException(status_code=404, detail=error_msg)

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error connecting container to network: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error connecting container to network: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/networks/{name}/disconnect", response_model=OperationResponse)
async def disconnect_container_from_network(name: str, container_id: str):
    """
    Disconnect a container from a network.

    - name: Network name or ID
    - container_id: Container ID or name
    """
    try:
        client = docker.from_env()

        logger.info(f"Disconnecting container {container_id} from network {name}")

        network = client.networks.get(name)
        network.disconnect(container_id)

        logger.info(f"Container disconnected successfully: {container_id} <- {name}")
        return {
            "status": "success",
            "message": f"Container {container_id} disconnected from network {name}"
        }

    except docker.errors.NotFound as e:
        error_msg = str(e)
        logger.error(f"Not found: {error_msg}")
        raise HTTPException(status_code=404, detail=error_msg)

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error disconnecting container from network: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error disconnecting container from network: {e}")
        raise HTTPException(status_code=500, detail=str(e))
