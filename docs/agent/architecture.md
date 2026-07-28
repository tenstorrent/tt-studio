# Agent Architecture & LLM Discovery

The AI Agent service (`tt_studio_agent`) is a specialized autonomous assistant designed to orchestrate complex tasks by leveraging local Tenstorrent-hosted LLMs. It utilizes a LangChain-based ReAct framework to interact with the system through tools while maintaining a resilient connection to inference containers via a dedicated discovery and health monitoring subsystem.

## Core Agent Architecture

The agent is built as a FastAPI service that wraps a LangChain ReAct agent. It operates on a "poll-and-process" model where it consumes requests from a queue, processes them using the available LLM, and streams responses back to the frontend. The service is containerized and depends on the `tt_studio_backend` for its initial state and network configuration.

### Component Overview
The architecture is divided into three main layers:
1. **API Layer**: FastAPI endpoints (port 8080) that handle incoming chat requests via `/poll_requests` and status checks.
2.  **Agent Logic Layer**: The ReAct executor and `CustomLLM` wrapper which handles the reasoning loop and tool selection.
3.  **Infrastructure Layer**: Discovery services and health monitors that maintain the link to hardware-accelerated LLM containers.

### System Data Flow: From Request to Execution
The following diagram illustrates how a user request flows through the agent service and how it interacts with the underlying LLM infrastructure.

**Agent Inference & Tool Execution Flow**
```mermaid
sequenceDiagram
    participant FE as "ChatComponent [app/frontend/src/components/chatui/ChatComponent.tsx]"
    participant AG as "AgentService [tt_studio_agent/main.py]"
    participant LC as "ReActExecutor [LangChain]"
    participant LLM as "CustomLLM [tt_studio_agent/llm_discovery.py]"
    participant INF as "InferenceContainer [tt-inference-server]"

    FE->>AG: POST /poll_requests (thread_id, text)
    AG->>LC: execute(prompt)
    LC->>LLM: invoke(messages)
    LLM->>INF: POST /v1/chat/completions (OpenAI API)
    INF-->>LLM: Response Stream
    LLM-->>LC: Parsed Thought/Action
    alt Action Required
        LC->>AG: Call Tool (e.g., Tavily, Python)
        AG-->>LC: Tool Output
        LC->>LLM: invoke(context + tool_output)
    end
    LC-->>AG: Final Answer
    AG-->>FE: SSE Stream (tokens)
```

## LLM Discovery & Health Monitoring

The agent service does not have a hardcoded LLM endpoint. Instead, it dynamically discovers available local inference containers using the `LLMDiscoveryService`.

### LLMDiscoveryService
This service scans the Docker network for containers that expose compatible inference APIs. It prioritizes local Tenstorrent-hosted models over cloud fallbacks.

*   **Detection Logic**: It queries the `docker-control-service` or scans the environment for active deployments tracked in the `ModelDeployment` store.
*   **CustomLLM Wrapper**: Implements the LangChain `BaseLLM` interface, allowing the agent to treat local FastAPI inference servers as standard LangChain LLMs.

### LiteLLM Gateway Integration
For external coding assistants (like Cursor or Claude Code) to interact with local Tenstorrent models, a `tt_studio_litellm` gateway is used as a protocol translation layer. It maps OpenAI and Anthropic API surfaces to the TT-Studio backend.

*   **Upstream Routing**: The gateway routes all incoming model requests to the Django backend's OpenAI-compatible endpoint.
* **Master Key Security**: Access is protected via the `LITELLM_MASTER_KEY`.
* **Persistent Configuration**: Uses a `config.yaml` volume mount to define model mappings and proxy settings.

### LLMHealthMonitor
To ensure high availability, the system continuously polls the discovered endpoints.
* **Polling**: It verifies that containers are still in a `service_healthy` state before routing traffic.
* **ChromaDB Health**: The backend ensures the vector store is healthy before initializing RAG-dependent agent tools.
* **Backend Readiness**: The agent service itself waits for the `tt_studio_backend` to pass its healthcheck before starting its polling loop.

| Component | Responsibility | Port |
| :--- | :--- | :--- |
| **Discovery** | Detects local `tt-inference-server` instances via Docker network. | N/A |
| **LiteLLM** | Provides OpenAI surface for external tools. | 4000 |
| **Agent API** | Handles chat requests and tool orchestration. | 8080 |
| **Backend API** | Manages model deployment lifecycle and health state. | 8000 |

## LLM Integration & Natural Language Space

The agent acts as the bridge between the user's natural language intent and the "Code Entity Space" of the TT-Studio system. It uses the `CustomLLM` to translate these intents into structured tool calls.

**Natural Language to Code Entity Mapping**
```mermaid
graph TD
    subgraph "Natural Language Space"
        UserQuery["'Check the status of my Grayskull chip'"]
    end

    subgraph "Agent Logic (tt_studio_agent)"
        Agent["ReAct Agent [tt_studio_agent]"]
        LLMWrap["CustomLLM Wrapper [llm_discovery.py]"]
    end

    subgraph "Code Entity Space (Backend/Infrastructure)"
        Tool1["tt_studio_backend health check [/up/]"]
        Tool2["tt_studio_chroma heartbeat [/api/v1/heartbeat]"]
        DB["ChromaDB [tt_studio_chroma]"]
    end

    UserQuery --> Agent
    Agent --> LLMWrap
    LLMWrap --> Agent
    Agent -- "Action: Call Health API" --> Tool1
    Agent -- "Action: Query Vector DB" --> DB
    Tool1 -- "Checks" --> Tool2
```

## Multi-LLM Fallback Logic

The agent service is designed to be resilient. If the primary high-performance model is not available or the hardware is over-subscribed, it follows a hierarchical fallback strategy:

1. **Local High-Perf**: Attempts to connect to a local container as specified by `LLM_CONTAINER_NAME`.
2. **Cloud Bridge**: If `USE_CLOUD_LLM` is set to `true`, it routes requests to a remote inference cloud (e.g., via `CLOUD_CHAT_UI_URL`).
3. **Circuit Breaker**: The polling mechanism uses `AGENT_LLM_POLLING_CIRCUIT_BREAKER_THRESHOLD` to stop attempts if the LLM is consistently unreachable.

### Implementation Details
* **Endpoint Resolution**: The API URL is determined dynamically at runtime based on the `BACKEND_API_HOSTNAME`.
* **Polling Configuration**: Retry logic is governed by `AGENT_LLM_POLLING_MAX_ATTEMPTS` and `AGENT_LLM_POLLING_TIMEOUT`.

---

:::{admonition} Source files this page was written from
:class: dropdown tt-sources

Captured at commit [`c837b829`](https://github.com/tenstorrent/tt-studio/commit/c837b829), so the linked line numbers match that revision.

- [`README.md`](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md)
- [`app/README.md`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md)
- [`app/docker-compose.yml`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml)
- [`app/frontend/index.html`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/index.html)
:::
