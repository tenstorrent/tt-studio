# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Launch and state-tracking helpers for the app marketplace.

Companion apps run as containers on `tt_studio_network` and reach the model
gateway by container hostname, so no host-gateway hop is needed. Launching is
asynchronous — image pulls take minutes — so `start_launch` returns immediately
and the state of the job it started is reported by `serialize_app`.

Launch state is deliberately not held in process memory: production serves the
backend with several uvicorn workers, so the worker answering a poll is rarely
the one running the launch. Everything the UI reports is therefore derived from
state every worker can see — Docker itself, plus a small locked job file shared
by the workers of one backend container.

The views for these helpers live in `views.py` (MarketplaceAppsView and friends);
the app catalog itself is in `shared_config.marketplace_config`.
"""

import fcntl
import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

import requests

from docker_control.docker_control_client import (
    ContainerNotFound,
    get_docker_client,
    http_status_of,
)
from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger
from shared_config.marketplace_config import (
    APP_PORT_RANGE,
    RESERVED_HOST_PORTS,
    AppKind,
    MarketplaceApp,
    Upstream,
    split_image_ref,
)

logger = get_logger(__name__)

LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
LITELLM_UPSTREAM_KEY = os.environ.get("LITELLM_UPSTREAM_KEY", "")
LITELLM_INTERNAL_URL = os.environ.get(
    "LITELLM_INTERNAL_URL", "http://tt-studio-litellm:4000"
)
# TT-Studio's own OpenAI-compatible surface, reachable from apps on tt_studio_network.
BACKEND_OPENAI_URL = os.environ.get(
    "BACKEND_OPENAI_URL", "http://tt-studio-backend-api:8000/models/openai/v1"
)
READY_POLL_INTERVAL_S = 2
PULL_POLL_INTERVAL_S = 2

# Job states where a launch is still working. Anything else is terminal and holds
# no resources: an "error" job is kept only so the UI can explain the failure.
ACTIVE_JOB_STATES = ("pulling", "starting")

# Launch jobs, keyed by app id — at most one entry per app, never one per
# launch. Covers the pull/start/readiness window; afterwards Docker is the
# source of truth. Shared by every uvicorn worker of this backend container.
_JOBS_PATH = Path(backend_config.backend_cache_root) / "marketplace_jobs.json"
# Each launch stage refreshes its job every couple of seconds, so a job that has
# gone quiet for this long belongs to a worker that died or a backend that
# restarted mid-launch. Treating it as finished lets the UI recover on its own.
JOB_STALE_AFTER_S = 60


# --- Job tracking -----------------------------------------------------------


@contextmanager
def _job_table() -> Iterator[Dict[str, dict]]:
    """The shared job table, exclusively locked and written back on exit.

    A file is what all workers of the backend container have in common, and the
    flock keeps concurrent read-modify-write safe across both processes and
    threads. An unreadable table is rebuilt rather than raised: losing progress
    reporting is recoverable, refusing to launch anything is not.
    """
    _JOBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_JOBS_PATH, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            handle.seek(0)
            contents = handle.read()
            try:
                jobs = json.loads(contents) if contents.strip() else {}
            except json.JSONDecodeError:
                logger.warning("marketplace: job table unreadable, starting fresh")
                jobs = {}
            yield jobs
            handle.seek(0)
            handle.truncate()
            json.dump(jobs, handle)
            # Flush before unlocking: the buffer would otherwise be written when
            # the file closes, by which point another worker holds the lock and
            # has already read the previous contents.
            handle.flush()
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _set_job(app_id: str, state: str, message: str, **extra) -> None:
    with _job_table() as jobs:
        previous = jobs.get(app_id) or {}
        job = {"state": state, "message": message, "updated_at": time.time(), **extra}
        # The claimed port outlives the individual stages of a launch.
        if "host_port" not in job and previous.get("host_port"):
            job["host_port"] = previous["host_port"]
        jobs[app_id] = job


def get_job(app_id: str) -> Optional[dict]:
    """The launch job recorded for an app by any worker, if there is one."""
    with _job_table() as jobs:
        job = jobs.get(app_id)
        return dict(job) if job else None


def clear_job(app_id: str) -> None:
    with _job_table() as jobs:
        jobs.pop(app_id, None)


def is_job_active(job: Optional[dict]) -> bool:
    """Whether a launch is still in progress, as opposed to finished or failed."""
    if not job or job.get("state") not in ACTIVE_JOB_STATES:
        return False
    return time.time() - (job.get("updated_at") or 0) <= JOB_STALE_AFTER_S


# --- Containers and ports ---------------------------------------------------


def list_containers() -> List[dict]:
    """All containers (including stopped), or [] if Docker is unreachable."""
    try:
        response = get_docker_client().list_containers(all=True)
    except Exception as e:
        logger.warning(f"marketplace: could not list containers: {e}")
        return []
    return response.get("containers", []) if isinstance(response, dict) else []


def find_container(containers: List[dict], app: MarketplaceApp) -> Optional[dict]:
    return next((c for c in containers if c.get("name") == app.container_name), None)


def is_running(container: Optional[dict]) -> bool:
    return bool(container) and container.get("status") == "running"


def _port_bindings(container: dict) -> dict:
    return container.get("HostConfig", {}).get("PortBindings") or {}


def published_host_port(container: dict, container_port: int) -> Optional[int]:
    bindings = _port_bindings(container).get(f"{container_port}/tcp") or []
    for binding in bindings:
        host_port = binding.get("HostPort")
        if host_port:
            return int(host_port)
    return None


def _used_host_ports(containers: List[dict]) -> set:
    """Host ports currently bound. Stopped containers hold nothing, so they are
    skipped — otherwise an old exited container would reserve a free port."""
    used = set()
    for container in containers:
        if not is_running(container):
            continue
        for bindings in _port_bindings(container).values():
            for binding in bindings or []:
                host_port = binding.get("HostPort")
                if host_port and host_port.isdigit():
                    used.add(int(host_port))
    return used


def _ports_claimed_by_jobs(jobs: Dict[str, dict]) -> set:
    """Ports promised to launches that haven't bound them yet.

    Only active launches hold a port. A failed job keeps its host_port for
    reporting, but counting it would withhold that port from the block for good
    and push the app off its own default port when retried.
    """
    return {
        job["host_port"]
        for job in jobs.values()
        if job.get("host_port") and is_job_active(job)
    }


def _allocate_host_port(
    app: MarketplaceApp, containers: List[dict], jobs: Dict[str, dict]
) -> Optional[int]:
    """Pick the app's default host port, or the next free one in the app block."""
    taken = (
        _used_host_ports(containers) | set(RESERVED_HOST_PORTS)
    ) | _ports_claimed_by_jobs(jobs)
    if app.default_host_port and app.default_host_port not in taken:
        return app.default_host_port
    for port in APP_PORT_RANGE:
        if port not in taken:
            return port
    logger.warning(
        f"marketplace: no free host port in {APP_PORT_RANGE.start}-{APP_PORT_RANGE.stop - 1}"
    )
    return None


