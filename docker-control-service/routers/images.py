# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Image Management Router
"""

import docker
import logging
from fastapi import APIRouter, HTTPException

from models.requests import ImagePullRequest
from models.responses import ImageListResponse, OperationResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/images/pull", response_model=OperationResponse)
async def pull_image(request: ImagePullRequest):
    """
    Pull a Docker image.

    - image_name: Image name (e.g., 'ubuntu')
    - image_tag: Image tag (default: 'latest')
    - registry_auth: Optional authentication credentials
    """
    try:
        client = docker.from_env()
        image_ref = f"{request.image_name}:{request.image_tag}"

        logger.info(f"Pulling image: {image_ref}")

        # Pull image with optional authentication
        image = client.images.pull(
            request.image_name,
            tag=request.image_tag,
            auth_config=request.registry_auth
        )

        logger.info(f"Image pulled successfully: {image_ref}")
        return {
            "status": "success",
            "message": f"Image {image_ref} pulled successfully"
        }

    except docker.errors.ImageNotFound:
        error_msg = f"Image {image_ref} not found"
        logger.error(error_msg)
        raise HTTPException(status_code=404, detail=error_msg)

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error pulling image: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error pulling image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/images/remove", response_model=OperationResponse)
async def remove_image(name: str, tag: str = "latest", force: bool = False):
    """
    Remove a Docker image.

    Query parameters:
    - name: Image name
    - tag: Image tag (default: 'latest')
    - force: Force removal even if used by containers (default: false)
    """
    try:
        client = docker.from_env()
        image_ref = f"{name}:{tag}"

        logger.info(f"Removing image: {image_ref} (force={force})")

        client.images.remove(image_ref, force=force)

        logger.info(f"Image removed successfully: {image_ref}")
        return {
            "status": "success",
            "message": f"Image {image_ref} removed successfully"
        }

    except docker.errors.ImageNotFound:
        error_msg = f"Image {image_ref} not found"
        logger.error(error_msg)
        raise HTTPException(status_code=404, detail=error_msg)

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error removing image: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error removing image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/images", response_model=ImageListResponse)
async def list_images():
    """
    List all Docker images.
    """
    try:
        client = docker.from_env()

        logger.info("Listing images")
        images = client.images.list()

        image_list = []
        for image in images:
            # Get tags or ID
            tags = image.tags if image.tags else [image.short_id]

            image_list.append({
                "id": image.id,
                "tags": tags,
                "size": image.attrs.get("Size", 0),
                "created": image.attrs.get("Created", "")
            })

        logger.info(f"Listed {len(image_list)} images")
        return {
            "status": "success",
            "images": image_list
        }

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error listing images: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error listing images: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/images/exists", response_model=OperationResponse)
async def check_image_exists(name: str, tag: str = "latest"):
    """
    Check if a Docker image exists locally.

    Query parameters:
    - name: Image name (e.g., 'ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64')
    - tag: Image tag (e.g., '0.0.4-v0.56.0-rc47-e2e0002ac7dc')
    """
    try:
        client = docker.from_env()
        image_ref = f"{name}:{tag}"

        logger.info(f"Checking if image exists: {image_ref}")

        try:
            client.images.get(image_ref)
            logger.info(f"Image exists: {image_ref}")
            return {
                "status": "success",
                "message": f"Image {image_ref} exists",
                "exists": True
            }
        except docker.errors.ImageNotFound:
            logger.info(f"Image does not exist: {image_ref}")
            return {
                "status": "success",
                "message": f"Image {image_ref} does not exist",
                "exists": False
            }

    except docker.errors.APIError as e:
        error_msg = str(e)
        logger.error(f"Error checking image: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        logger.error(f"Unexpected error checking image: {e}")
        raise HTTPException(status_code=500, detail=str(e))
