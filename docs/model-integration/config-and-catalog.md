# Model Configuration & Catalog

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py">app/backend/docker_control/deployment_sync.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/logs_control/views.py">app/backend/logs_control/views.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/coding_agent_config.py">app/backend/shared_config/coding_agent_config.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json">app/backend/shared_config/models_from_inference_server.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py">app/backend/shared_config/sync_models_from_inference_server.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/test_sync_models.py">app/backend/shared_config/test_sync_models.py</a></li>
</ul>
</details>



This page details the configuration schema and cataloging system used by TT-Studio to define, discover, and deploy AI models. The system relies on a central dataclass for model metadata and a JSON-based catalog derived from the Tenstorrent inference server artifacts.

## ModelImpl Dataclass

The `ModelImpl` class is the core configuration entity for any model implementation in TT-Studio. It is a frozen dataclass that defines the static properties required to instantiate a model container, including hardware requirements and Docker runtime parameters.

### Key Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `image_name` | `str` | The Docker image repository (e.g., `ghcr.io/tenstorrent/...`). [app/backend/shared_config/model_config.py:49](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L49) |
| `image_tag` | `str` | The specific version tag of the Docker image. [app/backend/shared_config/model_config.py:50](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L50) |
| `device_configurations` | `Set[DeviceConfigurations]` | A set of supported hardware layouts (e.g., `N150`, `T3K`, `GALAXY`). [app/backend/shared_config/model_config.py:51](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L51) |
| `docker_config` | `Dict[str, Any]` | Runtime parameters passed to the Docker Engine (environment variables, shm_size). [app/backend/shared_config/model_config.py:52](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L52) |
| `service_route` | `str` | The API endpoint for inference (e.g., `/v1/chat/completions`). [app/backend/shared_config/model_config.py:53](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L53) |
| `setup_type` | `SetupTypes` | Defines how the model is provisioned (e.g., `TT_INFERENCE_SERVER`). [app/backend/shared_config/model_config.py:54](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L54) |
| `model_type` | `ModelTypes` | Categorization of the model (e.g., `CHAT`, `IMAGE_GENERATION`). [app/backend/shared_config/model_config.py:55](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L55) |
| `hf_model_id` | `str` | The HuggingFace repository ID for weight downloading. [app/backend/shared_config/model_config.py:56](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L56) |
| `shm_size` | `str` | Shared memory allocation, defaults to `32G` for Tenstorrent workloads. [app/backend/shared_config/model_config.py:61](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L61) |

### Initialization Logic
During `__post_init__`, the class performs several derived configuration steps:
1.  **Volume Mapping**: Automatically configures host-to-container volume mounts for model weights and HuggingFace caches [app/backend/shared_config/model_config.py:73-79](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L73-L79).
2.  **Hardware Specifics**: If the configuration includes Wormhole-based architectures (`N150_WH_ARCH_YAML`, `N300_WH_ARCH_YAML`, or `N300x4_WH_ARCH_YAML`), it injects the `WH_ARCH_YAML` environment variable set to `wormhole_b0_80_arch_eth_dispatch.yaml` [app/backend/shared_config/model_config.py:81-89](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L81-L89).
3.  **Environment Overrides**: Loads model-specific `.env` files from the persistent storage volume via `load_dotenv_dict` to override default Docker environment variables [app/backend/shared_config/model_config.py:91-99](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L91-L99).

**Sources:**
- `ModelImpl` definition: [app/backend/shared_config/model_config.py:44-67](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L44-L67)
- `__post_init__` logic: [app/backend/shared_config/model_config.py:69-100](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L69-L100)

## Model Catalog

The system maintains a primary catalog file, `models_from_inference_server.json`, which acts as the source of truth for available models. This file is generated from the `tt-inference-server` project and contains metadata for over 50 models [app/backend/shared_config/models_from_inference_server.json:1-7](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L1-L7).

### Catalog Synchronization
The catalog is updated via the `sync_models_from_inference_server.py` script. This script performs several normalization tasks:
- **Source Resolution**: Locates `model_specs_output.json` from artifact paths (via `TT_INFERENCE_ARTIFACT_PATH`) or local dev checkouts [app/backend/shared_config/sync_models_from_inference_server.py:38-61](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L38-L61).
- **Route Derivation**: Uses `map_service_route` to determine if a model should use OpenAI-compatible endpoints like `/v1/chat/completions`, `/v1/audio/speech`, or `/v1/images/generations` based on its engine and type [app/backend/shared_config/sync_models_from_inference_server.py:128-157](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L128-L157).
- **Environment Filtering**: Strips device-specific environment variables (like `WH_ARCH_YAML`, `MESH_DEVICE`, `ARCH_NAME`) that are handled dynamically by `ModelImpl.__post_init__` [app/backend/shared_config/sync_models_from_inference_server.py:174-186](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L174-L186).
- **Health Check Mapping**: All models (vLLM, forge, media) are normalized to use `/health` as their health route [app/backend/shared_config/sync_models_from_inference_server.py:160-172](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L160-L172).

### Natural Language to Code Entity Mapping: Model Discovery
The following diagram illustrates how user-facing model names in the UI are resolved to specific `ModelImpl` instances and Docker configurations.

