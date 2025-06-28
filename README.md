# TT-Studio

TT-Studio enables rapid deployment of TT Inference servers locally and is optimized for Tenstorrent hardware. This guide explains how to set up and use TT-Studio in both standard and development modes.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Quick Start](#quick-start)  
   - [For General Users](#for-general-users)  
      - Clone the Repository
      - Set Up the Model Weights.
      - Run the App via `startup.sh`
   - [For Developers](#for-developers)
4. [Using `startup.sh`](#using-startupsh)
   - [Basic Usage](#basic-usage)
   - [Command-Line Options](#command-line-options)
   - [Automatic Tenstorrent Hardware Detection](#automatic-tenstorrent-hardware-detection)
   - [Authentication Requirements](#authentication-requirements)
5. [Documentation](#documentation)
   - [Frontend Documentation](#frontend-documentation)
   - [Backend API Documentation](#backend-api-documentation)
   - [Running vLLM Models in TT-Studio](#running-vllm-models-and-mock-vllm-model-in-tt-studio)  
   - [Running AI Agent with Chat LLM Models in TT-Studio](#running-ai-agent-in-tt-studio)  

---
## Prerequisites
1. Docker: Ensure that Docker is installed on your machine. You can refer to the installation guide [here](https://docs.docker.com/engine/install/).

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
   ```abcd1234!
   

   You'll be prompted to provide:
   - JWT_SECRET for authentication
   - HF_TOKEN (Hugging Face token) for accessing models

   #### See this [section](#command-line-options) for more information on command-line arguments available within the startup script.

4. **Access the Application**:

   The app will be available at [http://localhost:3000](http://localhost:3000).

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

> ⚠️ **Note**: To use Tenstorrent hardware, during the run of `startup.sh` script, select "yes" when prompted to mount hardware. This will automatically configure the necessary settings, eliminating manual edits to docker compose files.
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
| `--tt-hardware` | Run with Tenstorrent hardware support enabled.                               |

To display the same help section in the terminal, one can run:

```bash
./startup.sh --help
```

### Automatic Tenstorrent Hardware Detection

If a Tenstorrent device (`/dev/tenstorrent`) is detected, the script will prompt you to mount it. Alternatively, you can use the `--tt-hardware` flag to explicitly enable hardware support.

### Authentication Requirements

When running the startup script, you'll need to provide the following credentials:

1. **JWT_SECRET**: A secret key used for JWT token authentication.
   - This is required for secure API communication between components.
   - You can use any strong secret string of your choice.

2. **HF_TOKEN**: Your Hugging Face API token.
   - Required for downloading models from the Hugging Face Hub.
   - Obtain this token by signing up at [Hugging Face](https://huggingface.co/settings/tokens).
   - Make sure your token has appropriate permissions to access the models you need.

3. **Sudo Access**:
   - The FastAPI server requires sudo privileges to run on port 8001.
   - You'll be prompted for your sudo password during startup.
   - This is necessary for proper communication between components and hardware access.

These credentials are securely used by the TT Inference Server to authenticate requests, access model repositories, and interact with hardware when available.

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