def claim_host_port(app: MarketplaceApp, containers: List[dict]) -> Optional[int]:
    """Reserve a host port for an imminent launch, or None if the block is full.

    Allocating and recording the claim happen inside one hold of the job table,
    so two launches — in this worker or another — cannot pick the same port.
    """
    with _job_table() as jobs:
        host_port = _allocate_host_port(app, containers, jobs)
        if host_port is None:
            return None
        jobs[app.id] = {
            "state": "starting",
            "message": f"Preparing {app.name}…",
            "updated_at": time.time(),
            "host_port": host_port,
        }
        return host_port


# --- Model endpoint wiring --------------------------------------------------


def gateway_configured() -> bool:
    return bool(LITELLM_MASTER_KEY)


def upstream_key(app: MarketplaceApp) -> str:
    """The API key the app authenticates to its upstream with."""
    return (
        LITELLM_UPSTREAM_KEY if app.upstream is Upstream.BACKEND else LITELLM_MASTER_KEY
    )


def upstream_key_name(app: MarketplaceApp) -> str:
    """The env var upstream_key comes from, for error messages worth acting on."""
    return (
        "LITELLM_UPSTREAM_KEY"
        if app.upstream is Upstream.BACKEND
        else "LITELLM_MASTER_KEY"
    )


def upstream_base_url(app: MarketplaceApp) -> str:
    """The OpenAI-compatible base URL the app reaches over tt_studio_network."""
    return (
        BACKEND_OPENAI_URL
        if app.upstream is Upstream.BACKEND
        else f"{LITELLM_INTERNAL_URL.rstrip('/')}/v1"
    )


