# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Image Management Router
"""

import docker
import logging
import threading
import time
from typing import Dict

from fastapi import APIRouter, HTTPException

from models.requests import ImagePullRequest, ImagePullStartRequest
from models.responses import ImageListResponse, OperationResponse

router = APIRouter()
logger = logging.getLogger(__name__)

# Streamed (progress-tracked) image pulls. Docker's daemon emits a per-layer JSON event stream for every pull.
_PULLS: Dict[str, dict] = {}
_PULLS_LOCK = threading.Lock()
_PULL_ENTRY_TTL_SECONDS = 3600  # drop finished entries after an hour to bound memory


def _new_pull_entry() -> dict:
    return {
        "status": "pulling",          # pulling | success | error
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "layers_done": 0,
        "layers_total": 0,
        "message": "Preparing to pull image…",
        "error": None,
        "started_at": time.time(),
        "updated_at": time.time(),
    }


def _evict_stale_locked() -> None:
    now = time.time()
    stale = [
        pid for pid, e in _PULLS.items()
        if e["status"] != "pulling" and now - e["updated_at"] > _PULL_ENTRY_TTL_SECONDS
    ]
    for pid in stale:
        _PULLS.pop(pid, None)


def _run_pull(pull_id: str, image_name: str, image_tag: str) -> None:
    """Background worker: stream a docker pull and aggregate byte progress."""
    image_ref = f"{image_name}:{image_tag}"
    # Per-layer download accounting
    layers: Dict[str, dict] = {}

    def publish(**changes):
        with _PULLS_LOCK:
            entry = _PULLS.get(pull_id)
            if entry is None:
                return
            entry.update(changes)
            entry["updated_at"] = time.time()

    try:
        client = docker.from_env()
        logger.info(f"[pull {pull_id}] streaming pull of {image_ref}")
        for event in client.api.pull(image_name, tag=image_tag, stream=True, decode=True):
            if not isinstance(event, dict):
                continue

            err = event.get("error") or (event.get("errorDetail") or {}).get("message")
            if err:
                logger.error(f"[pull {pull_id}] error: {err}")
                publish(status="error", error=str(err), message=str(err))
                return

            status_text = (event.get("status") or "").strip()
            layer_id = event.get("id")
            detail = event.get("progressDetail") or {}

            if layer_id:
                layer = layers.setdefault(layer_id, {"current": 0, "total": 0, "done": False})
                low = status_text.lower()
                if low == "downloading":
                    if detail.get("total"):
                        layer["total"] = int(detail["total"])
                    if detail.get("current") is not None:
                        layer["current"] = int(detail["current"])
                elif low in ("download complete", "pull complete", "already exists"):
                    # Network transfer finished for this layer.
                    if layer["total"]:
                        layer["current"] = layer["total"]
                    layer["done"] = True

            downloaded = sum(l["current"] for l in layers.values())
            total = sum(l["total"] for l in layers.values())
            layers_total = len(layers)
            layers_done = sum(1 for l in layers.values() if l["done"])

            msg = status_text or "Pulling image…"
            if layer_id and status_text:
                msg = f"{status_text} {layer_id[:12]}"

            publish(
                downloaded_bytes=downloaded,
                total_bytes=total,
                layers_done=layers_done,
                layers_total=layers_total,
                message=msg,
            )

        # Generator exhausted without an error event → pull succeeded.
        logger.info(f"[pull {pull_id}] {image_ref} pulled successfully")
        with _PULLS_LOCK:
            entry = _PULLS.get(pull_id)
            if entry is not None and entry["status"] == "pulling":
                # Snap byte counts to 100% so the UI shows a clean finish.
                if entry["total_bytes"] > 0:
                    entry["downloaded_bytes"] = entry["total_bytes"]
                entry["status"] = "success"
                entry["message"] = f"Image {image_ref} pulled successfully"
                entry["updated_at"] = time.time()

    except docker.errors.APIError as e:
        logger.error(f"[pull {pull_id}] docker API error: {e}")
        publish(status="error", error=str(e), message=str(e))
    except Exception as e:
        logger.error(f"[pull {pull_id}] unexpected error: {e}")
        publish(status="error", error=str(e), message=str(e))


@router.post("/images/pull/start", response_model=OperationResponse)
async def start_pull_image(request: ImagePullStartRequest):
    """Start a background, progress-tracked image pull.

    Returns immediately; poll GET /images/pull/progress/{pull_id} for byte-level
    progress. Safe to call repeatedly for the same pull_id (a live pull is reused).
    """
    pull_id = request.pull_id
    with _PULLS_LOCK:
        _evict_stale_locked()
        existing = _PULLS.get(pull_id)
        if existing is not None and existing["status"] == "pulling":
            return {"status": "success", "message": f"Pull {pull_id} already in progress"}
        _PULLS[pull_id] = _new_pull_entry()

    thread = threading.Thread(
        target=_run_pull,
        args=(pull_id, request.image_name, request.image_tag),
        daemon=True,
        name=f"image-pull-{pull_id[:12]}",
    )
    thread.start()
    return {"status": "success", "message": f"Pull {pull_id} started"}


@router.get("/images/pull/progress/{pull_id}")
async def get_pull_progress(pull_id: str):
    """Return the latest aggregated progress snapshot for a streamed pull."""
    with _PULLS_LOCK:
        entry = _PULLS.get(pull_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"No pull tracked for {pull_id}")
        snapshot = dict(entry)
    snapshot["pull_id"] = pull_id
    return snapshot


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
