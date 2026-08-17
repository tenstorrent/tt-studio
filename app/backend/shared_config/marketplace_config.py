# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Registry of marketplace apps — the SSOT for what the Apps page can offer.

Two kinds of app:
  * CONTAINER — TT-Studio launches it and wires it to the LiteLLM gateway.
  * GUIDE     — installed by the user; TT-Studio only shows connection setup.

Adding an app should be a data change here, not new view code.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional, Tuple

# Container names are prefixed so marketplace apps are easy to spot in
# `docker ps` and can never be confused with model containers.
CONTAINER_NAME_PREFIX = "tt_studio_app_"

# Host ports for marketplace apps. Deliberately disjoint from the 8003-8102
# block that model containers use (docker_utils.get_host_port).
APP_PORT_RANGE = range(3080, 3100)

# Host ports the TT-Studio services themselves bind: frontend, LiteLLM gateway,
# backend, inference-api, docker-control-service, agent, ChromaDB.
RESERVED_HOST_PORTS = frozenset({3000, 4000, 8000, 8001, 8002, 8080, 8111})


class AppKind(str, Enum):
    CONTAINER = "container"
    GUIDE = "guide"


class Upstream(str, Enum):
    """Which OpenAI-compatible endpoint an app is pointed at.

    GATEWAY is the LiteLLM proxy — one key, both the OpenAI and Anthropic
    surfaces — and is what the setup guides hand to users.

    BACKEND is TT-Studio's own OpenAI surface, the same upstream the gateway
    proxies to. Apps that build their model picker from `GET /v1/models` need
    this one: the gateway routes chat through a single wildcard entry and cannot
    enumerate it (LiteLLM only expands a concrete model_list, which needs a DB
    the static config deliberately doesn't have), so it would advertise a lone
    literal "*" and the app would have nothing real to select. Note that this is
    only viable for apps that utilize the OpenAI format, not Anthropic or other formats.
    """
    GATEWAY = "gateway"
    BACKEND = "backend"


@dataclass(frozen=True)
class MarketplaceApp:
    """One marketplace entry. Container fields are unused for GUIDE apps."""

    id: str
    name: str
    tagline: str
    category: str
    kind: AppKind
    docs_url: str
    image: Optional[str] = None
    container_port: Optional[int] = None
    default_host_port: Optional[int] = None
    # Named Docker volume -> container path. Named volumes survive stop/remove, so app data outlives the container.
    volumes: Dict[str, str] = field(default_factory=dict)
    env: Dict[str, str] = field(default_factory=dict)
    # Env vars wired to the model endpoint at launch. Values are templates rendered with {base_url}, {api_key}, {model} and {context_window}.
    gateway_env: Dict[str, str] = field(default_factory=dict)
    upstream: Upstream = Upstream.GATEWAY
    # True for apps that must be given one concrete model name up front rather than choosing from a list, so launching without a deployed model is refused.
    requires_model: bool = False
    # True for apps that store model credentials internally and cannot be wired by env vars. The API then reports the endpoint to paste into their own UI.
    needs_manual_connection: bool = False
    # Capabilities to add to the container at launch.
    cap_add: Tuple[str, ...] = ()
    # Polled from the backend after start; the app is only reported as running once this returns a non-server-error response.
    health_path: str = "/"
    # How long to wait for the app to start before reporting it as failed.
    ready_timeout_s: int = 180
    # Path appended to the app URL when the user clicks "Open".
    open_path: str = "/"
    # Shown after a successful launch — e.g. apps with their own signup step. Only shown if the app is a container.
    first_run_note: Optional[str] = None

    @property
    def container_name(self) -> str:
        return f"{CONTAINER_NAME_PREFIX}{self.id}"