Title: Model Discovery and Resolution Flow
```mermaid
graph TD
    User["User Selection (UI)"] -- "model_name" --> Catalog["models_from_inference_server.json"]
    Catalog -- "JSON Object" --> Factory["ModelConfig Factory"]
    Factory -- "Instantiates" --> ModelImpl["ModelImpl Class"]
    
    subgraph "app/backend/shared_config/model_config.py"
        ModelImpl
        LoadEnv["load_dotenv_dict()"]
        PostInit["__post_init__()"]
    end
    
    ModelImpl -- "triggers" --> PostInit
    PostInit -- "calls" --> LoadEnv
    LoadEnv -- "updates" --> Docker["docker_config['environment']"]
    
    style ModelImpl stroke-width:2px
    style Catalog stroke-dasharray: 5 5
```
**Sources:**
- Catalog data: [app/backend/shared_config/models_from_inference_server.json:7-133](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L7-L133)
- Configuration logic: [app/backend/shared_config/model_config.py:44-100](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L44-L100)
- Sync logic: [app/backend/shared_config/sync_models_from_inference_server.py:128-186](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L128-L186)

## Device Configurations & Chip Requirements

TT-Studio infers chip requirements by intersecting the model's `device_configurations` with the system's detected hardware.

### Setup Types and Hardware Layouts
- **SetupTypes**: Defines the deployment backend (e.g., `TT_INFERENCE_SERVER`) [app/backend/shared_config/model_config.py:54](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L54).
- **DeviceConfigurations**: Maps to specific Tenstorrent board layouts.
    - `N150`: Single Wormhole chip [app/backend/shared_config/models_from_inference_server.json:13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L13).
    - `N300`: Dual Wormhole chips [app/backend/shared_config/models_from_inference_server.json:15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L15).
    - `T3K`: Quad-chip configuration [app/backend/shared_config/models_from_inference_server.json:19](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L19).
    - `GALAXY`: High-density cluster [app/backend/shared_config/models_from_inference_server.json:13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L13).
    - `P300x2`: Dual Blackhole configuration [app/backend/shared_config/models_from_inference_server.json:18](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L18).

### Model ID and Naming
The `ModelImpl` class automatically generates a `model_id` if not provided, using the format `id_{impl_id}-{model_name}-v{version}` [app/backend/shared_config/model_config.py:152-153](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L152-L153). It also defaults the `model_name` to the basename of the `hf_model_id` if the name is missing [app/backend/shared_config/model_config.py:144-146](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L144-L146).

### Natural Language to Code Entity Mapping: Path Resolution
This diagram shows how `ModelImpl` properties resolve host paths to container paths for persistent storage.

Title: Model Storage Path Resolution
```mermaid
graph LR
    ModelImpl["ModelImpl Instance"] -- "host_path" --> HostDir["/opt/tt_studio/data/volume_{model_id}"]
    ModelImpl -- "volume_path" --> VolDir["/app/data/volume_{model_id}"]
    
    subgraph "Docker Volume Mapping"
        HostDir -- "binds to" --> ContDir["model_container_cache_root"]
    end
    
    ModelImpl -- "get_volume_mounts()" --> Mounts["docker_config['volumes']"]
    Mounts -- "defines" --> HostDir
```
**Sources:**
- Path properties: [app/backend/shared_config/model_config.py:105-139](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L105-L139)
- Volume mounting: [app/backend/shared_config/model_config.py:170-186](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L170-L186)

## Model Environment Management

Model implementations often require specific environment variables for tuning (e.g., `VLLM_RPC_TIMEOUT`). TT-Studio manages these through a tiered system:

1.  **Catalog Defaults**: Defined in the `env_vars` section of `models_from_inference_server.json`. Values are coerced to strings during synchronization to ensure compatibility with Docker environment configuration [app/backend/shared_config/sync_models_from_inference_server.py:174-186](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L174-L186).
2.  **Persistent Overrides**: The `ModelImpl.get_model_env_file()` function searches for a file named `{model_name}.env` in the `model_envs` directory within the persistent storage volume [app/backend/shared_config/model_config.py:155-168](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L155-L168).
3.  **JWT Secret Protection**: The system explicitly excludes `JWT_SECRET` from model-specific env files during loading to ensure the global `tt-studio` secret is used for inter-service authentication [app/backend/shared_config/model_config.py:25-26, 38](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py:25-26, 38).
4.  **Coding Agent & Reasoning**: 
    - Models eligible for coding-agent native tool calling (e.g., `Qwen3-32B`, `Llama-3.3-70B-Instruct`) are defined in `CODING_AGENT_ELIGIBLE_MODELS` [app/backend/shared_config/coding_agent_config.py:13-18](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/coding_agent_config.py#L13-L18).
    - Reasoning models like `Qwen3-32B` can be deployed with a specific reasoning parser (e.g., `qwen3`) to split reasoning into `reasoning_content` [app/backend/shared_config/coding_agent_config.py:23-27](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/coding_agent_config.py#L23-L27).
    - The system supports a `-thinking` suffix for requested gateway models to enable reasoning mode [app/backend/shared_config/coding_agent_config.py:31, 62-70](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/coding_agent_config.py:31, 62-70).

**Sources:**
- Environment loading: [app/backend/shared_config/model_config.py:21-40](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L21-L40)
- Env file discovery: [app/backend/shared_config/model_config.py:155-168](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L155-L168)
- Catalog Env Vars: [app/backend/shared_config/models_from_inference_server.json:114-119](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L114-L119)
- Coding Agent Config: [app/backend/shared_config/coding_agent_config.py:10-71](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/coding_agent_config.py#L10-L71)30:T1d9e,# Dummy Echo Model Reference Implementation
