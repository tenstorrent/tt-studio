# Getting Started & Setup

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default">.env.default</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md">README.md</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md">app/README.md</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml">app/docker-compose.yml</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/index.html">app/frontend/index.html</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py">run.py</a></li>
</ul>
</details>



This page provides a technical guide for setting up and initializing the TT-Studio environment. It covers prerequisites, the execution flow of the primary setup script, environment configuration, and hardware detection mechanisms.

## Prerequisites

Before deploying TT-Studio, the host system must meet specific hardware and software requirements to ensure compatibility with Tenstorrent AI accelerators and Docker-based service orchestration.

*   **Tenstorrent Software Stack**: Drivers and system configuration must be completed following the [Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html) [README.md:32-33](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L32-L33).
*   **Python 3.8+**: Required for running the orchestration script `run.py` [README.md:29](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L29).
*   **Docker & Docker Compose**: Used for containerizing all subsystems. Users must be added to the `docker` group to allow non-sudo execution: `sudo usermod -aG docker $USER` [README.md:30](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L30).
*   **Hugging Face Token**: Required for downloading gated models such as Llama [README.md:31](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L31).
*   **Node.js**: The `run.py` script manages frontend dependencies (`node_modules`) during the setup process [run.py:9](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L9).

**Sources:** [README.md:25-34](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L25-L34), [run.py:7-12](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L7-L12)

## Setup Orchestration: run.py

The `run.py` script is the unified entry point for TT-Studio. It manages the lifecycle of backend services, environment configuration, and auxiliary services like the `docker-control-service` [run.py:7-12](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L7-L12).

### Execution Modes

| Mode | Command | Description |
| :--- | :--- | :--- |
| **Standard** | `python3 run.py` | Interactive setup that configures `.env`, checks dependencies, and starts containers [README.md:43-46](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L43-L46). |
| **Dev Mode** | `python3 run.py --dev` | Development mode: mounts local source code for the backend and frontend into containers to enable hot-reloading [README.md:50-51](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L50-L51), [run.py:17](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L17). |
| **Cleanup** | `python3 run.py --cleanup` | Stops and removes TT-Studio containers and networks while preserving persistent data [README.md:51-53](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L51-L53), [run.py:18](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L18). |
| **Cleanup All** | `python3 run.py --cleanup-all` | Full wipe: removes containers, networks, the persistent volume, and the `.env` file [README.md:51-53](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L51-L53), [run.py:19](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L19). |

### Startup Data Flow

The following diagram illustrates how `run.py` (Natural Language Space) orchestrates the system components defined in the codebase (Code Entity Space).

**Figure 1: run.py Initialization Logic**
```mermaid
graph TD
    subgraph "Host_Space_run_py"
        ["run.py"] --> ["_setup_environment()"]
        ["_setup_environment()"] --> ["_create_docker_network('tt_studio_network')"]
        ["_create_docker_network('tt_studio_network')"] --> ["start_docker_control_service()"]
        ["start_docker_control_service()"] --> ["_run_docker_compose()"]
    end

    subgraph "Docker_Topology_tt_studio_network"
        ["_run_docker_compose()"] --> ["tt_studio_backend"]
        ["_run_docker_compose()"] --> ["tt_studio_frontend"]
        ["_run_docker_compose()"] --> ["tt_studio_chroma"]
        ["_run_docker_compose()"] --> ["tt_studio_agent"]
        ["_run_docker_compose()"] --> ["tt_studio_litellm"]
    end

    subgraph "Persistence_and_Config"
        ["tt_studio_backend"] --- ["HOST_PERSISTENT_STORAGE_VOLUME"]
        ["tt_studio_chroma"] --- ["HOST_PERSISTENT_STORAGE_VOLUME"]
        ["_setup_environment()"] --- ["ROOT/.env"]
    end
```
**Sources:** [run.py:7-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L7-L25), [run.py:86-87](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L86-L87), [app/docker-compose.yml:19-20](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L19-L20), [app/docker-compose.yml:164-170](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L164-L170), [.env.default:1-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L1-L11)

## Environment Configuration (.env)

TT-Studio uses a single, canonical `.env` file located at the repository root for the whole project. The `run.py` script generates this from `.env.default` if it does not exist [run.py:86-87](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L86-L87), [.env.default:3-5](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L3-L5).

