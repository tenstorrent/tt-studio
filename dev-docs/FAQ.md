# Frequently Asked Questions

This FAQ covers general questions about TT-Studio. For specific troubleshooting guidance, please refer to our [Troubleshooting Guide](troubleshooting.md).

## Table of Contents 
1. [General Questions](#general-questions)
2. [Installation Questions](#installation-questions)
3. [Usage Questions](#usage-questions)

## General Questions

### What is TT-Studio?
TT-Studio is a comprehensive environment for deploying and interacting with Tenstorrent models, providing a unified frontend interface for various AI models including chat-based Language Models, Computer Vision, Speech Recognition, and Image Generation.

### Do I need Tenstorrent hardware to use TT-Studio?
No, TT-Studio can run without Tenstorrent hardware. Without TT hardware, you can still use TT-Studio as a frontend interface by connecting to external model endpoints. When Tenstorrent hardware is present, the system automatically detects and utilizes it for better performance.

## Installation Questions

### What are the minimum system requirements?
- Python 3.8 or higher
- Docker
- Sufficient disk space for Docker images and model weights

### How do I update TT-Studio?
Pull the latest code from the repository and run the setup script again:
```bash
git pull
python run.py
```

### Does setup always build the Docker images locally?
No. `run.py` first tries to pull prebuilt images from
`ghcr.io/tenstorrent/tt-studio/*`, pinned to your exact checkout: the release
tag when you're on one (e.g. `v2.9.0`), otherwise `sha-<12 chars of HEAD>`.
Images are published on releases, so checkouts of a tagged release get a
download instead of a build.

`run.py` falls back to building locally — automatically and without failing —
whenever the pull can't succeed or would produce the wrong bits:

- your commit has no published image (feature branch, `dev` between releases)
- `app/` has local modifications
- you customized frontend settings (`VITE_APP_TITLE`, `VITE_ENABLE_DEPLOYED`,
  `VITE_ENABLE_RAG_ADMIN`) in non-dev mode — those are baked into the
  published frontend image at build time
- you're offline or the registry is unreachable (locally cached images are
  reused when present)
- you're on a CPU architecture without published images (only linux/amd64 is
  published today)

To skip the pull entirely, run `python run.py --build-images`. To pull from a
mirror or a private/local registry, set `TT_STUDIO_IMAGE_REGISTRY` in `.env`
(and `docker login` to it first if it requires authentication).

## Usage Questions

### How can I use TT-Studio as an AI playground?
You can use TT-Studio as a comprehensive AI playground by setting `VITE_ENABLE_DEPLOYED=true` in your `.env` file and configuring the endpoints for various model types. This allows you to interact with external models through TT-Studio's unified interface for chat-based Language Models (LLMs), Computer Vision (YOLO), Speech Recognition (Whisper), and Image Generation (Stable Diffusion) without requiring local model deployment.

### Can I use TT-Studio for commercial purposes?

---

For specific issues you might encounter while using TT-Studio, please check our [Troubleshooting Guide](troubleshooting.md).
