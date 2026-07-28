# Model Control & Inference Pipeline

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py">app/backend/docker_control/deployment_sync.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/tt_inference_client.py">app/backend/docker_control/tt_inference_client.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/logs_control/views.py">app/backend/logs_control/views.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/model_control/connection_warmer.py">app/backend/model_control/connection_warmer.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/model_control/model_utils.py">app/backend/model_control/model_utils.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/model_control/pipeline_views.py">app/backend/model_control/pipeline_views.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/model_control/urls.py">app/backend/model_control/urls.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json">app/backend/shared_config/models_from_inference_server.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/FirstStepForm.tsx">app/frontend/src/components/FirstStepForm.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/inference-api/api.py">inference-api/api.py</a></li>
</ul>
</details>

The `model_control` Django app is the central orchestrator for model metadata, inference request routing, and performance tracking. It manages the lifecycle of inference requests from the frontend to deployed model containers, handles Server-Sent Events (SSE) streaming, and implements a multi-stage voice pipeline.

## Model Configuration & Catalog

TT-Studio uses a structured catalog to define model capabilities, hardware requirements, and container environments.

### ModelImpl and Metadata
The `ModelImpl` dataclass is the primary configuration entity. It encapsulates:
* **Hardware Compatibility**: Defined via `device_configurations` (e.g., `GALAXY`, `N150`, `T3K`).
* **Docker Runtime**: Includes `image_name`, `shm_size` (defaulting to 32G), and volume mounts for weights.
* **Environment Injection**: Automatically configures `HF_HOME` and `WH_ARCH_YAML` based on the selected hardware.
* **Service Interface**: Defines the `service_route` (e.g., `/v1/chat/completions`) and `health_route`.

### The Model Catalog
The system loads model definitions from `models_from_inference_server.json`. This file maps high-level model names (e.g., "Llama-3.1-8B-Instruct") to specific implementation details required for deployment.

| Field | Description |
| :--- | :--- |
| `model_type` | Category (e.g., `CHAT`, `IMAGE_GENERATION`, `SPEECH_RECOGNITION`) |
| `inference_engine` | The underlying server (e.g., `vLLM`, `media`, `forge`) |
| `docker_image` | The specific GHCR image reference for the model version |

---

## Inference Execution Flow

Inference requests are handled through a multi-layered bridge that connects the React frontend to the model containers.

### Deployment Initiation
When a user selects a model in `FirstStepForm.tsx`, the backend uses the `tt_inference_client` to start the deployment. The `start_chat_deployment` function sends a POST request to the `inference-api` (port 8001) `/run` endpoint. This bridge uses `TTInferenceRunResult` to communicate deployment status and `job_id` back to the UI.

### Lifecycle Synchronization
Because deployments are asynchronous, the `deployment_sync.py` module manages the transition from a "starting" placeholder to a "running" state. The `_poll_and_sync` function polls the FastAPI `/run/progress/{job_id}` endpoint and updates the `ModelDeployment` record with the real Docker `container_id` once the job is "completed".

### Request Routing & Proxying
The `model_control` app routes inference requests based on the `internal_url` stored in the deployment cache. It uses `_vllm_client` (an `httpx.AsyncClient`) with connection pooling to manage high-concurrency streaming to vLLM or Cloud providers.

To minimize cold-start latency, a `connection_warmer` background thread performs periodic `GET /health` pings every 500ms and dummy `max_tokens=1` inference requests every 30s to keep TCP sockets and vLLM pipelines active.

**Inference Pipeline Diagram**
```mermaid
graph TD
    subgraph "Frontend_Space_(React)"
        A["ChatComponent"] -- "POST /models-api/inference/" --> B["InferenceView_(views.py)"]
    end

    subgraph "Backend_Space_(Django)"
        B -- "lookup" --> C["get_deploy_cache()"]
        C -- "ModelImpl" --> D["model_utils.py"]
        D -- "stream_openai_passthrough()" --> E["Target_Container"]
        F["connection_warmer.py"] -- "ping_all()" --> E
    end

    subgraph "Container_Space_(vLLM/Media)"
        E -- "SSE_Stream" --> D
    end

    D -- "InferenceMetricsTracker" --> B
    B -- "text/event-stream" --> A
```

---

## Inference Metrics Tracking

The `InferenceMetricsTracker` class provides high-fidelity performance monitoring following the vLLM measurement methodology.

### Key Metrics Implementation
* **TTFT (Time to First Token)**: Calculated as the duration from request start to the arrival of the first content token.
* **ITL (Inter-Token Latency)**: A list of intervals between consecutive content chunks.
* **TPOT (Time Per Output Token)**: Calculated as the mean of the ITL list.
* **TPS (Tokens Per Second)**: Derived from `total_time` and `tokens_decoded` in the final stats.

### Thinking/Reasoning Support
The tracker explicitly handles reasoning tokens (e.g., `<think>` blocks). It tracks `thinking_start_time` and `thinking_end_time` to provide separate stats for "Thinking Duration" vs. actual generation. This is supported by `REASONING_MODELS` configuration which identifies models requiring a `--reasoning-parser`.

---

## Voice & Specialized Pipelines

TT-Studio supports complex multi-model pipelines, specifically for voice-to-voice interaction via `VoicePipelineView`.

### Voice Pipeline (Whisper → LLM → TTS)
The voice pipeline orchestrates three distinct model types in a streaming sequence:
1. **Speech-to-Text (STT)**: Sends an `audio_file` to a Whisper container (e.g., `distil-large-v3`).
2. **LLM**: Processes the transcript and streams chunks back to the client while accumulating the full response.
3. **Text-to-Speech (TTS)**: (Optional) Converts the final LLM text to audio using either OpenAI-style or Enqueue-style endpoints.

### Health Monitoring
Before routing requests, `model_utils.py` performs a `health_check`. It specifically handles HTTP 503 "not ready" or HTTP 405 "Model is not ready" responses, which indicate that a model is still warming up or loading weights into Tenstorrent SRAM/DRAM.

**Entity Association Diagram**
```mermaid
graph LR
    subgraph "Natural_Language_Space"
        M1["Model_Catalog"]
        M2["Performance_Stats"]
        M3["Voice_Pipeline"]
        M4["Inference_Client"]
    end

    subgraph "Code_Entity_Space"
        C1["ModelImpl_(model_config.py)"]
        C2["InferenceMetricsTracker_(metrics_tracker.py)"]
        C3["VoicePipelineView_(pipeline_views.py)"]
        C4["models_from_inference_server.json"]
        C5["start_chat_deployment_(tt_inference_client.py)"]
    end

    M1 -.-> C1
    M1 -.-> C4
    M2 -.-> C2
    M3 -.-> C3
    M4 -.-> C5
```

