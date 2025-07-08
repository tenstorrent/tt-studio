
<p align="center">
  <img src="https://raw.githubusercontent.com/tenstorrent/tt-metal/main/docs/source/common/images/favicon.png" width="120" height="120" />
</p>

<h1 align="center">TT-Studio</h1>
<p align="center">An all-in-one platform with an interactive UI for deploying, managing, and interacting with TT-Metal–based models on Tenstorrent AI accelerators.</p>

> To use TT-Studio’s deployment features, you need access to a Tenstorrent AI accelerator.<br>
> Alternatively, you can connect just the frontend to a remote API endpoint if you do not have direct hardware access.


TT-Studio combines [TT Inference Server's](https://github.com/tenstorrent/tt-inference-server) core packaging setup, containerization, and deployment automation with [TT-Metal's](https://github.com/tenstorrent-metal/tt-metal) model execution framework specifically optimized for Tenstorrent hardware and provides an intuitive GUI for model management and interaction. 

This guide explains how to use TT-Studio in both standard and development environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Quick Start](#quick-start)
   - [One-Command Setup (Recommended)](#one-command-setup-recommended)
   - [For General Users](#for-general-users)
4. [Running in Development Mode](#running-in-development-mode)
5. [Troubleshooting](#troubleshooting)
6. [Documentation](#documentation)
   - [Frontend Documentation](app/frontend/README.md)
   - [Backend API Documentation](app/backend/README.md)
   - [Running vLLM Models in TT-Studio](docs/HowToRun_vLLM_Models.md)
   - [Running AI Agent in TT-Studio](app/agent/README.md)

---

## Prerequisites

1. Python 3.8 or higher: Required to run the setup script. You can download Python from [python.org](https://www.python.org/downloads/).
2. Docker: Ensure that Docker is installed on your machine. You can refer to the installation guide [here](https://docs.docker.com/engine/install/).
3. Tenstorrent Hardware (optional): TT-Studio will automatically detect and use available Tenstorrent hardware.

## Overview

TT-Studio is a comprehensive environment for deploying and interacting with Tenstorrent models. It consists of:

- **Frontend Interface**: A modern React-based UI for model interaction
- **Backend API**: Django-based service for model management and deployment
- **TT Inference Server**: FastAPI server for handling model inference requests
- **Docker Containers**: For isolation and easy deployment
- **Automatic Hardware Detection**: Seamless integration with Tenstorrent devices
- **Automated Setup**: Complete environment configuration and model setup automation

### Using TT-Studio as a Model Interface

TT-Studio provides a unified frontend interface for interacting with various AI models including:

- Chat-based Language Models (LLMs)
- Computer Vision (YOLO)
- Speech Recognition (Whisper)
- Image Generation (Stable Diffusion)

For detailed instructions on setting up and using these models, see our [Model Interface Guide](docs/model-interface.md).

> ⚠️ **Note**: The `startup.sh` script is deprecated and will be removed soon. Please use `python run.py` for all setup and management operations.

---

## Quick Start

### One-Command Setup (Recommended)

For the fastest setup experience, run this single command that will clone the repository with all submodules and start TT-Studio:

```bash
git clone --recurse-submodules https://github.com/tenstorrent/tt-studio.git && cd tt-studio && python3 run.py
```

This command will:

- Clone the TT-Studio repository
- Initialize and download all required submodules (including TT Inference Server)
- Automatically configure the environment
- Start all services

### For General Users

To set up TT-Studio step by step:

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/tenstorrent/tt-studio.git
   cd tt-studio
   ```

   > **Note**: You don't need to worry about `--recurse-submodules` - the setup script will automatically handle submodule initialization for you.

2. **Run the Setup Script**:

   Run the `run.py` script:

   ```bash
   # On Linux
   python run.py

   # On macOS
   python3 run.py
   ```

   The script will:

   - Automatically initialize and configure all required submodules (including TT Inference Server)
   - Guide you through all configuration options and set up everything automatically
   - Prompt you to provide:
     - JWT_SECRET for authentication
     - HF_TOKEN (Hugging Face token) for accessing models
     - DJANGO_SECRET_KEY for backend security
     - TAVILY_API_KEY for search functionality (optional)
     - Other optional configuration options

   > **Smart Submodule Handling**: The setup script automatically detects, initializes, and configures all required submodules, ensuring they're on the correct branches. No manual submodule management needed!

   #### See the [Complete `run.py` Guide](#documentation) for more information on command-line arguments available within the setup script.

3. **Access the Application**:

   The app will be available at [http://localhost:3000](http://localhost:3000).
   The FastAPI server runs on [http://localhost:8001](http://localhost:8001).

4. **Cleanup**:

   - To stop and remove Docker services, run:

     ```bash
     # On Linux
     python run.py --cleanup

     # On macOS
     python3 run.py --cleanup
     ```

5. **Running on a Remote Machine**:

   To forward traffic between your local machine and a remote server, enabling you to access the frontend application in your local browser, follow these steps:

   Use the following SSH command to port forward both the frontend and backend ports:

   ```bash
   # Port forward frontend (3000) and FastAPI (8001) to allow local access from the remote server
   ssh -L 3000:localhost:3000 -L 8001:localhost:8001 <username>@<remote_server>
   ```

> ⚠️ **Note**: Tenstorrent hardware is now automatically detected and enabled. The script will automatically mount `/dev/tenstorrent` when present, eliminating the need for manual configuration.

### Troubleshooting

If you encounter any issues with setup, submodules, or other problems, please refer to our comprehensive [Troubleshooting Guide](docs/troubleshooting.md).

---

## Running in Development Mode

Developers can run the app with live code reloading for easier development.

> **Prerequisites**: Ensure you have the repository cloned:
>
> ```bash
> git clone https://github.com/tenstorrent/tt-studio.git
> cd tt-studio
> ```
>
> > **Note**: You don't need to worry about `--recurse-submodules` - the setup script will automatically handle submodule initialization for you, just like in the standard setup process.

1. **Start the Application in Dev Mode**:

   Run the `run.py` script with the dev flag:

   ```bash
   # On Linux
   python run.py --dev

   # On macOS
   python3 run.py --dev
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
   # On Linux
   python run.py --cleanup

   # On macOS
   python3 run.py --cleanup
   ```

4. **Model Deployment**:

   - Models are automatically set up and deployed through the TT-Studio interface.
   - No manual model configuration is required - the FastAPI server handles all model setup automatically.

---

For detailed information about using the `run.py` script, including all command-line options, authentication requirements, and advanced usage scenarios, see our [Complete `run.py` Guide](docs/run-py-guide.md).

---

## Documentation

- **Frontend Documentation**: [app/frontend/README.md](app/frontend/README.md)  
  Detailed documentation about the frontend of TT Studio, including setup, development, and customization guides.

- **Backend API Documentation**: [app/backend/README.md](app/backend/README.md)  
  Information on the backend API, including available endpoints and integration details.

- **Running vLLM Models in TT-Studio**: Models are automatically set up and deployed through the TT-Studio interface. No manual configuration is required.

- **Running AI Agent in TT-Studio**: [app/agent/README.md](app/agent/README.md)
  Instructions on how to run AI Agent by providing an API Key.

- **Contribution Guide**: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)  
  If you're interested in contributing to the project, please refer to our contribution guidelines.

- **Complete `run.py` Guide**: [docs/run-py-guide.md](docs/run-py-guide.md)  
  Detailed documentation for using the `run.py` script, including all command-line options and authentication requirements.

- **Troubleshooting Guide**: [docs/troubleshooting.md](docs/troubleshooting.md)  
  Comprehensive solutions for common issues you might encounter with TT-Studio.

- **Developer Tools**: [dev-tools/README.md](dev-tools/README.md)  
  Development utilities and tools for TT-Studio, including the SPDX header tool for adding license headers to source files.

- **Frequently Asked Questions (FAQ)**: [docs/FAQ.md](docs/FAQ.md)  
  A compilation of frequently asked questions to help users quickly solve common issues.
