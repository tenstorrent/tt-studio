# Quick Start Guide

Complete provisioning walkthrough for TT-Studio.

## Prerequisites

Before provisioning TT-Studio, ensure the following are installed and configured:

**Hardware Setup**

Complete the base Tenstorrent software installation first:
[Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html)

This covers hardware setup, driver installation, and system configuration.

**Software Dependencies**

| Dependency | Version | Installation |
|-----------|---------|-------------|
| Python | 3.8+ | [python.org](https://www.python.org/downloads/) |
| Docker Engine | Latest | [docker.com](https://docs.docker.com/engine/install/) |
| Docker Compose | V2 | Included with Docker Engine |

**Docker Group Membership**

Add your user to the `docker` group to run Docker commands without `sudo`:

```bash
sudo usermod -aG docker $USER
```

Log out and log back in for the group change to take effect. Verify:

```bash
groups | grep docker
```

## Provisioning

### Standard Setup

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py
```

The setup script prompts for:

| Configuration | Description |
|--------------|-------------|
| HF_TOKEN | Hugging Face API token for model downloads |
| JWT_SECRET | Authentication token secret |
| DJANGO_SECRET_KEY | Backend security key |

### Quick Setup (Evaluation Only)

For rapid evaluation with default configuration values:

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py --easy
```

Easy mode uses default values for all secrets except `HF_TOKEN`. This mode is intended for development and testing only, not production deployments.

### Development Setup

For active development with live reload:

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py --dev
```

Development mode enables:
- Hot reload on code changes (frontend and backend)
- Volume-mounted source code for real-time iteration
- Debug logging

See [Development Guide](development.md) and [Contributing Guide](../CONTRIBUTING.md) for details.

## What Provisioning Does

The `run.py` script performs the following:

1. Verifies Docker installation and permissions
2. Initializes submodules (TT Inference Server and dependencies)
3. Configures environment variables (`.env` file)
4. Creates the `tt_studio_network` Docker bridge network
5. Builds and starts containers (frontend, backend, agent, ChromaDB)
6. Starts the TT Inference Server FastAPI service
7. Starts the Docker Control Service

## Services and Ports

After provisioning, the following services are available:

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | Experience layer (web interface) |
| Backend API | 8000 | Control plane (REST API) |
| TT Inference Server | 8001 | Model deployment API |
| Docker Control Service | 8002 | Container management API |
| Agent | 8080 | AI agent service |
| ChromaDB | 8111 | Vector database |
| Model Containers | 8002+ | Deployed model inference endpoints |

Open [http://localhost:3000](http://localhost:3000) to access the experience layer.

## Deploying a Model

1. Navigate to the deployment page in the web interface
2. Select a model from the catalog (filtered by your detected hardware)
3. Choose a device slot (for multi-chip systems)
4. Deploy — the system pulls the container image, binds the device, and starts serving

Deployment progress is streamed in real-time.

## Available Interactions

Once a model is deployed:

- **Chat** — Conversational AI with streaming responses
- **RAG** — Upload documents, build knowledge bases, query with semantic search
- **Image Generation** — Text-to-image with Stable Diffusion, FLUX, and Motif models
- **Object Detection** — Image classification and detection with CNN models
- **Speech-to-Text** — Audio transcription with Whisper models
- **Voice Pipeline** — End-to-end STT to LLM to TTS chain
- **AI Agent** — Autonomous agent with tool use and model auto-discovery
- **API Info** — View OpenAI-compatible API documentation per deployed model

## Cleanup

Stop all services and remove containers:

```bash
python3 run.py --cleanup
```

Full cleanup including persistent data:

```bash
python3 run.py --cleanup-all
```

## CLI Reference

| Flag | Description |
|------|-------------|
| `--easy` | Quick setup with defaults (evaluation only) |
| `--dev` | Development mode with live reload |
| `--cleanup` | Stop services, remove containers |
| `--cleanup-all` | Full cleanup including persistent data |
| `--reconfigure` | Clear saved preferences and reconfigure |
| `--skip-fastapi` | Skip TT Inference Server setup |
| `--device-id N` | Pin deployment to specific chip slot |
| `--auto-deploy MODEL` | Auto-deploy a model after startup |

See [run.py Guide](run-py-guide.md) for full CLI documentation.

## Remote Access

If TT-Studio runs on a remote server, use SSH port forwarding:

```bash
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 -L 8002-8012:localhost:8002-8012 user@server
```

Then open [http://localhost:3000](http://localhost:3000) in your local browser.

See [Remote Endpoint Setup](remote-endpoint-setup.md) for connecting to remote inference endpoints without local hardware.

## Troubleshooting

See [Troubleshooting Guide](troubleshooting.md) and [FAQ](FAQ.md).
