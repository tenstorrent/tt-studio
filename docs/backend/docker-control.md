# Docker Control & Container Lifecycle

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/apps.py">app/backend/docker_control/apps.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py">app/backend/docker_control/chip_allocator.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_store.py">app/backend/docker_control/deployment_store.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py">app/backend/docker_control/docker_utils.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py">app/backend/docker_control/health_monitor.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/serializers.py">app/backend/docker_control/serializers.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tests.py">app/backend/docker_control/tests.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py">app/backend/docker_control/tt_inference_client.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/urls.py">app/backend/docker_control/urls.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/views.py">app/backend/docker_control/views.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/model_control/model_utils.py">app/backend/model_control/model_utils.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/model_control/views.py">app/backend/model_control/views.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/FirstStepForm.tsx">app/frontend/src/components/FirstStepForm.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/api.py">docker-control-service/api.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/inference-api/api.py">inference-api/api.py</a></li>
</ul>
</details>



The `docker_control` Django app is the core orchestration engine for managing AI model containers within TT-Studio. It manages the full lifecycle of inference containers—from hardware capability detection and chip slot allocation to deployment via the `inference-api` and continuous health monitoring.

## Architecture & Data Flow

The system operates as a bridge between the user-facing Django backend and the hardware-level Docker operations. To maintain security and avoid mounting the Docker socket directly into the web-facing container, all Docker commands are proxied through the `docker-control-service`.

### Deployment Orchestration Flow

This diagram illustrates the flow from a frontend deployment request to a running model container, highlighting the code entities involved in the transition.

