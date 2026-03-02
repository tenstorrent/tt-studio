<p align="center">
  <img src="https://raw.githubusercontent.com/tenstorrent/tt-metal/main/docs/source/common/images/favicon.png" width="120" height="120" />
</p>

<h1 align="center">TT-Studio</h1>

<p align="center">
  <em>Reference blueprint for deploying and orchestrating AI inference on Tenstorrent hardware</em>
</p>

---

TT-Studio is a reference blueprint that composes [TT Inference Server](https://github.com/tenstorrent/tt-inference-server) microservices into a managed, multi-model platform. It handles device allocation, container orchestration, and lifecycle management — and ships with 60+ pre-configured models across Wormhole, Blackhole, and Galaxy hardware.

Where TT Inference Server serves a single model on a single device, TT-Studio orchestrates multiple models concurrently with a unified control plane and experience layer.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Experience Layer          Web UI for all blueprint workflows │
├───────────────────────────────────────────────────────────────┤
│  Control Plane             REST API · Routing · Health        │
├───────────────────────────────────────────────────────────────┤
│  Orchestration             Docker · TT Inference Server · Ports│
├───────────────────────────────────────────────────────────────┤
│  Runtime                   vLLM · Media Engine · Forge        │
├───────────────────────────────────────────────────────────────┤
│  Hardware                  Wormhole · Blackhole · Galaxy      │
└───────────────────────────────────────────────────────────────┘
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
| Hardware | Tenstorrent accelerator (or [remote endpoint](docs/remote-endpoint-setup.md)) |
| Drivers | [Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html) |

## Software Used

**Tenstorrent Technology**
- [TT-Metal](https://github.com/tenstorrent-metal/tt-metal) — Execution framework
- [TT Inference Server](https://github.com/tenstorrent/tt-inference-server) — Model serving microservice
- TT-SMI — Device management

**Inference Engines**
- vLLM (LLM/VLM) · Media Engine (Image/TTS/Video/STT) · Forge (CNN/Embedding)

**Third-Party**
- ChromaDB · Docker Compose · React · Django REST Framework · FastAPI

---

## Quick Start

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py
```

Open [http://localhost:3000](http://localhost:3000) after provisioning completes. See [Quick Start Guide](docs/quickstart.md) for full details.

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start Guide](docs/quickstart.md) | Full provisioning walkthrough |
| [Model Catalog](docs/model-catalog.md) | All 60 supported models by type and hardware |
| [CLI Reference](docs/run-py-guide.md) | run.py modes and flags |
| [Remote Endpoints](docs/remote-endpoint-setup.md) | Cloud and remote access configuration |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [Contributing](CONTRIBUTING.md) | Development workflow and guidelines |
