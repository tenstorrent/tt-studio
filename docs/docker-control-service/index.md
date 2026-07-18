# Docker Control Service

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py">app/backend/docker_control/docker_control_client.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py">app/backend/docker_control/health_monitor.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.dev-mode.yml">app/docker-compose.dev-mode.yml</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/README.md">docker-control-service/README.md</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py">docker-control-service/api.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py">docker-control-service/config.py</a></li>
</ul>
</details>



The **Docker Control Service** is a standalone FastAPI application that serves as a secure proxy for Docker operations within the TT-Studio ecosystem. It runs on the host machine (typically port `8002`) rather than inside a container, allowing it to interact with the Docker socket (`docker.sock`) directly without exposing that socket to the broader containerized network [docker-control-service/api.py:4-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py#L4-L11).

This service replaces direct Docker SDK usage in the backend with a controlled REST API, enforcing security policies such as image whitelisting, resource limits, and network restrictions [docker-control-service/README.md:5-23](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/README.md?plain=1#L5-L23).

## System Role & Architecture

The service acts as the bridge between the **TT-Studio Backend** (Django) and the host's Docker daemon. By centralizing Docker logic here, TT-Studio avoids the security risks associated with mounting the Docker socket into the web-facing backend container. In development mode, the backend communicates with this service via `host.docker.internal` [app/docker-compose.dev-mode.yml:19-21](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.dev-mode.yml#L19-L21).

### Service Interaction Flow
The following diagram illustrates how the `DockerControlClient` in the backend communicates with the `DockerControlService` to manage model containers.

**Title: Docker Operation Proxy Flow**
```mermaid
graph LR
    subgraph ContainerizedSpace[tt_studio_backend] -- "Uses DockerControlClient" --> [API_Requests]
    end

    subgraph HostSpace_Port_8002[API_Requests] -- "JWT Authenticated" --> [api.py_app]
        [api.py_app] -- "Routes to" --> [routers/containers.py]
        [routers/containers.py] -- "Direct Access" --> [docker.sock]
    end

    [docker.sock] -- "Spawns" --> [Model_Containers]
```
**Sources:** [docker-control-service/api.py:4-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py#L4-L11), [app/backend/docker_control/docker_control_client.py:5-10](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L5-L10), [app/docker-compose.dev-mode.yml:19-21](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.dev-mode.yml#L19-L21)

---

## Core Responsibilities

*   **Secure Proxying:** Provides a RESTful interface for container lifecycle management, including `run`, `stop`, `remove`, and `rename` operations [app/backend/docker_control/docker_control_client.py:95-161](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L95-L161).
*   **Authentication:** Enforces JWT-based security. The `DockerControlClient` generates tokens using `HS256` [app/backend/docker_control/docker_control_client.py:43-53](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L43-L53), which are validated by the service's `authenticate_request` middleware [docker-control-service/api.py:51-52](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py#L51-L52).
*   **Security Policy Enforcement:** Validates operations against `ALLOWED_IMAGES` (e.g., `ghcr.io/tenstorrent/`) and `ALLOWED_NETWORKS` (e.g., `tt_studio_network`), while enforcing limits like `MAX_MEMORY` (16g) and `MAX_CPUS` (8) [docker-control-service/config.py:23-42](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py#L23-L42).
*   **Health & State Reconciliation:** The backend's `health_monitor.py` uses the service to detect containers that died unexpectedly and to clean up stale "starting" records that might block hardware chip slots [app/backend/docker_control/health_monitor.py:76-110](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L76-L110).
*   **Log Aggregation:** Exposes host-level logs for the studio services and individual deployment logs through dedicated routers [docker-control-service/api.py:59](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py#L59), [docker-control-service/config.py:48-52](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py#L48-L52).

---

## Key Code Entities

The interaction between the backend and the control service is primarily handled by the `DockerControlClient`.

| Entity | Location | Description |
| :--- | :--- | :--- |
| `DockerControlClient` | [app/backend/docker_control/docker_control_client.py:22](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L22) | Python wrapper used by the Django backend to call the service via `_request`. |
| `authenticate_request` | [docker-control-service/api.py:52](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py#L52) | Middleware that validates JWT tokens on every incoming request. |
| `Settings` | [docker-control-service/config.py:12](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py#L12) | Defines security whitelists and resource limits for the service. |
| `check_container_health` | [app/backend/docker_control/health_monitor.py:76](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L76) | Backend task that polls the service to sync DB state with actual Docker state. |
| `dir_size` | [app/backend/docker_control/docker_control_client.py:172](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L172) | Specialized helper to monitor folder sizes inside containers for download progress. |

**Title: Code Entity Association**
```mermaid
classDiagram
    class DockerControlClient {
        +list_containers()
        +run_container()
        +stop_container()
        +dir_size(container_id, path)
    }
    class Settings {
        +ALLOWED_IMAGES
        +ALLOWED_NETWORKS
        +MAX_MEMORY
        +JWT_SECRET
    }
    class HealthMonitor {
        +check_container_health()
        +_cleanup_stale_starting_records()
    }

    DockerControlClient ..> Settings : "Constrained by"
    HealthMonitor --> DockerControlClient : "Uses get_container()"
    DockerControlClient --|> "FastAPI_app" : "Calls via REST"
```
**Sources:** [app/backend/docker_control/docker_control_client.py:22-195](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L22-L195), [docker-control-service/config.py:12-42](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py#L12-L42), [app/backend/docker_control/health_monitor.py:76-96](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L76-L96)

---

## Related Services

The Docker Control Service works in tandem with two primary consumers:

### Docker Control Service API & Security
This child page covers the specific REST endpoints (containers, images, networks, logs) and the security configuration that prevents arbitrary container execution. It details how the service prevents "container breakout" and restricts deployments to verified Tenstorrent images.
For details, see [Docker Control Service API & Security](api-and-security.md).

### Inference API (FastAPI Bridge)
The Inference API (port `8001`) uses the Docker Control Service to orchestrate the actual deployment of AI models. While the Control Service handles the low-level Docker calls, the Inference API manages the high-level logic of weight downloads and model readiness, often checking directory sizes via the control service to report progress.
For details, see [Inference API (FastAPI Bridge)](inference-api.md).

---
**Sources:** [app/backend/docker_control/docker_control_client.py:1-195](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L1-L195), [docker-control-service/api.py:1-90](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py#L1-L90), [docker-control-service/config.py:1-56](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py#L1-L56), [app/backend/docker_control/health_monitor.py:1-171](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L1-L171)22:T21a5,# Docker Control Service API & Security


```{toctree}
:hidden:
:maxdepth: 2

api-and-security
inference-api
```