def deployed_model_names() -> List[str]:
    """Every model name the gateway exposes, including -thinking variants.

    Imported lazily because model_control.views imports this module.
    """
    from shared_config.coding_agent_config import get_gateway_model_names
    from model_control.views import _running_coding_agent_deploys

    names: List[str] = []
    for _, entry in _running_coding_agent_deploys():
        model_name = getattr(entry.get("model_impl"), "model_name", None)
        if not model_name:
            continue
        names.extend(n for n in get_gateway_model_names(model_name) if n not in names)
    return names


def default_model() -> Optional[Tuple[str, int]]:
    """First eligible deployed model as (name, context_window), or None.

    For apps configured with one fixed model instead of a picker. Reuses the
    coding-agent eligibility rules so apps and agents agree on what's usable.
    Imported lazily because model_control.views imports this module.
    """
    from model_control.model_utils import get_max_tokens_limit
    from model_control.views import _running_coding_agent_deploys

    for _, entry in _running_coding_agent_deploys():
        impl = entry.get("model_impl")
        name = getattr(impl, "model_name", None)
        if not name:
            continue
        context_window = entry.get("max_model_len") or get_max_tokens_limit(
            getattr(impl, "param_count", None)
        )
        return name, context_window
    return None


def _model_env(app: MarketplaceApp) -> Dict[str, str]:
    """Render the app's model-endpoint env vars for the upstream it declares."""
    model, context_window = default_model() or ("", 0)
    return {
        key: template.format(
            base_url=upstream_base_url(app),
            api_key=upstream_key(app),
            model=model,
            context_window=context_window,
        )
        for key, template in app.gateway_env.items()
    }


# --- Serialization ----------------------------------------------------------


def launch_blocked_reason(app: MarketplaceApp) -> Optional[str]:
    """Why `app` cannot be launched right now, in plain language, or None if it can.

    Read by the catalog endpoint, so the Apps page can disable Launch and say why
    up front, and enforced by the launch endpoint. Sharing one source keeps the
    card's explanation and the refusal from ever disagreeing.
    """
    if not upstream_key(app):
        return (
            f"{upstream_key_name(app)} is not set in your .env, so {app.name} "
            "cannot be wired to your models. Set it and restart TT-Studio."
        )
    # Short-circuits before default_model(), so only the apps that pin one model
    # pay for the deploy scan.
    if app.requires_model and default_model() is None:
        return (
            f"{app.name} needs a chat model to connect to, and none is deployed "
            f"yet. Deploy one from the Home page, then launch {app.name}."
        )
    return None


def serialize_app(app: MarketplaceApp, containers: List[dict]) -> dict:
    """Catalog entry plus current state, from Docker and any in-flight job."""
    payload = {
        "id": app.id,
        "name": app.name,
        "tagline": app.tagline,
        "category": app.category,
        "kind": app.kind.value,
        "docs_url": app.docs_url,
        "first_run_note": app.first_run_note,
    }

    # Apps configured through their own UI need the endpoint as reachable from
    # inside the container, which is not the host URL the browser uses.
    if app.needs_manual_connection:
        payload["connection"] = {
            "base_url": upstream_base_url(app),
            "api_key": upstream_key(app),
            "model": (default_model() or ("", 0))[0],
        }

    if app.kind is not AppKind.CONTAINER:
        payload["status"] = "guide"
        return payload

    payload["blocked_reason"] = launch_blocked_reason(app)

    container = find_container(containers, app)
    job = get_job(app.id)

    # An in-flight launch outranks the container's own state: a container can be
    # up while the app inside it is still booting, and "Open" must not appear
    # until it serves. A finished or abandoned job never outranks Docker, so a
    # stale entry cannot pin a card that is really running.
    if is_job_active(job):
        payload.update(status=job["state"], message=job["message"])
        if "progress" in job:
            payload["progress"] = job["progress"]
    elif is_running(container):
        payload.update(
            status="running",
            container_id=container.get("id"),
            host_port=published_host_port(container, app.container_port),
            open_path=app.open_path,
        )
    elif job and job.get("state") == "error":
        # Kept after the launch failed so the card can explain why.
        payload.update(status="error", message=job["message"])
    elif container:
        # Exited or created but not running — e.g. the daemon was restarted.
        payload.update(status="stopped", container_id=container.get("id"))
    else:
        payload["status"] = "not_installed"

    return payload