"Deployment Orchestration Flow"
```mermaid
sequenceDiagram
    participant FE as "Frontend (FirstStepForm.tsx)"
    participant DCV as "docker_control.views.DeployView"
    participant CSA as "docker_control.chip_allocator.ChipSlotAllocator"
    participant TIC as "docker_control.tt_inference_client.start_chat_deployment"
    participant IAPI as "inference-api (api.py :8001)"
    participant DCS as "docker-control-service (api.py :8002)"

    FE->>DCV: POST /api/docker/deploy/
    DCV->>CSA: allocate_chip_slot(model_name)
    CSA-->>DCV: device_id (e.g. 0)
    
    DCV->>TIC: start_chat_deployment(model_name, device, device_id)
    TIC->>IAPI: POST /run (Payload: model, device, device_id)
    IAPI-->>TIC: job_id (202 Accepted)
    TIC-->>DCV: TTInferenceRunResult(job_id)
    DCV-->>FE: {"status": "success", "job_id": "..."}
    
    Note over IAPI,DCS: Background: IAPI run_main() calls DCS /containers/run
```
Sources: [app/backend/docker_control/views.py:334-450](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/views.py#L334-L450), [app/backend/docker_control/tt_inference_client.py:84-167](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py#L84-L167), [app/backend/docker_control/chip_allocator.py:164-197](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py#L164-L197), [inference-api/api.py:163-250](https://github.com/tenstorrent/tt-studio/blob/c837b829/inference-api/api.py#L163-L250)

## Deployment Store (JSON ORM)

TT-Studio uses a thread-safe JSON-backed store instead of a traditional Django SQLite database for deployment metadata. This ensures that deployment state persists across backend container restarts without requiring complex database migrations.

The `ModelDeployment` class in `deployment_store.py` provides a drop-in ORM-like interface:
*   **Location**: Determined by `backend_config.backend_cache_root`, typically within the persistent volume at `tenstorrent/deployments.json` [app/backend/docker_control/deployment_store.py:23-27](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_store.py#L23-L27).
*   **Managers**: Implements `objects.create()`, `objects.filter()`, and `objects.all()` using a `DeploymentManager` [app/backend/docker_control/deployment_store.py:178-216](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_store.py#L178-L216).
*   **Concurrency**: Uses `threading.Lock()` to prevent race conditions during file I/O [app/backend/docker_control/deployment_store.py:29-29](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_store.py#L29-L29).
*   **Normalization**: Automatically handles `device_ids` (multi-chip) vs `device_id` (single-chip) fields to support various board topologies [app/backend/docker_control/deployment_store.py:53-85](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_store.py#L53-L85).

Sources: [app/backend/docker_control/deployment_store.py:5-30](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_store.py#L5-L30), [app/backend/docker_control/models.py:1-20](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/models.py#L1-L20)

## Chip Slot Allocation

The `ChipSlotAllocator` manages the mapping between Tenstorrent hardware (chips) and model containers. It prevents resource over-subscription by tracking which `slot_id` is currently occupied.

| Feature | Description |
| :--- | :--- |
| **Board Detection** | Uses `detect_board_type()` to identify installed hardware via `tt-smi` [app/backend/docker_control/chip_allocator.py:85-88](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py#L85-L88). |
| **Slot Count** | Maps board types to total available slots (e.g., Galaxy=32, T3K=4, P150X8=8) [app/backend/docker_control/chip_allocator.py:54-65](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py#L54-L65). |
| **Multi-Chip Support** | Models requiring 4 chips (e.g. Llama-3-70B) occupy all slots on a 4-chip card [app/backend/docker_control/chip_allocator.py:123-131](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py#L123-L131). |
| **Validation** | `_validate_manual_allocation` ensures a user-selected chip is not already occupied [app/backend/docker_control/chip_allocator.py:183-189](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py#L183-L189). |

Sources: [app/backend/docker_control/chip_allocator.py:70-162](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/chip_allocator.py#L70-L162), [app/backend/docker_control/docker_utils.py:135-168](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py#L135-L168)

## Container Lifecycle Management

### Health Monitoring
The `health_monitor.py` module runs a background thread that polls the status of all containers marked as `running` in the `ModelDeployment` store every 5 seconds [app/backend/docker_control/health_monitor.py:131-154](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L131-L154).

1.  **Unexpected Death Detection**: If `docker_client.get_container()` reports a status other than `running` or `restarting`, the database record is updated to the actual status (e.g., `exited`, `dead`) [app/backend/docker_control/health_monitor.py:93-110](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L93-L110).
2.  **Stale Record Cleanup**: Cleans up `starting` records that fail to transition. `pending_*` records are purged after 10 minutes, while FastAPI `job_id` records are timed out after 35 minutes to allow for large weight downloads [app/backend/docker_control/health_monitor.py:19-73](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L19-L73).

### Deployment Sync
The `deployment_sync.py` module bridges the gap between the `inference-api`'s asynchronous `/run` jobs and the backend's deployment state. 

*   **Polling**: It spawns a per-job daemon thread that polls the FastAPI `/run/progress/{job_id}` endpoint [app/backend/docker_control/deployment_sync.py:120-159](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py#L120-L159).
*   **State Transition**: On `completed`, it swaps the `job_id` placeholder for the real Docker `container_id` and marks the status as `running` [app/backend/docker_control/deployment_sync.py:63-92](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py#L63-L92).
*   **User Cancellation**: If a user stops a deployment while it is still in the `starting` phase, `_do_sync` ensures the container is cleaned up immediately upon completion [app/backend/docker_control/deployment_sync.py:68-82](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py#L68-L82).

Sources: [app/backend/docker_control/health_monitor.py:76-130](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L76-L130), [app/backend/docker_control/deployment_sync.py:47-118](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py#L47-L118)

## Integration Components

### TT Inference Client
The `tt_inference_client.py` is a specialized wrapper for the `inference-api`. Its primary function, `start_chat_deployment`, sends a standardized payload to the FastAPI service on port 8001.

*   **Endpoint**: `http://172.18.0.1:8001/run` [app/backend/docker_control/tt_inference_client.py:90-90](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py#L90-L90).
*   **Payload**: Includes `model`, `workflow`, `device`, `device_id`, and `dev_mode` flags [app/backend/docker_control/tt_inference_client.py:103-120](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py#L103-L120).

### Docker Control Client
The `DockerControlClient` communicates with the `docker-control-service` (port 8002) using JWT authentication [app/backend/docker_control/docker_control_client.py:43-53](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L43-L53). It replaces direct Docker SDK usage to ensure the backend container does not require `/var/run/docker.sock` access.

"Docker Control Interface Mapping"
```mermaid
classDiagram
    class "docker_control.docker_control_client.DockerControlClient" {
        +list_containers(all, filters)
        +run_container(image, name, ports, env)
        +stop_container(container_id)
        +get_container(container_id)
    }
    class "docker_control.views.ContainersView" {
        +get(request)
    }
    class "docker_control.docker_utils" {
        +_ensure_network()
        +_run_direct_container(impl, weights_id)
    }

    "docker_control.views.ContainersView" ..> "docker_control.docker_control_client.DockerControlClient" : uses list_containers()
    "docker_control.docker_utils" ..> "docker_control.docker_control_client.DockerControlClient" : uses get_docker_client()
    "docker_control.health_monitor" ..> "docker_control.docker_control_client.DockerControlClient" : uses get_container()
```
Sources: [app/backend/docker_control/docker_control_client.py:22-149](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_control_client.py#L22-L149), [app/backend/docker_control/views.py:127-168](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/views.py#L127-L168), [app/backend/docker_control/health_monitor.py:91-96](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/health_monitor.py#L91-L96)

## Key Functions Reference

| Function | File | Purpose |
| :--- | :--- | :--- |
| `_poll_deployment_to_completion` | `docker_utils.py` | Blocks until a FastAPI deployment job reaches a terminal state [app/backend/docker_control/docker_utils.py:34-70](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py#L34-L70). |
| `map_board_type_to_device_name` | `docker_utils.py` | Converts internal board strings (e.g., "T3K") to Inference Server device names (e.g., "t3k") [app/backend/docker_control/docker_utils.py:135-168](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py#L135-L168). |
| `_ensure_network` | `docker_utils.py` | Ensures the `tt_studio_network` exists via the `docker-control-service` on module load [app/backend/docker_control/docker_utils.py:73-90](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py#L73-L90). |
| `_run_direct_container` | `docker_utils.py` | Runs containers directly (bypassing Inference Server) for non-chat models like `FACE_RECOGNITION` [app/backend/docker_control/docker_utils.py:170-205](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py#L170-L205). |
| `resolve_deploy_image` | `tt_inference_client.py` | Asks the Inference Server which image it will actually deploy for a model to enable accurate pre-pulling [app/backend/docker_control/tt_inference_client.py:45-81](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py#L45-L81). |

Sources: [app/backend/docker_control/docker_utils.py](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/docker_utils.py), [app/backend/docker_control/tt_inference_client.py](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py)1d:T25cc,# Model Control & Inference Pipeline
