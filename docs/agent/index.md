# AI Agent Service

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md">README.md</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md">app/README.md</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml">app/docker-compose.yml</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/index.html">app/frontend/index.html</a></li>
</ul>
</details>



The `tt_studio_agent` service (operating on port `8080`) is an autonomous AI assistant subsystem within TT-Studio. It provides a high-level reasoning interface that can discover locally deployed LLMs, monitor their health, and execute complex tasks using a suite of integrated tools, including web search and secure code execution. [app/docker-compose.yml:106-116](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L106-L116)

## Overview

The agent service acts as a bridge between natural language user intent and the technical capabilities of the TT-Studio ecosystem. Unlike standard inference routes that provide direct model access, the agent service manages stateful conversations and selects the best available local model to fulfill requests. [app/README.md:15-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L15-L15)

### Key Capabilities
*   **LLM Discovery & Fallback**: Automatically identifies available LLM containers on the `tt_studio_network` and maintains a priority-based fallback list. [app/docker-compose.yml:113-123](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L113-L123)
*   **Health Monitoring**: Continuously polls inference endpoints to ensure the agent only routes traffic to responsive models. [app/docker-compose.yml:125-127](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L125-L127)
*   **Tool Integration**: Extends LLM capabilities with a Tavily-powered web search and an optional E2B code interpreter for executing Python code in isolated environments. [app/docker-compose.yml:119-128](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L119-L128)
*   **Conversation Management**: Uses `thread_id` to maintain context across multiple turns in a chat session.

### Service Interaction Map
The following diagram illustrates how the `tt_studio_agent` interacts with other system components and how it maps natural language requests to code-level execution entities.

**Agent Service Integration Flow**
```mermaid
graph TD
    User["User (Frontend)"] -- "POST /models-api/agent/" --> AgentAPI["tt_studio_agent (FastAPI)"]
    
    subgraph "Agent Internal Logic"
        AgentAPI -- "manages" --> ThreadMgr["Thread Management (thread_id)"]
        AgentAPI -- "invokes" --> ReAct["LangChain ReAct Agent"]
        ReAct -- "checks" --> Discovery["LLMDiscoveryService"]
        ReAct -- "executes" --> Tools["Tool Executor"]
    end

    subgraph "External & Local Services"
        Discovery -- "polls" --> DeployedLLMs["Local LLM Containers (Port 8000)"]
        Tools -- "API Call" --> Tavily["Tavily Search API"]
        Tools -- "Sandbox" --> E2B["E2B Code Interpreter"]
    end

    DeployedLLMs -- "SSE Stream" --> AgentAPI
    AgentAPI -- "SSE Stream" --> User
```
Sources: [app/docker-compose.yml:106-124](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L106-L124), [app/README.md:15-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L15-L15)

---

## [Agent Architecture & LLM Discovery](architecture.md)

The core of the service is built on a **LangChain-based ReAct (Reasoning and Acting) architecture**. It utilizes a `CustomLLM` wrapper to standardize communication with various local inference servers (e.g., vLLM or TGI-based containers).

The **LLMDiscoveryService** is responsible for scanning the Docker environment to find containers that match known LLM signatures. It works in tandem with the **LLMHealthMonitor**, which performs periodic heartbeats. If the primary high-performance model becomes unresponsive, the agent utilizes polling timeouts and circuit breaker thresholds to manage fallbacks. [app/docker-compose.yml:125-127](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L125-L127)

For details, see [Agent Architecture & LLM Discovery](architecture.md).

**Natural Language to Code Entity Mapping: Discovery**
```mermaid
graph LR
    subgraph "Natural Language Space"
        Req["'Use the best available model'"]
    end

    subgraph "Code Entity Space"
        Discovery["LLMDiscoveryService"]
        Monitor["LLMHealthMonitor"]
        Fallback["AGENT_LLM_POLLING_MAX_ATTEMPTS"]
        Circuit["AGENT_LLM_POLLING_CIRCUIT_BREAKER_THRESHOLD"]
        
        Discovery --> Monitor
        Monitor --> Fallback
        Monitor --> Circuit
    end

    Req -.-> Discovery
```
Sources: [app/docker-compose.yml:125-127](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L125-L127)

---

## [Agent API & Tool Integration](api-and-tools.md)

The agent exposes a FastAPI-based REST interface. Authentication is handled via **JWT (JSON Web Tokens)** to ensure secure access to tool execution and backend communication. [app/docker-compose.yml:118-118](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L118-L118)

### Integrated Tools
| Tool Name | Code Reference | Description |
| :--- | :--- | :--- |
| **Tavily Search** | `TAVILY_API_KEY` | Provides real-time web search capabilities to ground agent responses in current data. [app/docker-compose.yml:119-119](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L119-L119) |
| **E2B Interpreter** | `E2B_API_KEY` | An optional tool for executing Python code in a secure sandbox. [app/docker-compose.yml:128-128](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L128-L128) |
| **Cloud Fallback** | `USE_CLOUD_LLM` | Allows the agent to route queries to cloud providers if local resources are unavailable. [app/docker-compose.yml:122-122](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L122-L122) |

The service is configured via environment variables to communicate with the `tt_studio_backend` via `BACKEND_API_HOSTNAME` and manage specific container targets via `LLM_CONTAINER_NAME`. [app/docker-compose.yml:123-124](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L123-L124)

For details, see [Agent API & Tool Integration](api-and-tools.md).

Sources: [app/docker-compose.yml:117-128](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L117-L128), [app/README.md:15-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L15-L15)25:T1d09,# Agent Architecture & LLM Discovery


```{toctree}
:hidden:
:maxdepth: 2

architecture
api-and-tools
```