# --- Post-launch configuration ----------------------------------------------
#
# Some apps can only be finished off through their own HTTP API — env vars get
# their credentials in, but not the list of models to offer. Hooks run once the
# app is serving and are keyed by app id; a failure is logged and leaves the app
# running, since everything they do can also be done by hand in the app's UI.


def _app_url(app: MarketplaceApp) -> str:
    """The app's own base URL as reached from the backend over the bridge."""
    return f"http://{app.container_name}:{app.container_port}"


# Display name Vane gives the provider it builds from OPENAI_BASE_URL /
# OPENAI_API_KEY. Its GET /api/providers omits the provider type, so the name is
# the only identifier available for finding it again.
VANE_PROVIDER_NAME = "OpenAI"


def _configure_vane(app: MarketplaceApp) -> None:
    """Register deployed models on the provider Vane built from our env vars.

    Vane only auto-lists models when the base URL is api.openai.com, so each
    model has to be added explicitly, with the gateway model name as both its
    key and its display name. The sk- credential is not part of a model entry —
    it reaches Vane through OPENAI_API_KEY.
    """
    base = _app_url(app)
    providers = (
        requests.get(f"{base}/api/providers", timeout=10).json().get("providers") or []
    )
    provider = next(
        (p for p in providers if p.get("name") == VANE_PROVIDER_NAME), None
    )
    if provider is None:
        logger.warning(
            f"marketplace: {app.id} has no '{VANE_PROVIDER_NAME}' provider to configure"
        )
        return

    known = {model.get("key") for model in provider.get("chatModels") or []}
    added = 0
    for name in deployed_model_names():
        if name in known:
            continue
        response = requests.post(
            f"{base}/api/providers/{provider['id']}/models",
            json={"type": "chat", "key": name, "name": name},
            timeout=10,
        )
        response.raise_for_status()
        added += 1

    if added or known:
        # Skip the setup wizard now that the provider has usable models.
        requests.post(f"{base}/api/config/setup-complete", timeout=10)
    logger.info(f"marketplace: registered {added} model(s) with {app.id}")


POST_READY_HOOKS = {"vane": _configure_vane}


def _run_post_ready_hook(app: MarketplaceApp) -> None:
    hook = POST_READY_HOOKS.get(app.id)
    if hook is None:
        return
    _set_job(app.id, "starting", f"Configuring {app.name}…")
    try:
        hook(app)
    except Exception as e:
        # The app works; it just needs its models picked manually.
        logger.warning(f"marketplace: could not configure {app.id}: {e}. Please configure the app manually.")


# --- Launching and stopping -------------------------------------------------


def _container_state(client, name: str) -> Optional[str]:
    """The container's Docker state, or None when no such container exists."""
    try:
        return client.get_container(name).get("status")
    except ContainerNotFound:
        return None


def _adopt_or_clear(client, app: MarketplaceApp) -> bool:
    """True if an already-running container was adopted instead of replaced.

    Two workers can reach this point for the same app, and the one arriving
    second must not tear down the container the first just started — nor one the
    user is already using. Anything not running is a leftover and gets cleared.
    """
    state = _container_state(client, app.container_name)
    if state == "running":
        logger.info(f"marketplace: {app.id} is already running, adopting it")
        return True
    if state is not None:
        remove_container_if_present(client, app.container_name)
    return False


def remove_container_if_present(client, name: str) -> None:
    """Remove a container, treating "no such container" as already done.

    Called before every launch so a leftover container of the same name — from a
    crash or a daemon restart — cannot block it.
    """
    try:
        client.remove_container(name, force=True)
    except requests.exceptions.HTTPError as e:
        if http_status_of(e) != 404:
            raise


def start_launch(app: MarketplaceApp, host_port: int) -> None:
    """Pull and start an app in the background. Poll get_job / serialize_app."""
    threading.Thread(
        target=_launch, args=(app, host_port), daemon=True, name=f"launch-{app.id}"
    ).start()


def stop_app(app: MarketplaceApp) -> None:
    """Stop and remove an app's container, keeping its named volume and data."""
    client = get_docker_client()
    client.stop_container(app.container_name)
    remove_container_if_present(client, app.container_name)
    clear_job(app.id)


