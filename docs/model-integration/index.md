# Model Integration & Dummy Echo Model

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py">app/backend/docker_control/deployment_sync.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/logs_control/views.py">app/backend/logs_control/views.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json">app/backend/shared_config/models_from_inference_server.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/Dockerfile">models/dummy_echo_model/Dockerfile</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/src/inference_api_server.py">models/dummy_echo_model/src/inference_api_server.py</a></li>
</ul>
</details>



This section provides an overview of how AI models are integrated into the TT-Studio ecosystem. Integration is driven by a standardized configuration schema that allows the TT-Studio backend to manage the lifecycle of containerized inference servers, handle hardware requirements for Tenstorrent chips, and provide a unified API for the frontend.

## Model Integration Overview

Models in TT-Studio are treated as independent, containerized services. The integration relies on two primary components:
1.  **Model Implementation (`ModelImpl`)**: A Python dataclass that defines the static configuration of a model, including its Docker image, environment variables, and hardware compatibility [app/backend/shared_config/model_config.py:44-67](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L44-L67).
2.  **Model Catalog**: A JSON-based registry (`models_from_inference_server.json`) that lists all available models and their specific deployment parameters, such as `device_configurations` and `inference_engine` [app/backend/shared_config/models_from_inference_server.json:7-38](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L7-L38).

The catalog is maintained via a synchronization script, `sync_models_from_inference_server.py`, which normalizes specs from the `tt-inference-server` artifacts into the Studio's format [app/backend/shared_config/sync_models_from_inference_server.py:5-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L5-L11).

The following diagram illustrates how natural language model definitions are mapped to the codebase entities that manage them.

**Model Integration: From Concept to Code**
```mermaid
graph TD
    subgraph "Natural_Language_Space"
        A["'Llama 3.1 8B Model'"]
        B["'Wormhole N150 Support'"]
        C["'Inference Server Image'"]
    end

    subgraph "Code_Entity_Space"
        D["ModelImpl_Class"]
        E["DeviceConfigurations_Enum"]
        F["models_from_inference_server.json"]
        G["docker_control_app"]
        H["sync_models_from_inference_server.py"]
    end

    A -->|"Registered_in"| F
    F -->|"Instantiates"| D
    B -->|"Defined_by"| E
    D -->|"Includes"| E
    C -->|"Stored_in"| D
    D -->|"Consumed_by"| G
    H -->|"Generates"| F
```

Sources: [app/backend/shared_config/model_config.py:44-67](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L44-L67), [app/backend/shared_config/models_from_inference_server.json:7-38](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L7-L38), [app/backend/shared_config/device_config.py:11-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/device_config.py#L11-L11), [app/backend/shared_config/sync_models_from_inference_server.py:22-22](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/sync_models_from_inference_server.py#L22-L22).

---

## Model Configuration & Catalog

The `ModelImpl` class is the central configuration object for any model integrated into TT-Studio. It encapsulates metadata such as `image_name`, `service_route`, and `device_configurations` [app/backend/shared_config/model_config.py:49-55](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L49-L55). This configuration is used to dynamically generate Docker deployment parameters, including volume mounts for HuggingFace caches and Tenstorrent device dispatch headers [app/backend/shared_config/model_config.py:73-88](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/model_config.py#L73-L88).

The catalog `models_from_inference_server.json` provides the source of truth for supported models like `distil-large-v3`, `Llama-3.1-8B-Instruct`, or `mochi-1-preview`, specifying their `setup_type`, `model_type`, and `docker_image` [app/backend/shared_config/models_from_inference_server.json:8-192](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/shared_config/models_from_inference_server.json#L8-L192). When models are deployed, the `deployment_sync.py` module manages the transition from a `starting` state to `running` by polling the inference API and updating the `ModelDeployment` record [app/backend/docker_control/deployment_sync.py:5-54](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py#L5-L54).

For details on schema fields, chip requirement inference, and the model catalog, see **[Model Configuration & Catalog](config-and-catalog.md)**.

---

## Dummy Echo Model Reference Implementation

To facilitate the development of new model integrations, TT-Studio provides a reference implementation called the `dummy_echo_model`. This is a fully functional, containerized Flask application that simulates an LLM's behavior by "echoing" input text back to the user at a controlled tokens-per-second (TPS) rate.

The reference implementation demonstrates:
*   **Multiprocessing Architecture**: Separating the Flask API server from the "inference" backend using `multiprocessing.Process` to prevent blocking the request handling thread [models/dummy_echo_model/src/inference_api_server.py:115-124](https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/src/inference_api_server.py#L115-L124).
*   **Resource Management**: Using `psutil` to pin the backend process to specific NUMA nodes for performance isolation and setting process `niceness` [models/dummy_echo_model/src/inference_api_server.py:126-140](https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/src/inference_api_server.py#L126-L140).
*   **Standardized API**: Implementing `/health` checks and inference routes that match the TT-Studio expectations for container health monitoring [models/dummy_echo_model/Dockerfile:64-64](https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/Dockerfile#L64-L64).
*   **Dockerization**: A complete `Dockerfile` that sets up a Python environment, installs requirements, and runs the service via `gunicorn` [models/dummy_echo_model/Dockerfile:50-60](https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/Dockerfile#L50-L60).

**Reference Implementation Component Mapping**
```mermaid
graph LR
    subgraph "External_Interface"
        API["inference_api_server.py"]
        GNC["gunicorn.conf.py"]
        DKR["Dockerfile"]
    end

    subgraph "Internal_Logic"
        BND["dummy_echo_backend.py"]
        CFG["inference_config.py"]
        WGT["model_weights_handler.py"]
    end

    DKR -->|"Starts"| GNC
    GNC -->|"Wraps"| API
    API -->|"Reads"| CFG
    API -->|"Spawns"| BND
    BND -->|"Simulates_Inference"| BND
    BND -->|"Uses"| WGT
```

For a step-by-step breakdown of the reference implementation and how to use it as a template, see **[Dummy Echo Model Reference Implementation](dummy-echo-model.md)**.

Sources: [models/dummy_echo_model/src/inference_api_server.py:115-150](https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/src/inference_api_server.py#L115-L150), [models/dummy_echo_model/Dockerfile:50-64](https://github.com/tenstorrent/tt-studio/blob/c837b829/models/dummy_echo_model/Dockerfile#L50-L64), [app/backend/docker_control/deployment_sync.py:47-54](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/docker_control/deployment_sync.py#L47-L54).2f:T288e,# Model Configuration & Catalog


```{toctree}
:hidden:
:maxdepth: 2

config-and-catalog
dummy-echo-model
```
