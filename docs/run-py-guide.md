# Using `run.py` - Complete Guide

The `run.py` script automates the complete TT-Studio setup process, including environment configuration, Docker services, and the TT Inference Server setup.

## Table of Contents
1. [Basic Usage](#basic-usage)
2. [Command-Line Options](#command-line-options)
3. [Environment Configuration](#environment-configuration)
4. [Automatic Tenstorrent Hardware Detection](#automatic-tenstorrent-hardware-detection)
5. [Authentication Requirements](#authentication-requirements)
6. [Common Operations](#common-operations)

---

## Basic Usage

To use the setup script, run:

```bash
python run.py [options]
```

The script will guide you through all configuration options and set up everything automatically. You'll be prompted to provide:
- JWT_SECRET for authentication
- HF_TOKEN (Hugging Face token) for accessing models
- DJANGO_SECRET_KEY for backend security
- TAVILY_API_KEY for search functionality (optional)
- Other optional configuration options

> **Note**: The setup script automatically handles submoduling of the TT Inference Server. If submodule initialization fails during setup, you can manually initialize the submodules using:
> ```bash
> git submodule update --init --recursive
> ```
> This will clone the TT Inference Server repository as a submodule, which is required for running vLLM based models on a Tenstorrent device.

---

## Command-Line Options

| Option          | Description                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| `--help`        | Display help message with usage details.                                     |
| `--dev`         | Run in development mode with suggested defaults.                             |
| `--cleanup`     | Stop and remove all Docker services.                                         |
| `--cleanup-all` | Clean up everything including persistent data and .env file.                 |
| `--skip-fastapi`| Skip TT Inference Server FastAPI setup.                                      |
| `--no-sudo`     | Skip sudo usage for FastAPI setup.                                           |
| `--help-env`    | Show help for environment variables.                                         |

> **Important**: The `--skip-fastapi` option disables chat-based language models (LLMs) functionality. Only computer vision models (YOLO), image generation models (Stable Diffusion), and speech recognition models (Whisper) will be available for deployment and inference.

> **AI Playground Mode**: To use TT-Studio as a frontend for all model types (LLMs, YOLO, Whisper, Stable Diffusion), set `VITE_ENABLE_DEPLOYED=true` in your `.env` file and configure the corresponding model endpoints. See the [Model Interface Guide](../docs/model-interface.md) for details.

To display the same help section in the terminal, run:

```bash
python run.py --help
```

---

## Environment Configuration

The `run.py` script manages environment configuration through the `.env` file located in the `app/` directory. During setup, it uses `app/.env.default` as a template with placeholder values that are replaced with your inputs.

### Default Environment Template

The default environment template (`app/.env.default`) contains the following structure:

```
# TT Studio Environment Configuration
# This file contains default/placeholder values that will be replaced during setup

# Core Application Paths (auto-configured)
TT_STUDIO_ROOT=<PATH_TO_ROOT_OF_REPO>
HOST_PERSISTENT_STORAGE_VOLUME=${TT_STUDIO_ROOT}/tt_studio_persistent_volume
INTERNAL_PERSISTENT_STORAGE_VOLUME=/tt_studio_persistent_volume
BACKEND_API_HOSTNAME=tt-studio-backend-api

# Security Credentials (REQUIRED - keep secret in production!)
JWT_SECRET=test-secret-456
DJANGO_SECRET_KEY=django-insecure-default
HF_TOKEN=hf_***

# Optional Services
TAVILY_API_KEY=tvly-xxx

# Application Configuration
VITE_APP_TITLE="TT Studio"

# Application Modes
VITE_ENABLE_DEPLOYED=true or false to enable deployed mode
VITE_ENABLE_RAG_ADMIN=true or false to enable RAG admin

# RAG Configuration (required if VITE_ENABLE_RAG_ADMIN=true)
RAG_ADMIN_PASSWORD=tt-studio-rag-admin-password

# Cloud/External Model APIs (only used when VITE_ENABLE_DEPLOYED=true)
# Chat UI
CLOUD_CHAT_UI_URL=cloud llama chat ui url
CLOUD_CHAT_UI_AUTH_TOKEN=cloud llama chat ui auth token

# Computer Vision
CLOUD_YOLOV4_API_URL=
CLOUD_YOLOV4_API_AUTH_TOKEN=

# Speech Recognition
CLOUD_SPEECH_RECOGNITION_URL=
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN=

# Image Generation
CLOUD_STABLE_DIFFUSION_URL=
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN=
```

### Configuration Process

When you run `python run.py`, the script:

1. **Checks for an existing `.env` file**:
   - If none exists, it creates one from `.env.default`
   - If one exists, it asks whether to keep existing values or reconfigure all

2. **Prompts for required values**:
   - Replaces placeholder values with your inputs
   - In development mode (`--dev`), offers sensible defaults
   - Securely handles sensitive information like tokens and passwords

3. **Handles special configuration modes**:
   - Configures AI Playground mode when `VITE_ENABLE_DEPLOYED=true`
   - Sets up RAG admin interface when `VITE_ENABLE_RAG_ADMIN=true`
   - Configures cloud model endpoints when in AI Playground mode

### Environment Variables Reference

| Category | Variable | Description | Required |
|----------|----------|-------------|----------|
| **Core Paths** | TT_STUDIO_ROOT | Repository root path | Auto-configured |
| | HOST_PERSISTENT_STORAGE_VOLUME | Host storage path | Auto-configured |
| | INTERNAL_PERSISTENT_STORAGE_VOLUME | Container storage path | Auto-configured |
| | BACKEND_API_HOSTNAME | Backend API hostname | Auto-configured |
| **Security** | JWT_SECRET | JWT authentication secret | Yes |
| | DJANGO_SECRET_KEY | Django security key | Yes |
| | HF_TOKEN | Hugging Face API token | Yes |
| | TAVILY_API_KEY | Tavily search API key | Optional |
| **Application** | VITE_APP_TITLE | Application title | Yes |
| | VITE_ENABLE_DEPLOYED | Enable AI Playground mode | Yes |
| | VITE_ENABLE_RAG_ADMIN | Enable RAG admin interface | Yes |
| | RAG_ADMIN_PASSWORD | RAG admin password | If RAG enabled |
| **Cloud Models** | CLOUD_*_URL | Model endpoint URLs | If AI Playground enabled |
| | CLOUD_*_AUTH_TOKEN | Model authentication tokens | If AI Playground enabled |

To view detailed help about environment variables, run:
```bash
python run.py --help-env
```

---

## Automatic Tenstorrent Hardware Detection

The startup script now automatically detects Tenstorrent hardware by checking for `/dev/tenstorrent`. When hardware is detected:

1. The appropriate Docker configuration is applied automatically
2. Container access to hardware is configured
3. A confirmation message is displayed during startup

You can still use the `--tt-hardware` flag to explicitly enable hardware support if needed.

> ⚠️ **Note**: Tenstorrent hardware is now automatically detected and enabled. The script will automatically mount `/dev/tenstorrent` when present, eliminating the need for manual configuration.

---

## Authentication Requirements

When running the startup script, you'll need to provide the following credentials:

### 1. JWT_SECRET
A secret key used for JWT token authentication.
- This is required for secure API communication between components.
- You can use any strong secret string of your choice.

### 2. HF_TOKEN
Your Hugging Face API token.
- Required for downloading models from the Hugging Face Hub.
- Obtain this token by signing up at [Hugging Face](https://huggingface.co/settings/tokens).
- Make sure your token has appropriate permissions to access the models you need.

### 3. DJANGO_SECRET_KEY
- Used by the Django backend for cryptographic operations.
- Automatically generated if not provided.

### 4. TAVILY_API_KEY
- Required for web search capabilities in AI agents.
- You can obtain a free key from [Tavily](https://tavily.com/).

### 5. Sudo Access
- The FastAPI server requires sudo privileges to run on port 8001.
- You'll be prompted for your sudo password during startup.
- This is necessary for proper communication between components and hardware access.

These credentials are securely used by the TT Inference Server to authenticate requests, access model repositories, and interact with hardware when available.

---

## Common Operations

### Starting TT-Studio
```bash
python run.py
```

### Running in Development Mode
```bash
python run.py --dev
```

### Stopping and Cleaning Up
```bash
python run.py --cleanup
```

### Complete Cleanup (including data)
```bash
python run.py --cleanup-all
```

### Running on Remote Machine
To forward traffic between your local machine and a remote server, enabling you to access the frontend application in your local browser:

```bash
# Port forward frontend (3000) and FastAPI (8001) to allow local access from the remote server
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 <username>@<remote_server>
```

---

For troubleshooting issues with `run.py`, please refer to our [Troubleshooting Guide](troubleshooting.md). 