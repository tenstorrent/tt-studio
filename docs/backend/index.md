# Backend Services

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/.vscode/extensions.json">.vscode/extensions.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/.vscode/settings.json">.vscode/settings.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile">app/backend/Dockerfile</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt">app/backend/requirements.txt</a></li>
</ul>
</details>



The TT-Studio Backend is a Django-based application responsible for orchestrating model lifecycles, managing hardware resources, and providing the primary API for the frontend. It operates as a central hub, coordinating between the `docker-control-service`, `inference-api`, and various model containers.

The backend runs inside a Docker container, typically accessible on port `8000` [app/backend/Dockerfile:12-12](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L12-L12). It utilizes a `python:3.12.8-slim-bookworm` base [app/backend/Dockerfile:5-5](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L5-L5). Notably, the backend container does not mount `/var/run/docker.sock` directly; all Docker operations are proxied via HTTP with JWT authentication to ensure security [app/backend/requirements.txt:8-8](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L8-L8).

## Backend Architecture & Service Map

The backend is organized into several specialized Django apps, each handling a distinct domain of the TT-Studio ecosystem. It relies on `uvicorn` and `gunicorn` for serving requests [app/backend/requirements.txt:5-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L5-L11).

### Backend Service Interaction
```mermaid
graph TD
    subgraph "Django_Backend [Port_8000]"
        DC["docker_control"]
        MC["model_control"]
        BC["board_control"]
        LC["logs_control"]
        VC["vector_db_control"]
        WC["wakeword_control"]
    end

    subgraph "External_Services"
        DCS["docker-control-service [Port_8002]"]
        IA["inference-api [Port_8001]"]
        CDB["ChromaDB [Port_8000/Internal]"]
    end

    subgraph "Hardware_Layer"
        HW["Tenstorrent_Chips"]
    end

    DC <-->|"httpx/JWT"| DCS
    MC <-->|"httpx/SSE"| IA
    VC <-->|"langchain_chroma"| CDB
    BC <-->|"psutil/tt-smi"| HW
    WC <-->|"onnxruntime"| HW
```
Sources: [app/backend/Dockerfile:28-45](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L28-L45), [app/backend/requirements.txt:1-14](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L1-L14), [app/backend/requirements.txt:23-27](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L23-L27).

### Code Entity Mapping: Core Dependencies to App Logic
```mermaid
graph LR
    subgraph "Django_App_Ecosystem"
        D["Django_5.0.4"]
        DRF["Django_Rest_Framework"]
        CH["Channels_4.1.0"]
    end

    subgraph "Service_Clients"
        HX["httpx"]
        DK["docker_python_sdk"]
        LC["langchain"]
    end

    subgraph "Hardware_Interfaces"
        PS["psutil"]
        TS["tt-smi_binary"]
        ONNX["onnxruntime"]
    end

    D --> DRF
    DRF -.->|"API_Views"| DC["docker_control"]
    HX -.->|"External_Requests"| DC
    LC -.->|"RAG_Logic"| VC["vector_db_control"]
    PS -.->|"System_Stats"| BC["board_control"]
    TS -.->|"Chip_Telemetry"| BC
    CH -.->|"WebSockets"| WC["wakeword_control"]
    ONNX -.->|"Inference"| WC
```
Sources: [app/backend/requirements.txt:1-32](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L1-L32), [app/backend/Dockerfile:28-45](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L28-L45), [app/backend/Dockerfile:56-58](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L56-L58).

---

## Subsystems Overview

### Docker Control & Container Lifecycle
The `docker_control` app is the primary interface for managing model containers. It manages the deployment store and translates frontend requests into container lifecycle events (pull, run, stop) via the `docker-control-service`.

*   **Key Logic**: Handles chip slot allocation and volume management for model weights.
*   **Implementation**: Uses `httpx` for asynchronous communication with the control proxy [app/backend/requirements.txt:6-6](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L6-L6).
*   **For details, see [Docker Control & Container Lifecycle](docker-control.md)**.

### Model Control & Inference Pipeline
The `model_control` app manages the high-level inference logic and the model catalog. It routes inference requests to the appropriate model container via the `inference-api` bridge.

*   **Key Logic**: Orchestrates voice pipelines (Whisper to LLM) and tracks performance metrics like TTFT and TPOT.
*   **Model Catalog**: Interprets `ModelImpl` configurations to determine hardware requirements.
*   **For details, see [Model Control & Inference Pipeline](model-control.md)**.

### Vector DB Control (RAG Backend)
This app manages the integration with ChromaDB to provide Retrieval-Augmented Generation (RAG) capabilities. It uses `langchain` and `sentence-transformers` for processing documents [app/backend/requirements.txt:23-28](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L23-L28).

*   **Key Logic**: Handles document ingestion (PDF, Docx), chunking, and embedding generation [app/backend/requirements.txt:9-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L9-L15).
*   **For details, see [Vector DB Control (RAG Backend)](vector-db-control.md)**.

### Board Control & Hardware Monitoring
The `board_control` app provides real-time telemetry for the host system and Tenstorrent hardware. The backend container conditionally installs `tt-smi` (v4.1.2) via Rust to facilitate hardware detection in local mode [app/backend/Dockerfile:29-41](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L29-L41).

*   **Key Logic**: Uses `psutil` for CPU/RAM monitoring and `tt-smi` for Tenstorrent chip telemetry [app/backend/requirements.txt:14-14](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L14-L14).
*   **For details, see [Board Control & Hardware Monitoring](board-control.md)**.

Sources: [app/backend/Dockerfile:28-45](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L28-L45), [app/backend/requirements.txt:14-14](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L14-L14).

### Logs Control & Bug Reporting
This app aggregates logs from all services in the `tt_studio_network`. It provides a unified streaming API for the frontend and generates diagnostic bug reports.

*   **Key Logic**: Real-time log streaming and aggregation across multi-container deployments.
*   **For details, see [Logs Control & Bug Reporting](logs-control.md)**.

---

### Core Configuration & Development
The backend environment is strictly controlled. It includes specific workarounds for dependencies like `openwakeword` (v0.6.0), which is installed without dependencies to avoid Python 3.12 wheel conflicts with `tflite-runtime`, relying instead on `onnxruntime` [app/backend/Dockerfile:56-58](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L56-L58), [app/backend/requirements.txt:13-13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L13-L13).

For development, the project includes VS Code settings for consistent formatting via ESLint and Prettier [.vscode/settings.json:1-16](https://github.com/tenstorrent/tt-studio/blob/c837b829/.vscode/settings.json#L1-L16), [.vscode/extensions.json:1-7](https://github.com/tenstorrent/tt-studio/blob/c837b829/.vscode/extensions.json#L1-L7).

Sources: [app/backend/Dockerfile:5-58](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/Dockerfile#L5-L58), [app/backend/requirements.txt:1-32](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/requirements.txt#L1-L32).1c:T288d,# Docker Control & Container Lifecycle


```{toctree}
:hidden:
:maxdepth: 2

docker-control
model-control
vector-db-control
board-control
logs-control
```
