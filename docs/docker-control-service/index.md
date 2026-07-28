# Docker Control Service

The **Docker Control Service** is a standalone FastAPI application that serves as a secure proxy for Docker operations within the TT-Studio ecosystem. It runs on the host machine (typically port `8002`) rather than inside a container, allowing it to interact with the Docker socket (`docker.sock`) directly without exposing that socket to the broader containerized network.

This service replaces direct Docker SDK usage in the backend with a controlled REST API, enforcing security policies such as image whitelisting, resource limits, and network restrictions.

## System Role & Architecture

The service acts as the bridge between the **TT-Studio Backend** (Django) and the host's Docker daemon. By centralizing Docker logic here, TT-Studio avoids the security risks associated with mounting the Docker socket into the web-facing backend container. In development mode, the backend communicates with this service via `host.docker.internal`.

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

---

## Core Responsibilities

* **Secure Proxying:** Provides a RESTful interface for container lifecycle management, including `run`, `stop`, `remove`, and `rename` operations.
* **Authentication:** Enforces JWT-based security. The `DockerControlClient` generates tokens using `HS256`, which are validated by the service's `authenticate_request` middleware.
* **Security Policy Enforcement:** Validates operations against `ALLOWED_IMAGES` (e.g., `ghcr.io/tenstorrent/`) and `ALLOWED_NETWORKS` (e.g., `tt_studio_network`), while enforcing limits like `MAX_MEMORY` (16g) and `MAX_CPUS` (8).
* **Health & State Reconciliation:** The backend's `health_monitor.py` uses the service to detect containers that died unexpectedly and to clean up stale "starting" records that might block hardware chip slots.
* **Log Aggregation:** Exposes host-level logs for the studio services and individual deployment logs through dedicated routers,.

---

## Key Code Entities

The interaction between the backend and the control service is primarily handled by the `DockerControlClient`.

| Entity | Location | Description |
| :--- | :--- | :--- |
| `DockerControlClient` | | Python wrapper used by the Django backend to call the service via `_request`. |
| `authenticate_request` | | Middleware that validates JWT tokens on every incoming request. |
| `Settings` | | Defines security whitelists and resource limits for the service. |
| `check_container_health` | | Backend task that polls the service to sync DB state with actual Docker state. |
| `dir_size` | | Specialized helper to monitor folder sizes inside containers for download progress. |

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

:::{admonition} Source files this page was written from
:class: dropdown tt-sources

Captured at commit [`c837b829`](https://github.com/tenstorrent/tt-studio/commit/c837b829), so the linked line numbers match that revision.

- [`app/backend/docker_control/docker_control_client.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py)
- [`app/backend/docker_control/health_monitor.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py)
- [`app/docker-compose.dev-mode.yml`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.dev-mode.yml)
- [`docker-control-service/README.md`](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/README.md)
- [`docker-control-service/api.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py)
- [`docker-control-service/config.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py)
:::

```{toctree}
:hidden:
:maxdepth: 2

api-and-security
inference-api
```