MARKETPLACE_APPS: Tuple[MarketplaceApp, ...] = (
    MarketplaceApp(
        id="open-webui",
        name="Open WebUI",
        tagline="Full-featured chat interface with conversation history and RAG.",
        category="Chat",
        kind=AppKind.CONTAINER,
        docs_url="https://docs.openwebui.com/",
        image="ghcr.io/open-webui/open-webui:main",
        container_port=8080,
        default_host_port=3080,
        volumes={"tt_studio_open_webui_data": "/app/backend/data"},
        env={
            # Open WebUI probes for a local Ollama daemon unless told not to.
            "ENABLE_OLLAMA_API": "false",
            # Don't persist config to volume in case the upstream changes.
            "ENABLE_PERSISTENT_CONFIG": "false",
        },
        gateway_env={
            "OPENAI_API_BASE_URL": "{base_url}",
            "OPENAI_API_KEY": "{api_key}",
        },
        # Open WebUI's model picker is built from GET /v1/models.
        upstream=Upstream.BACKEND,
        health_path="/health",
        first_run_note=(
            "Open WebUI asks you to create an account on first visit — it is stored "
            "locally in the app's volume, not sent anywhere."
        ),
    ),
    MarketplaceApp(
        id="anythingllm",
        name="AnythingLLM",
        tagline="Chat over your own documents with built-in RAG workspaces.",
        category="Chat",
        kind=AppKind.CONTAINER,
        docs_url="https://docs.anythingllm.com/",
        image="mintplexlabs/anythingllm:latest",
        container_port=3001,
        default_host_port=3081,
        volumes={"tt_studio_anythingllm_data": "/app/server/storage"},
        env={
            "STORAGE_DIR": "/app/server/storage",
            # Local embeddings and vector store: no third-party service needed.
            "EMBEDDING_ENGINE": "native",
            "VECTOR_DB": "lancedb",
        },
        # AnythingLLM is configured for one model up front rather than a picker.
        gateway_env={
            "LLM_PROVIDER": "generic-openai",
            "GENERIC_OPEN_AI_BASE_PATH": "{base_url}",
            "GENERIC_OPEN_AI_API_KEY": "{api_key}",
            "GENERIC_OPEN_AI_MODEL_PREF": "{model}",
            "GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT": "{context_window}",
        },
        requires_model=True,
        # Required by AnythingLLM's document collector.
        cap_add=("SYS_ADMIN",),
        health_path="/api/ping",
        first_run_note=(
            "AnythingLLM walks you through creating an account and a workspace on "
            "first visit. Its model is already set to your deployed model."
        ),
    ),
    MarketplaceApp(
        id="opencode",
        name="OpenCode",
        tagline="Open-source terminal coding agent.",
        category="Code",
        kind=AppKind.GUIDE,
        docs_url="https://opencode.ai/docs/",
    ),
    MarketplaceApp(
        id="claude-code",
        name="Claude Code",
        tagline="Anthropic's terminal coding agent, pointed at your own models.",
        category="Code",
        kind=AppKind.GUIDE,
        docs_url="https://docs.claude.com/en/docs/claude-code/overview",
    ),
    MarketplaceApp(
        id="pi",
        name="Pi",
        tagline="Terminal coding agent with pluggable model providers.",
        category="Code",
        kind=AppKind.GUIDE,
        docs_url="https://pi.dev/docs/latest/",
    ),
    MarketplaceApp(
        id="aider",
        name="Aider",
        tagline="Terminal pair programmer that edits and commits for you.",
        category="Code",
        kind=AppKind.GUIDE,
        docs_url="https://aider.chat/docs/",
    ),
    MarketplaceApp(
        id="continue",
        name="Continue",
        tagline="Open-source chat, edit and autocomplete inside VS Code and JetBrains.",
        category="Code",
        kind=AppKind.GUIDE,
        docs_url="https://docs.continue.dev/",
    ),
    MarketplaceApp(
        id="cline",
        name="Cline",
        tagline="Autonomous coding agent for VS Code that plans, edits and runs commands.",
        category="Code",
        kind=AppKind.GUIDE,
        docs_url="https://docs.cline.bot/",
    ),
    MarketplaceApp(
        id="dify",
        name="Dify",
        tagline="Build and host LLM apps, agents and RAG pipelines visually.",
        category="Automation",
        kind=AppKind.GUIDE,
        # Dify ships as a ~13-service Docker Compose stack (api, worker, web,
        # postgres, redis, weaviate, sandbox, plugin daemon, nginx, …) with a
        # shared .env, so it is set up from its own compose file rather than
        # launched as a single container here.
        docs_url="https://docs.dify.ai/en/getting-started/install-self-hosted/docker-compose",
    ),
    MarketplaceApp(
        id="openclaw",
        name="OpenClaw",
        tagline="Open-source automation agent with a configurable model provider.",
        category="Automation",
        kind=AppKind.GUIDE,
        docs_url="https://openclaw.ai/docs/",
    ),
    MarketplaceApp(
        id="vane",
        name="Vane",
        tagline="AI search and research over the live web, formerly Perplexica.",
        category="Search",
        kind=AppKind.CONTAINER,
        docs_url="https://github.com/ItzCrazyKns/Vane",
        # The default tag bundles its own SearxNG, so no companion container.
        image="itzcrazykns1337/vane:latest",
        container_port=3000,
        default_host_port=3082,
        volumes={"tt_studio_vane_data": "/home/vane/data"},
        # Point it at the SearxNG the image starts alongside the app.
        env={"SEARXNG_API_URL": "http://localhost:8080"},
        # Vane builds a model provider from these on boot (src/lib/config).
        gateway_env={
            "OPENAI_BASE_URL": "{base_url}",
            "OPENAI_API_KEY": "{api_key}",
        },
       
        requires_model=True,
        # Starting SearxNG before the app makes first boot slower than most.
        ready_timeout_s=300,
        first_run_note=(
            "Your deployed models are already registered as Vane's OpenAI provider. "
            "Embeddings come from its built-in Transformers provider; both can be "
            "changed under Settings → Providers."
        ),
    ),
)

APPS_BY_ID: Dict[str, MarketplaceApp] = {app.id: app for app in MARKETPLACE_APPS}


def get_app(app_id: str) -> Optional[MarketplaceApp]:
    return APPS_BY_ID.get(app_id)


def split_image_ref(image: str) -> Tuple[str, str]:
    """Split "repo/name:tag" into (name, tag), defaulting the tag to "latest".

    Only splits on a tag separator, never on a registry port (e.g. "host:5000/x").
    """
    name, sep, tag = image.rpartition(":")
    if not sep or "/" in tag:
        return image, "latest"
    return name, tag
