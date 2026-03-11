<p align="center">
  <img src="https://raw.githubusercontent.com/tenstorrent/tt-metal/main/docs/source/common/images/favicon.png" width="120" height="120" />
</p>

<h1 align="center">TT-Studio</h1>

<p align="center">
  <em>Reference blueprint illustrating how to leverage Tenstorrent inference technologies to build innovative AI solutions</em>
</p>

---

TT-Studio is a reference blueprint that demonstrates how to deploy and orchestrate AI models on Tenstorrent hardware. Built on the [TT Inference Server](https://github.com/tenstorrent/tt-inference-server), it provides a GUI-driven platform that handles device discovery, container orchestration, and model lifecycle management across the Tenstorrent hardware family—including Wormhole, Blackhole, and Galaxy systems.

## Architecture

<p align="center">
  <a href="docs/architecture/tt-studio-architecture.excalidraw">
    <img src="docs/architecture/tt-studio-architecture.png" alt="TT Studio Architecture" width="100%" />
  </a>
  <br/>
  <em>Interactive diagram: <a href="docs/architecture/tt-studio-architecture.excalidraw">View in Excalidraw</a></em>
</p>

    subgraph docker["Docker Compose"]
        direction TB
        Frontend["⚛️ tt_studio_frontend\nReact/Vite · :3000"]
        Backend["⚙️ tt_studio_backend\nDjango REST · :8000"]
        Agent["🤖 tt_studio_agent\nFastAPI · :8080"]
        Chroma[("🗄️ tt_studio_chroma\nChromaDB · :8111")]
    end

    subgraph host["Host"]
        DCS["🐳 docker-control-service\nFastAPI · :8002"]
    end

    subgraph inference["On-Demand Inference Containers"]
        direction TB
        vLLM["🧠 vLLM\nLLM / VLM"]
        Media["🎙️ Media Engine\nSTT · TTS · Vision"]
        Forge["🔩 Forge\nCNN · Embedding"]
    end

    subgraph hw["Tenstorrent Hardware"]
        HW["⚡ Wormhole · Blackhole · Galaxy"]
    end

    Browser --> Frontend
    Frontend -->|"deploy"| Backend
    Frontend -->|"inference"| Backend
    Frontend --> Agent
    Backend --> Chroma
    Backend -->|"JWT"| DCS
    DCS -->|"docker run"| vLLM & Media & Forge
    Backend -->|"proxy"| vLLM & Media & Forge
    Agent -->|"discovery"| vLLM
    vLLM & Media & Forge --> HW

    classDef browser fill:#1a1a4a,stroke:#6666cc,color:#ccccff
    classDef ui     fill:#0d3b6e,stroke:#1a6eb5,color:#cce4ff
    classDef api    fill:#0d4a2a,stroke:#1a8a4a,color:#ccffdd
    classDef orch   fill:#4a3800,stroke:#c9a000,color:#fff5cc
    classDef store  fill:#3a0d4a,stroke:#8a1ab5,color:#f0ccff
    classDef infer  fill:#4a1f00,stroke:#c95a00,color:#ffe0cc
    classDef hw     fill:#2a0a0a,stroke:#8a2020,color:#ffcccc

    class Browser browser
    class Frontend ui
    class Backend,Agent api
    class DCS orch
    class Chroma store
    class vLLM,Media,Forge infer
    class HW hw
```

---

## Blueprints

TT-Studio ships with eight reference blueprints — four multi-model pipelines and four single-model experiences. Each composes one or more TT Inference Server models into an end-to-end workflow.

### Pipelines

| Blueprint | Description |
|-----------|-------------|
| [RAG](docs/blueprints/rag.md) | Retrieval-augmented generation with ChromaDB vector storage and document upload |
| [AI Agent](docs/blueprints/ai-agent.md) | Autonomous assistant with tool use, model auto-discovery, and persistent threads |
| [Voice Pipeline](docs/blueprints/voice-pipeline.md) | STT &rarr; LLM &rarr; TTS — three models chained in a single SSE-streaming pipeline |
| [Object Detection](docs/blueprints/object-detection.md) | Image classification and detection using CNN models on Forge |

### Model Experiences

| Blueprint | Models | Description |
|-----------|--------|-------------|
| [LLM Chat](docs/blueprints/llm-chat.md) | 24 | Streaming chat with instruction-tuned LLMs (1B-120B) via vLLM |
| [Image Generation](docs/blueprints/image-generation.md) | 9 | Text-to-image with Stable Diffusion, FLUX, and Motif via Media Engine |
| [Vision Language Model](docs/blueprints/vlm.md) | 12 | Multimodal text+image chat with vision-language models via vLLM |
| [Video Generation](docs/blueprints/video-generation.md) | 2 | Text-to-video with Mochi and Wan via Media Engine |

---

## Supported Hardware

| Family | Devices | Topology |
|--------|---------|----------|
| **Wormhole** | E150, N150, N300, T3K | Single-chip, multi-chip, mesh |
| **Blackhole** | P100, P150, P300c, P150X4, P150X8 | Single-chip, multi-chip |
| **Galaxy** | GALAXY, GALAXY_T3K | Full-mesh interconnect |

## System Requirements

| Requirement | Specification |
|-------------|--------------|
| OS | Ubuntu 22.04+ |
| Python | 3.8+ |
| Docker | Docker Engine + Compose V2 |
| Hardware | Tenstorrent accelerator (or [remote endpoint.](docs/remote-endpoint-setup.md)) |
| Drivers | [Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html) |

## Software Used

**Tenstorrent Technology**
- [TT-Metal](https://github.com/tenstorrent-metal/tt-metal) — Execution framework
- [TT Inference Server](https://github.com/tenstorrent/tt-inference-server) — Model serving microservice
- [TT-SMI](https://github.com/tenstorrent/tt-smi) — Board reset and automatic TT board discovery

**Inference Engines**
- vLLM (LLM/VLM) · Media Engine (Image/TTS/Video/STT) · Forge (CNN/Embedding)

**Third-Party**
- ChromaDB · Docker Compose · React · Django REST Framework · FastAPI

---

## Quick Start

```bash
git clone https://github.com/tenstorrent/tt-studio.git && cd tt-studio && python3 run.py --easy
```

When prompted, enter your [Hugging Face token](https://huggingface.co/settings/tokens) so TT-Studio can pull models.

After provisioning completes, the UI may open automatically; if not, navigate to [http://localhost:3000](http://localhost:3000). On a remote machine, open that URL from your browser or set up port forwarding so you can reach the host’s port 3000. See the [Quick Start Guide](docs/quickstart.md) for full details.

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start Guide](docs/quickstart.md) | Full provisioning walkthrough |
| [Model Catalog](docs/model-catalog.md) | All 60 supported models by type and hardware |
| [CLI Reference](docs/run-py-guide.md) | run.py modes and flags |
| [Remote Endpoints](docs/remote-endpoint-setup.md) | Cloud and remote access configuration |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [Contributing](CONTRIBUTING.md) | Development workflow and guidelines |
