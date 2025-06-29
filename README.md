# TT-Studio

TT-Studio enables rapid deployment of TT Inference servers locally and is optimized for Tenstorrent hardware. This guide explains how to set up and use TT-Studio in both standard and development modes.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Quick Start](#quick-start)  
   - [For General Users](#for-general-users)  
   - [For Developers](#for-developers)
4. [Using `startup.sh`](#using-startupsh)
   - [Basic Usage](#basic-usage)
   - [Command-Line Options](#command-line-options)
   - [Automatic Tenstorrent Hardware Detection](#automatic-tenstorrent-hardware-detection)
   - [Authentication Requirements](#authentication-requirements)
5. [Troubleshooting](#troubleshooting)
   - [Hardware Detection Issues](#hardware-detection-issues)
   - [Common Errors](#common-errors)
6. [Documentation](#documentation)
   - [Frontend Documentation](#frontend-documentation)
   - [Backend API Documentation](#backend-api-documentation)
   - [Running vLLM Models in TT-Studio](#running-vllm-models-and-mock-vllm-model-in-tt-studio)  
   - [Running AI Agent with Chat LLM Models in TT-Studio](#running-ai-agent-in-tt-studio)

---
## Prerequisites
1. Docker: Ensure that Docker is installed on your machine. You can refer to the installation guide [here](https://docs.docker.com/engine/install/).
2. Tenstorrent Hardware (optional): TT-Studio will automatically detect and use available Tenstorrent hardware.

## Overview
TT-Studio is a comprehensive environment for deploying and interacting with Tenstorrent models. It consists of:

- **Frontend Interface**: A modern React-based UI for model interaction
- **Backend API**: Django-based service for model management and deployment
- **TT Inference Server**: FastAPI server for handling model inference requests
- **Docker Containers**: For isolation and easy deployment
- **Automatic Hardware Detection**: Seamless integration with Tenstorrent devices

---
## Quick Start

### For General Users

To set up TT-Studio:

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/tenstorrent/tt-studio.git
   cd tt-studio
   ```
2. **Choose and Set Up the Model**:

   Select your desired model and configure its corresponding weights by following the instructions in [HowToRun_vLLM_Models.md](./docs/HowToRun_vLLM_Models.md).

3. **Run the Startup Script**:

   Run the `startup.sh` script:

   ```bash
   ./startup.sh
   ```

   You'll be prompted to provide:
   - JWT_SECRET for authentication
   - HF_TOKEN (Hugging Face token) for accessing models
   - DJANGO_SECRET_KEY for backend security
   - TAVILY_API_KEY for search functionality
   - Other optional configuration options

   #### See this [section](#command-line-options) for more information on command-line arguments available within the startup script.

4. **Access the Application**:

   The app will be available at [http://localhost:3000](http://localhost:3000).
   The FastAPI server runs on [http://localhost:8001](http://localhost:8001).

5. **Cleanup**:
   - To stop and remove Docker services, run:
     ```bash
     ./startup.sh --cleanup
     ```
6. Running on a Remote Machine

   To forward traffic between your local machine and a remote server, enabling you to access the frontend application in your local browser, follow these steps:

   Use the following SSH command to port forward both the frontend and backend ports:

   ```bash
   # Port forward frontend (3000) and FastAPI (8001) to allow local access from the remote server
   ssh -L 3000:localhost:3000 -L 8001:localhost:8001 <username>@<remote_server>
   ```

> ⚠️ **Note**: Tenstorrent hardware is now automatically detected and enabled. The script will automatically mount `/dev/tenstorrent` when present, eliminating the need for manual configuration.
---

## Running in Development Mode

Developers can run the app with live code reloading for easier development.

1. **Start the Application in Dev Mode**:

   Run the `startup.sh` script with the dev flag:

   ```bash
   ./startup.sh --dev
   ```

   In development mode, the frontend and backend code will be mounted inside the container. Any changes in code will be reflected inside the container automatically.

2. **Hot Reload & Debugging**:

   #### Frontend
   - Local files in `./app/frontend` are mounted within the container for development.
   - Code changes trigger an automatic rebuild and redeployment of the frontend.

   #### Backend
   - Local files in `./app/backend` are mounted within the container for development.
   - Code changes trigger an automatic rebuild and redeployment of the backend.

3. **Stopping the Services**:

   To shut down the application and remove running containers:
   ```bash
   ./startup.sh --cleanup
   ```

4. **Using the Mock vLLM Model**:

   - For local testing, you can use the `Mock vLLM` model, which generates a random set of characters as output.
   - Instructions to run it are available in the [HowToRun_vLLM_Models.md](./docs/HowToRun_vLLM_Models.md) guide.

---

## Using `startup.sh`

The `startup.sh` script automates the TT-Studio setup process, including the TT Inference Server setup.

### Basic Usage

To use the startup script, run:

```bash
./startup.sh [options]
```

### Command-Line Options

| Option          | Description                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| `--help`        | Display help message with usage details.                                     |
| `--cleanup`     | Stop and remove all Docker services.                                         |
| `--dev`         | Run in development mode with live code reloading.                            |
| `--tt-hardware` | Explicitly enable Tenstorrent hardware support (usually not needed due to auto-detection). |

To display the same help section in the terminal, one can run:

```bash
./startup.sh --help
```

### Automatic Tenstorrent Hardware Detection

The startup script now automatically detects Tenstorrent hardware by checking for `/dev/tenstorrent`. When hardware is detected:

1. The appropriate Docker configuration is applied automatically
2. Container access to hardware is configured
3. A confirmation message is displayed during startup

You can still use the `--tt-hardware` flag to explicitly enable hardware support if needed.

### Authentication Requirements

When running the startup script, you'll need to provide the following credentials:

1. **JWT_SECRET**: A secret key used for JWT token authentication.
   - This is required for secure API communication between components.
   - You can use any strong secret string of your choice.

2. **HF_TOKEN**: Your Hugging Face API token.
   - Required for downloading models from the Hugging Face Hub.
   - Obtain this token by signing up at [Hugging Face](https://huggingface.co/settings/tokens).
   - Make sure your token has appropriate permissions to access the models you need.

3. **DJANGO_SECRET_KEY**:
   - Used by the Django backend for cryptographic operations.
   - Automatically generated if not provided.

4. **TAVILY_API_KEY**:
   - Required for web search capabilities in AI agents.
   - You can obtain a free key from [Tavily](https://tavily.com/).

5. **Sudo Access**:
   - The FastAPI server requires sudo privileges to run on port 8001.
   - You'll be prompted for your sudo password during startup.
   - This is necessary for proper communication between components and hardware access.

These credentials are securely used by the TT Inference Server to authenticate requests, access model repositories, and interact with hardware when available.

---

## Troubleshooting

### Hardware Detection Issues

If you see a "TT Board (Error)" message:

1. Check if `/dev/tenstorrent` is available and readable:
   ```bash
   ls -la /dev/tenstorrent
   ```

2. Verify the hardware is detected by running:
   ```bash
   tt-smi -s
   ```

3. Reset the board if necessary:
   ```bash
   tt-smi --softreset
   ```

4. Restart TT-Studio with explicit hardware support:
   ```bash
   ./startup.sh --cleanup
   ./startup.sh --tt-hardware
   ```

5. Verify container access to hardware:
   ```bash
   docker exec -it tt_studio_backend_api ls -la /dev/tenstorrent
   ```

### Common Errors

1. **Port 8001 already in use**:
   ```bash
   ./startup.sh --cleanup
   ```
   Then try starting again.

2. **Docker network issues**:
   ```bash
   docker network prune
   ```
   Then restart TT-Studio.

3. **FastAPI server fails to start**:
   Check the logs in `fastapi.log` for specific errors.

---

## Documentation

- **Frontend Documentation**: [app/frontend/README.md](app/frontend/README.md)  
  Detailed documentation about the frontend of TT Studio, including setup, development, and customization guides.

- **Backend API Documentation**: [app/backend/README.md](app/backend/README.md)  
  Information on the backend API, including available endpoints and integration details.

- **Running vLLM Models and Mock vLLM Model in TT-Studio**: [docs/HowToRun_vLLM_Models.md](docs/HowToRun_vLLM_Models.md)  
  Step-by-step instructions on how to configure and run the vLLM model(s) using TT-Studio.

- **Running AI Agent in TT-Studio**: [app/agent/README.md](app/agent/README.md)
   Instructions on how to run AI Agent by providing an API Key. 

- **Contribution Guide**: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)  
  If you're interested in contributing to the project, please refer to our contribution guidelines.

- **Frequently Asked Questions (FAQ)**: [docs/FAQ.md](docs/FAQ.md)  
  A compilation of frequently asked questions to help users quickly solve common issues.