### Key Variables
*   **`TT_STUDIO_ROOT`**: Absolute path to the repository root, used for volume mounting [.env.default:10](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L10).
*   **`TT_INFERENCE_ARTIFACT_VERSION`**: Specifies the version of the `tt-inference-server` artifact to deploy (e.g., `v0.17.0`) [.env.default:23](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L23).
*   **`JWT_SECRET`**: Secret for signing tokens used in service-to-service communication [.env.default:29](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L29).
*   **`VITE_ENABLE_DEPLOYED`**: Boolean flag that toggles between using local Tenstorrent hardware or remote cloud endpoints for inference [.env.default:64](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L64), [app/docker-compose.yml:57](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L57).
*   **`DOCKER_CONTROL_SERVICE_URL`**: Points to the host-side proxy for Docker operations, typically `http://host.docker.internal:8002` [.env.default:40](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L40).
*   **`LITELLM_PORT`**: Host port the LiteLLM gateway is published on, defaulting to 4000 [.env.default:53](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L53), [app/docker-compose.yml:146](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L146).
*   **`WAKEWORD_MODEL`**: Defines the model used for wake word detection (default: `hey_quiet_box`) [.env.default:100](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L100).

**Sources:** [.env.default:1-110](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L1-L110), [app/docker-compose.yml:30-68](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L30-L68)

## Hardware Detection & Container Mounting

TT-Studio detects Tenstorrent hardware by checking for devices in `/dev/tenstorrent`. When hardware is present, `run.py` includes the `docker-compose.tt-hardware.yml` override during the `docker compose up` command [app/README.md:28-30](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L28-L30), [app/README.md:53-61](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L53-L61).

**Figure 2: Hardware Access & Resource Mapping**
```mermaid
graph LR
    subgraph "Host_Resources"
        ["/dev/tenstorrent"]
        ["HOST_PERSISTENT_STORAGE_VOLUME"]
        ["DOCKER_CONTROL_SERVICE_URL_Port_8002"]
    end

    subgraph "tt_studio_backend_Container"
        ["uvicorn_api_asgi_application"]
        ["/dev/tenstorrent_Mapped"]
        ["/tt_studio_persistent_volume"]
    end

    ["/dev/tenstorrent"] -.->|"docker-compose.tt-hardware.yml"| ["/dev/tenstorrent_Mapped"]
    ["HOST_PERSISTENT_STORAGE_VOLUME"] -.->|"volumes"| ["/tt_studio_persistent_volume"]
    ["uvicorn_api_asgi_application"] -->|"DOCKER_CONTROL_SERVICE_URL"| ["DOCKER_CONTROL_SERVICE_URL_Port_8002"]
```
**Sources:** [app/docker-compose.yml:14-17](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L14-L17), [app/docker-compose.yml:23-24](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L23-L24), [app/docker-compose.yml:62-63](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L62-L63), [app/README.md:53-61](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L53-L61)

## AI Playground & Remote Endpoints

For users without local Tenstorrent hardware, TT-Studio supports an "AI Playground" mode by connecting to external model endpoints. This is configured via the `VITE_ENABLE_DEPLOYED` variable and various `CLOUD_*` environment variables in the `.env` file [.env.default:64-96](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L64-L96).

*   **External Chat**: `CLOUD_CHAT_UI_URL` and `CLOUD_CHAT_UI_AUTH_TOKEN` [.env.default:85-86](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L85-L86).
*   **Vision/Media**: Supports external URLs for YOLOv4, Speech Recognition, and Stable Diffusion [.env.default:88-95](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L88-L95).
*   **LiteLLM Gateway**: Acts as a proxy for coding agents, utilizing `LITELLM_MASTER_KEY` and `LITELLM_UPSTREAM_KEY` [.env.default:48-51](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L48-L51).

**Sources:** [.env.default:82-96](https://github.com/tenstorrent/tt-studio/blob/c837b829/.env.default#L82-L96), [README.md:11-12](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L11-L12), [app/docker-compose.yml:138-150](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.yml#L138-L150)

## Cleanup and Reset Commands

To maintain system hygiene or reset the environment, `run.py` provides cleanup options that interface with the Docker daemon and host filesystem.

*   **Standard Cleanup**: `python3 run.py --cleanup`
    *   Stops all containers and removes the `tt_studio_network`.
    *   Preserves the `HOST_PERSISTENT_STORAGE_VOLUME` and `.env` file [run.py:18](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L18).
*   **Full Reset**: `python3 run.py --cleanup-all`
    *   Removes containers, networks, and images.
    *   Wipes the `HOST_PERSISTENT_STORAGE_VOLUME` directory and the `.env` file [README.md:51-53](https://github.com/tenstorrent/tt-studio/blob/c837b829/README.md?plain=1#L51-L53), [run.py:19](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L19).
*   **Manual Cleanup**:
    If using raw docker-compose, you must pass all active overlays to the `down` command to avoid orphaned services:
    ```bash
    docker compose -f app/docker-compose.yml -f app/docker-compose.dev-mode.yml -f app/docker-compose.tt-hardware.yml down
    ```
    [app/README.md:65-76](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L65-L76)

**Sources:** [run.py:18-19](https://github.com/tenstorrent/tt-studio/blob/c837b829/run.py#L18-L19), [app/README.md:65-78](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/README.md?plain=1#L65-L78)19:T1eb4,# Architecture Overview
