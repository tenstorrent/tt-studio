# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Client for the community-model endpoints on the host inference-api service.

The tt-model-manager path is the sibling of tt_inference_client: the backend runs in a
container and cannot touch /dev/tenstorrent, the docker socket or the host HF cache, so
every operation goes to inference-api on the host, which owns the tt-model-manager
artifact.

Catalog reads are cached: they cost a Hugging Face Hub request, the deploy UI asks for
them on every visit, and a Hub outage must degrade to "no community models" rather than
break the model list.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests

from shared_config.backend_config import backend_config
from shared_config.community_model_config import (
    CommunityModelImpl,
    build_community_model_impl,
    parse_community_model_id,
)

logger = logging.getLogger(__name__)

_CATALOG_TTL_SECONDS = 300
_BUNDLE_TTL_SECONDS = 300
_STATUS_TTL_SECONDS = 60

_lock = threading.Lock()
_cache: Dict[str, Dict[str, Any]] = {}


@dataclass(frozen=True)
class CommunityRunResult:
    """Mirror of TTInferenceRunResult so both launchers report the same shape."""

    status: str  # "success" | "error"
    job_id: Optional[str] = None
    message: str = ""
    api_response: Optional[Dict[str, Any]] = None


def _url(path: str) -> str:
    return f"{backend_config.tt_inference_api_url.rstrip('/')}/community/{path.lstrip('/')}"


def _cached(key: str, ttl: int, producer):
    """Return a cached value, refreshing it when stale.

    On a refresh failure a previously cached value is served rather than dropped: a
    transient Hub or inference-api hiccup should not empty the community model list.
    """
    now = time.time()
    with _lock:
        entry = _cache.get(key)
        if entry and now - entry["at"] < ttl:
            return entry["value"]
    try:
        value = producer()
    except Exception as e:
        logger.warning(f"community fetch '{key}' failed: {e}")
        with _lock:
            entry = _cache.get(key)
        return entry["value"] if entry else None
    with _lock:
        _cache[key] = {"at": now, "value": value}
    return value


def invalidate_cache() -> None:
    """Drop cached catalog/bundle data (after an install, removal, or explicit refresh)."""
    with _lock:
        _cache.clear()


def _get(path: str, params: Optional[Dict[str, Any]] = None, timeout: int = 20) -> Any:
    response = requests.get(_url(path), params=params or {}, timeout=timeout)
    response.raise_for_status()
    return response.json()


def community_status() -> Dict[str, Any]:
    """Whether the host can deploy community models. Cached; never raises."""
    value = _cached("status", _STATUS_TTL_SECONDS, lambda: _get("status", timeout=5))
    return value or {"available": False, "python": None, "ref": None}


def community_available() -> bool:
    return bool(community_status().get("available"))


def fetch_catalog(arch: Optional[str] = None, refresh: bool = False) -> List[Dict[str, Any]]:
    """Community bundles published for ``arch``. Empty when unavailable."""
    if refresh:
        invalidate_cache()
    if not community_available():
        return []
    key = f"catalog:{arch}"

    def produce():
        params = {"arch": arch} if arch else {}
        return (_get("models", params, timeout=60) or {}).get("bundles") or []

    return _cached(key, _CATALOG_TTL_SECONDS, produce) or []


def fetch_bundle(repo_id: str, refresh: bool = False) -> Optional[Dict[str, Any]]:
    """Deployable metadata for one bundle (profiles, mesh, weights, engine)."""
    key = f"bundle:{repo_id}"
    if refresh:
        with _lock:
            _cache.pop(key, None)
    if not community_available():
        return None
    return _cached(key, _BUNDLE_TTL_SECONDS,
                   lambda: _get(f"models/{repo_id}", timeout=60))


def get_community_impl(model_id: str, service_port: int = 7000) -> Optional[CommunityModelImpl]:
    """Resolve a community model_id to an impl, or None when it can't be resolved."""
    try:
        repo_id, profile = parse_community_model_id(model_id)
    except ValueError:
        return None
    bundle = fetch_bundle(repo_id)
    if not bundle:
        return None
    return build_community_model_impl(bundle, profile, service_port=service_port)


def start_community_deployment(
    *,
    repo_id: str,
    profile: Optional[str] = None,
    service_port: Optional[int] = None,
    device_ids: Optional[List[int]] = None,
    network: Optional[str] = None,
    timeout_seconds: int = 30,
) -> CommunityRunResult:
    """Start a deployment via inference-api ``/community/run``.

    Returns quickly with a job_id; progress is polled through the existing
    ``/run/progress/<job_id>`` API, which community jobs share.
    """
    payload: Dict[str, Any] = {"repo_id": repo_id}
    if profile:
        payload["profile"] = profile
    if service_port is not None:
        payload["service_port"] = service_port
    if device_ids:
        payload["device_ids"] = list(device_ids)
    if network:
        payload["network"] = network

    # inference-api runs on the host and cannot read the persistent volume the backend
    # writes user_config.env into, so the token travels in the request as it does for
    # the inference-server path.
    from shared_config.user_config import get_hf_token
    hf_token = get_hf_token()
    if hf_token:
        payload["hf_token"] = hf_token

    try:
        response = requests.post(_url("run"), json=payload, timeout=timeout_seconds)
    except requests.exceptions.RequestException as e:
        return CommunityRunResult(
            status="error", message=f"Network error calling tt-model-manager: {e}"
        )

    if response.status_code not in (200, 202):
        return CommunityRunResult(
            status="error",
            message=_error_message(response, f"deployment of {repo_id} failed"),
        )

    try:
        api_result = response.json() if response.content else {}
    except ValueError as e:
        return CommunityRunResult(
            status="error", message=f"Bad response from tt-model-manager: {e}"
        )

    job_id = api_result.get("job_id")
    if not job_id:
        logger.error(f"community /run returned no job_id for {repo_id}: {api_result}")
        return CommunityRunResult(
            status="error",
            message="tt-model-manager did not return a job_id — deployment may not have started",
            api_response=api_result,
        )
    return CommunityRunResult(
        status="success",
        job_id=job_id,
        message=api_result.get("message", "Deployment started"),
        api_response=api_result,
    )


def stop_community_deployment(
    repo_id: str, profile: Optional[str] = None, timeout_seconds: int = 180
) -> Dict[str, Any]:
    """Stop a bundle through tt-model-manager.

    Not a docker stop: tt-model-manager sends SIGTERM so the server closes the mesh,
    and resets the mesh itself if docker had to SIGKILL. A plain docker stop would
    leave the chips needing a reset before anything else could open them.
    """
    payload: Dict[str, Any] = {"repo_id": repo_id}
    if profile:
        payload["profile"] = profile
    try:
        response = requests.post(_url("stop"), json=payload, timeout=timeout_seconds)
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": f"Network error stopping {repo_id}: {e}"}
    if response.status_code != 200:
        return {"status": "error", "message": _error_message(response, f"could not stop {repo_id}")}
    try:
        return response.json() or {}
    except ValueError:
        return {"status": "error", "message": f"Bad response stopping {repo_id}"}


def _error_message(response, fallback: str) -> str:
    """The service's own `detail` when present — it carries the actionable wording."""
    try:
        detail = (response.json() or {}).get("detail")
    except ValueError:
        detail = None
    return str(detail) if detail else f"{fallback} (HTTP {response.status_code})"
