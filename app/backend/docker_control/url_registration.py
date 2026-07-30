# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"""Register a model served from a URL rather than a container TT Studio manages.

The normal deploy path identifies a model by matching a live container against a catalog
image. That makes two things impossible: a model with no catalog entry, and a model with no
container at all -- which is exactly a bare-metal Forge server running as a host process.

This module supplies the missing pieces:

  * normalise_base_url()  rewrites host-local addresses to host.docker.internal, because the
                          backend runs in a container and "localhost" there is itself
  * probe_model()         confirms the endpoint is really an OpenAI server and asks it which
                          model it serves, so we do not have to trust user input
  * build_url_model_impl()  a synthetic ModelImpl, since model identity normally comes from
                          the catalog and there is no catalog entry here
  * canonical_entry_for()  the deploy-cache entry, so the chat UI and InferenceView treat it
                          like any other deployment
"""
import json
import urllib.error
import urllib.request
from typing import Optional
from urllib.parse import urlparse

from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import ModelImpl, base_docker_config
from shared_config.model_type_config import ModelTypes
from shared_config.setup_config import SetupTypes

logger = get_logger(__name__)

# The backend is containerised, so a host process is reachable at host.docker.internal
# (app/docker-compose.yml already sets extra_hosts: host.docker.internal:host-gateway).
_HOST_ALIASES = ("localhost", "127.0.0.1", "0.0.0.0", "::1")
_DOCKER_HOST_ALIAS = "host.docker.internal"

# Marker used in place of a container id, so the record is obviously not a container.
URL_DEPLOYMENT_PREFIX = "url-"


class UrlRegistrationError(Exception):
    """Registration cannot proceed. The message is shown to the user verbatim."""


def normalise_base_url(raw: str) -> tuple[str, str, int]:
    """Return (base_url, host, port) with host-local addresses made container-reachable."""
    value = (raw or "").strip().rstrip("/")
    if not value:
        raise UrlRegistrationError("Enter the server's base URL, e.g. http://localhost:8010")
    if "://" not in value:
        value = f"http://{value}"

    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https"):
        raise UrlRegistrationError(f"Unsupported scheme '{parsed.scheme}'. Use http or https.")
    if not parsed.hostname:
        raise UrlRegistrationError(f"Could not read a host from '{raw}'.")
    if not parsed.port:
        raise UrlRegistrationError(
            "Include the port, e.g. http://localhost:8010 — we cannot guess it."
        )

    host = parsed.hostname
    if host in _HOST_ALIASES:
        # Keep the user's URL for display but talk to the host gateway.
        host = _DOCKER_HOST_ALIAS
    return f"{parsed.scheme}://{host}:{parsed.port}", host, parsed.port


def probe_model(base_url: str, timeout: int = 10) -> str:
    """Confirm this is an OpenAI-compatible server and return the model id it serves."""
    url = f"{base_url}/v1/models"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise UrlRegistrationError(
            f"{url} returned HTTP {e.code}. If the server needs an API key, that is not "
            "supported here yet."
        ) from e
    except Exception as e:  # noqa: BLE001 - any transport failure means unreachable
        raise UrlRegistrationError(
            f"Could not reach {url}: {e}. Check the server is running and the port is right."
        ) from e

    data = payload.get("data") or []
    if not data:
        raise UrlRegistrationError(
            f"{url} answered but listed no models, so it does not look like a model server."
        )
    served = data[0].get("id")
    if not served:
        raise UrlRegistrationError(f"{url} listed a model with no id.")
    return served


def build_url_model_impl(
    model_name: str,
    hf_model_id: str,
    port: int,
    model_type: ModelTypes = ModelTypes.CHAT,
) -> ModelImpl:
    """A ModelImpl for a URL-served model.

    Identity normally comes from the catalog; there is none here, so synthesise one. The
    image fields are placeholders -- nothing pulls or runs an image for this deployment.
    """
    service_route = (
        "/v1/chat/completions" if model_type == ModelTypes.CHAT else "/v1/completions"
    )
    return ModelImpl(
        model_name=model_name,
        hf_model_id=hf_model_id,
        image_name="external-url",
        image_tag="none",
        # CPU stands in for "we don't allocate hardware for this": whoever started the
        # server already owns whatever chips it uses.
        device_configurations={DeviceConfigurations.CPU},
        docker_config=base_docker_config(),
        service_route=service_route,
        health_route="/health",
        setup_type=SetupTypes.NO_SETUP,
        model_type=model_type,
        service_port=port,
        impl_id="external-url",
        display_model_type="LLM",
        inference_engine="forge",
    )


def register_url_deployment(
    raw_base_url: str, model_type: str = "chat", model_name: Optional[str] = None
) -> dict:
    """Probe a URL and persist/refresh a deployment record for it.

    Shared by RegisterUrlModelView (a human already has a URL to register) and Forge
    Loader's post-launch poller (waiting for a freshly spawned bare-metal server to start
    answering). Raises UrlRegistrationError -- including "not up yet" -- so a caller that
    is polling can just retry on that exception.
    """
    from docker_control.models import ModelDeployment

    base_url, host, port = normalise_base_url(raw_base_url)
    served_model = probe_model(base_url)
    display_name = (model_name or served_model).strip()

    existing = [
        d
        for d in ModelDeployment.objects.filter(status__in=["starting", "running"])
        if getattr(d, "base_url", None) == base_url
    ]
    deploy_id = f"{URL_DEPLOYMENT_PREFIX}{host}-{port}"
    if existing:
        dep = existing[0]
        dep.model_name = display_name
        dep.hf_model_id = served_model
        dep.model_type = model_type
        dep.base_url = base_url
        dep.port = port
        dep.status = "running"
        dep.stopped_by_user = False
        dep.save()
    else:
        dep = ModelDeployment.objects.create(
            container_id=deploy_id,
            container_name=display_name,
            model_name=display_name,
            hf_model_id=served_model,
            model_type=model_type,
            base_url=base_url,
            port=port,
            device="bare-metal",
            status="running",
            device_ids=[],
        )

    # Deferred import: docker_utils.get_canonical_deployments() imports this module back,
    # so importing it at module load time here would be circular.
    from docker_control.docker_utils import update_deploy_cache

    update_deploy_cache()

    return {
        "deploy_id": dep.container_id,
        "model_name": display_name,
        "served_model": served_model,
        "base_url": base_url,
        "model_type": model_type,
    }


def canonical_entry_for(dep) -> dict:
    """Build the deploy-cache entry for a URL-backed ModelDeployment record.

    Mirrors the shape get_canonical_deployments() produces for containers, so everything
    downstream (chat UI model list, InferenceView, health checks) works unchanged.
    internal_url/health_url carry no scheme because callers prepend "http://".
    """
    base = (dep.base_url or "").rstrip("/")
    authority = base.split("://", 1)[-1]
    try:
        model_type = ModelTypes(dep.model_type) if dep.model_type else ModelTypes.CHAT
    except ValueError:
        model_type = ModelTypes.CHAT

    impl = build_url_model_impl(
        model_name=dep.model_name or dep.hf_model_id or "external-model",
        hf_model_id=dep.hf_model_id or dep.model_name or "",
        port=dep.port or 0,
        model_type=model_type,
    )
    return {
        "name": dep.container_name or dep.model_name,
        "status": "running",
        "health": {},
        "image_name": "external-url",
        "port_bindings": {},
        "networks": {},
        "device_id": dep.device_id,
        "device_ids": dep.device_ids,
        "model_id": impl.model_id,
        "weights_id": None,
        "model_impl": impl,
        "internal_url": f"{authority}{impl.service_route}",
        "health_url": f"{authority}{impl.health_route}",
        "cached_model_name": dep.hf_model_id or dep.model_name,
        "model_type": model_type.value,
        "deployed_at": dep.deployed_at.isoformat() if dep.deployed_at else None,
        "stopped_by_user": bool(getattr(dep, "stopped_by_user", False)),
        "deployment_id": dep.id,
        "deployment_model_name": dep.model_name,
        "tool_calling_enabled": getattr(dep, "tool_calling_enabled", False),
        "jwt_secret": getattr(dep, "jwt_secret", None),
        "is_pending": False,
        # "managed" so update_deploy_cache() keeps it: that filter distinguishes real
        # deployments from stale cache keys, and this is a real deployment.
        "source": "managed",
        "is_url_deployment": True,
        "base_url": base,
    }
