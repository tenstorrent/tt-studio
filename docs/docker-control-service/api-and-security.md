# Docker Control Service API & Security

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py">app/backend/docker_control/docker_control_client.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py">app/backend/docker_control/health_monitor.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/docker-compose.dev-mode.yml">app/docker-compose.dev-mode.yml</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py">docker-control-service/api.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/config.py">docker-control-service/config.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/routers/logs.py">docker-control-service/routers/logs.py</a></li>
</ul>
</details>

The `docker-control-service` is a standalone FastAPI application running on port 8002 that acts as a secure proxy for Docker operations. In TT-Studio, backend services do not mount the Docker socket directly for security reasons; instead, they communicate with this service via a REST API protected by JWT authentication. This architecture ensures that container lifecycle management, image pulling, and network configurations are governed by strict security policies.

## Service Architecture and Data Flow

The `docker-control-service` runs on the host machine (outside the primary container network) to maintain direct access to `/var/run/docker.sock` while exposing a controlled interface to the `tt_studio_backend` and other internal services. This migration from direct socket mounting to a proxy pattern prevents containerized applications from gaining full root-level control over the host Docker daemon.

### System Entity Mapping
The following diagram maps the high-level service concepts to the specific code entities implementing them.

**Diagram: Service Entity Mapping**
```mermaid
graph TD
    subgraph Host_Space["Host Space"]
        A["docker-control-service/api.py"] -- "Uses" --> B["docker-control-service/config.py"]
        A -- "Routes" --> C["docker-control-service/routers/"]
        D["docker.sock"] <--> C
    end

    subgraph Container_Space["Container Space"]
        E["docker_control/docker_control_client.py"] -- "JWT_Request" --> A
        F["docker_control/health_monitor.py"] -- "Polling" --> E
    end

    subgraph Code_Entities["Code Entities"]
        E_Class["DockerControlClient"] 
        A_App["FastAPI_app"]
        C_Cont["containers.py"]
        C_Img["images.py"]
        C_Net["networks.py"]
        C_Log["logs.py"]
    end

    E -.-> E_Class
    A -.-> A_App
    C -.-> C_Cont
    C -.-> C_Img
    C -.-> C_Net
    C -.-> C_Log
```

---

## REST API Endpoints

The service provides a comprehensive API for managing the Docker environment required for AI model deployments.

### Container Management
- `GET /api/v1/containers`: Lists containers with optional filters for status and names.
- `POST /api/v1/containers/run`: Deploys a new container. This endpoint enforces resource limits and image whitelisting.
- `POST /api/v1/containers/{id}/stop`: Gracefully stops a running container with a configurable timeout.
- `POST /api/v1/containers/{id}/remove`: Deletes a container and its associated volumes.
- `POST /api/v1/containers/{id}/dir-size`: Recursive byte count of a path inside a container, used for monitoring model weight download progress.

### Image and Network Operations
- `GET /api/v1/images`: Lists available local images.
- `POST /api/v1/images/pull`: Pulls an image from a registry, subject to the `ALLOWED_IMAGES` whitelist.
- `GET /api/v1/networks`: Lists Docker networks. Only networks in the `ALLOWED_NETWORKS` list (e.g., `tt_studio_network`) can be targeted for container attachments.

### Log Access
The service also provides access to host-level logs that are otherwise inaccessible to containerized services through the `logs` router:
- `GET /api/v1/logs/service`: Tail of the Docker Control Service logs.
- `GET /api/v1/logs/startup`: Tail of the system startup logs.
- `GET /api/v1/logs/fastapi`: Tail of the FastAPI inference bridge logs.

---

## Security Policies and Implementation

Security is implemented through a combination of authentication, resource constraints, and operation whitelisting defined in the `Settings` class.

### JWT Authentication
Every request to the service must include a valid JWT in the `Authorization` header.
- **Generation**: The `DockerControlClient` in the backend generates tokens using `HS256` and the `DOCKER_CONTROL_JWT_SECRET`.
- **Validation**: The service uses `authenticate_request` middleware to verify tokens before passing the request to routers.

### Hardened Configuration
The service enforces several safety limits to prevent resource exhaustion or unauthorized access:

| Policy | Value / Constraint | Code Reference |
| :--- | :--- | :--- |
| **Image Whitelist** | `ghcr.io/tenstorrent/`, `alpine:`, `ubuntu:`, etc. | |
| **Network Whitelist** | `tt_studio_network`, `bridge`, `host` | |
| **Memory Limit** | Max 16GB per container | |
| **CPU Limit** | Max 8 CPUs per container | |
| **CORS** | Restricted to `localhost:8000` and `tt-studio-backend-api` | |

### Implementation of Health Monitoring
The `health_monitor.py` module uses the `DockerControlClient` to poll the service and synchronize the state of `ModelDeployment` records in the database with actual container states on the host. It also handles the cleanup of stale "starting" records that might block hardware chip slots via `_cleanup_stale_starting_records`.

**Diagram: Health Monitoring Logic**
```mermaid
sequenceDiagram
    participant HM as health_monitor.py
    participant DCC as DockerControlClient
    participant DCS as docker-control-service
    participant DB as Django_DB_ModelDeployment

    HM->>DB: filter(status="running")
    DB-->>HM: List of deployments
    loop For each deployment
        HM->>DCC: get_container(container_id)
        DCC->>DCS: GET /api/v1/containers/{id}
        DCS-->>DCC: JSON (status: "exited")
        DCC-->>HM: Status data
        HM->>DB: Update status to "exited", set stopped_at
    end
    HM->>HM: _cleanup_stale_starting_records()
```

---

## Configuration and Environment

The service behavior is controlled via environment variables typically set in the `.env` file or passed by `run.py`.

- `DOCKER_CONTROL_JWT_SECRET`: The shared secret used to sign and verify JWTs.
- `DEV_MODE`: If `true`, enables FastAPI auto-reload and more verbose logging.
- `DOCKER_CONTROL_SERVICE_URL`: Used by the backend to locate the service. In development, the backend container uses `extra_hosts` to resolve the host's IP,.

The service logs its own operations and can also serve logs from other system components by reading the paths defined in `SERVICE_LOG_FILE`, `STARTUP_LOG_FILE`, and `MODEL_RUN_LOG_FILE`.