def _launch(app: MarketplaceApp, host_port: int) -> None:
    """Pull the image if needed, then run the container. Runs in a worker thread."""
    client = get_docker_client()
    image_name, image_tag = split_image_ref(app.image)

    try:
        if not client.image_exists(image_name, image_tag):
            pull_id = f"marketplace-{app.id}"
            _set_job(app.id, "pulling", f"Pulling {app.image}…")
            client.start_image_pull(image_name, image_tag, pull_id)
            if not _await_pull(app.id, pull_id, client):
                return

        _set_job(app.id, "starting", f"Starting {app.name}…")
        adopted = _adopt_or_clear(client, app)
    except Exception as e:
        logger.error(f"marketplace: {app.id} preparation failed: {e}")
        _set_job(app.id, "error", f"Could not prepare {app.name}: {e}")
        return

    try:
        if adopted:
            logger.info(f"marketplace: {app.id} was already started elsewhere")
        else:
            client.run_container(
                image=app.image,
                name=app.container_name,
                hostname=app.container_name,
                ports={f"{app.container_port}/tcp": host_port},
                environment={**app.env, **_model_env(app)},
                volumes=dict(app.volumes),
                network=backend_config.docker_bridge_network_name,
                cap_add=list(app.cap_add),
            )
            logger.info(f"marketplace: launched {app.id} on host port {host_port}")
    except Exception as e:
        logger.error(f"marketplace: {app.id} failed to start: {e}")
        _set_job(app.id, "error", f"Could not start {app.name}: {e}")
        return

    if not _await_ready(app):
        return
    _run_post_ready_hook(app)
    # Clearing the job is what flips the app to "running" for the UI, so it
    # happens only once the app both serves and has been configured.
    clear_job(app.id)


def _await_pull(app_id: str, pull_id: str, client) -> bool:
    """Poll pull progress until it finishes. True if the image was pulled."""
    while True:
        progress = client.get_image_pull_progress(pull_id)
        if progress is None:
            _set_job(app_id, "error", "Lost contact with the image pull.")
            return False
        if progress.get("status") == "error":
            _set_job(app_id, "error", progress.get("error") or "Image pull failed.")
            return False
        if progress.get("status") == "success":
            return True
        _set_job(
            app_id,
            "pulling",
            progress.get("message") or "Pulling image…",
            progress={
                "downloaded_bytes": progress.get("downloaded_bytes", 0),
                "total_bytes": progress.get("total_bytes", 0),
            },
        )
        threading.Event().wait(PULL_POLL_INTERVAL_S)


def _await_ready(app: MarketplaceApp) -> bool:
    """Hold the app in "starting" until it answers on its health path.

    Both the backend and the app are on tt_studio_network, so it is polled by
    container hostname rather than through the published host port. False means
    the app never answered and the job has been marked as failed.
    """
    url = f"{_app_url(app)}{app.health_path}"
    _set_job(app.id, "starting", f"Waiting for {app.name} to be ready…")
    deadline = time.monotonic() + app.ready_timeout_s

    while time.monotonic() < deadline:
        try:
            # Any non-5xx answer means the app is serving; a login redirect counts.
            if requests.get(url, timeout=3).status_code < 500:
                logger.info(f"marketplace: {app.id} is ready")
                return True
        except requests.RequestException:
            pass
        threading.Event().wait(READY_POLL_INTERVAL_S)

    logger.warning(f"marketplace: {app.id} did not become ready in time")
    message = f"{app.name} started but did not respond within {app.ready_timeout_s}s."
    # The reason is almost always in the app's own output — a bad mount, a
    # permission error — and the container is often gone by the time anyone
    # looks, so carry the tail of it into the message the card shows.
    excerpt = _log_excerpt(app)
    message += f" Last output: {excerpt}" if excerpt else " Check its container logs."
    _set_job(app.id, "error", message)
    return False


def _log_excerpt(app: MarketplaceApp, lines: int = 4, max_chars: int = 400) -> str:
    """The tail of an app container's log, trimmed to fit in an error message."""
    try:
        recent = [
            line.strip()
            for line in get_docker_client().tail_logs(app.container_name, tail=40)
            if line.strip()
        ]
    except Exception as e:
        logger.warning(f"marketplace: could not read {app.id} logs: {e}")
        return ""
    return " | ".join(recent[-lines:])[:max_chars]
