# Logs Control & Bug Reporting

The `logs_control` Django application is responsible for centralizing system diagnostics, providing log retrieval for system services, and orchestrating the generation of comprehensive bug reports. It aggregates data from the backend, the `docker-control-service`, the AI agent, and inference artifacts.

## Architecture & Data Flow

The `logs_control` app acts as an aggregator. While some logs (like the Django backend logs) are stored locally on a persistent volume, others must be fetched via HTTP from sibling services or read from shared Docker volumes.

### Log Aggregation Topology

The following diagram illustrates how `logs_control` gathers data from across the TT-Studio ecosystem to provide a unified view.

**Log Collection Architecture**
```mermaid
graph TD
    subgraph Frontend_Space["Frontend Space"]
        A["BugReportModal.tsx"] -- "GET /logs-api/bug-report/" --> B["BugReportDataView"]
        A -- "GET /logs-api/bug-report/download/" --> C["BugReportDownloadView"]
        D["Logs_Control_UI"] -- "GET /logs-api/get-log/<path:filename>/" --> E["GetLogView"]
    end

    subgraph Django_Backend["Django Backend (logs_control)"]
        B["BugReportDataView"]
        C["BugReportDownloadView"]
        E["GetLogView"]
        F["_collect_bug_report_data()"]
    end

    subgraph External_Services["External Services"]
        G["docker-control-service:8002"] -- "HTTP /api/v1/logs/*" --> F
        H["inference-api:8001"] -- "Volume: .artifacts/" --> F
        I["Agent_Container"] -- "Docker API" --> G
    end

    F -- "Aggregates" --> B
    F -- "Zips" --> C
```

## Bug Reporting System

The bug reporting system is designed to simplify troubleshooting by bundling environment state, logs, and hardware telemetry into a single ZIP archive.

### Bug Report Manifest
The system follows a strict manifest defined in `BUG_REPORT_MANIFEST` to ensure all critical debugging information is captured.

| Data Key | Destination in ZIP | Source Mechanism |
| :--- | :--- | :--- |
| `backend_log` | `backend.log` | Persistent volume `backend_volume/python_logs/` |
| `model_run_log` | `model_run.log` | Proxy to `docker-control-service` `/api/v1/logs/fastapi` |
| `model_run_deployment_logs`| `model_run_logs/<name>.log` | Volume mount `TT_STUDIO_ROOT/logs/model_run_logs/` |
| `docker_control_log`| `docker-control-service.log` | Proxy to `docker-control-service` `/api/v1/logs/service` |
| `agent_log` | `agent.log` | Container logs via `docker-control-service` |
| `inference_run_logs`| `inference_artifacts/run_logs/` | Volume `.artifacts/tt-inference-server/workflow_logs/` |
| `tt_smi` | `tt_smi.json` | `board_control.services.SystemResourceService` |
| `deployments` | `deployments.json` | `backend_volume/deployments.json` |
| `current_models` | `current_models.json` | Snapshot of `docker-control` and `model_control` cache |

### Implementation Details
1. **Collection**: The `_collect_bug_report_data` function gathers metadata and small log snippets to show a preview in the UI.
2. **ZIP Generation**: `BugReportDownloadView` performs the heavy lifting. It creates an in-memory ZIP file using `zipfile.ZipFile(io.BytesIO())`.
3. **Frontend Integration**: The `useBugReport` hook manages the multi-step collection process: `form` → `collecting` → `actions`. It generates a stable `diagnosticsRef` (e.g., `ttbr-abcd...`) to link the ZIP file to a GitHub issue.

## Log Retrieval & Monitoring

TT-Studio provides access to logs for various system components through specialized views.

### Code Entity Relationship: Log Access
The following diagram maps the frontend UI components to the backend views and the underlying log sources they access.

**Log Access Mapping**
```mermaid
graph LR
    subgraph Frontend_Entities["Frontend Entities"]
        URS["useBugReport.ts"]
        TYPES["types.ts (BugReportData)"]
    end

    subgraph Backend_Entities["Backend Entities (logs_control/views.py)"]
        FALV["FastAPILogsView"]
        TILV["TtInferenceLogsView"]
        BRDV["BugReportDataView"]
        GLV["GetLogView"]
    end

    subgraph Data_Sources["Data Sources / Proxies"]
        MRLOG["model_run.log (filesystem)"]
        DCS["docker-control-service (port 8002)"]
        PV["Persistent Volume (LOGS_ROOT)"]
    end

    URS -- "calls /logs-api/bug-report/" --> BRDV
    FALV -- "reads" --> MRLOG
    TILV -- "proxies /api/v1/containers/logs" --> DCS
    GLV -- "reads" --> PV
    BRDV -- "fetches /api/v1/logs/fastapi" --> DCS
```

### Key Functions and Classes

#### Backend: `logs_control/views.py`
* `ListLogsView`: Recursively builds a JSON tree of all `.log` files found in `LOGS_ROOT`.
* `GetLogView`: Retrieves the raw content of a specific log file, including security checks to prevent directory traversal by validating that the path starts with `LOGS_ROOT`.
* `FastAPILogsView`: Attempts to find and return the last 20 lines of `model_run.log` (formerly `fastapi.log`) from several possible relative and absolute paths.
* `TtInferenceLogsView`: Specifically handles logs for inference containers by proxying requests to the `docker-control-service`.
* `BugReportDownloadView`: Orchestrates the `zipfile` creation, including fetching logs from the `docker-control-service` via `urllib.request` and reading local artifacts.

#### Docker Control Service: `routers/logs.py`
* `get_service_log`: Serves the `docker-control-service.log` using `_read_tail`.
* `get_fastapi_log`: Serves the `model_run.log` from the perspective of the control service.

#### Frontend: `bug-report/`
* `useBugReport`: A custom hook that encapsulates the logic for calling the bug report endpoints, managing the collection status of various log sources, and handling the ZIP download.
* `buildIssueBody`: Generates a concise Markdown body for GitHub issues that includes the `diagnosticsRef`.

## File System & Environment
The app relies on two primary environment variables for log location:
1. `INTERNAL_PERSISTENT_STORAGE_VOLUME`: The base path (aliased as `LOGS_ROOT`) for persistent backend logs.
2. `TT_STUDIO_ROOT`: The root directory used to locate inference artifacts and internal logs.

---

:::{admonition} Source files this page was written from
:class: dropdown tt-sources

Captured at commit [`c837b829`](https://github.com/tenstorrent/tt-studio/commit/c837b829), so the linked line numbers match that revision.

- [`app/backend/docker_control/deployment_sync.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py)
- [`app/backend/logs_control/views.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/logs_control/views.py)
- [`app/backend/shared_config/models_from_inference_server.json`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json)
- [`app/frontend/src/components/bug-report/types.ts`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/bug-report/types.ts)
- [`app/frontend/src/components/bug-report/useBugReport.ts`](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/bug-report/useBugReport.ts)
- [`docker-control-service/routers/logs.py`](https://github.com/tenstorrent/tt-studio/blob/c837b829/docker-control-service/routers/logs.py)
:::
