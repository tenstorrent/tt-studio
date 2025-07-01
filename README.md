# TT-Studio
TT-Studio is a comprehensive platform for deploying and managing TT-Metal based models in TT-Inference Server-ized Docker containers optimized for Tenstorrent hardware. It combines [TT Inference Server's](https://github.com/tenstorrent/tt-inference-server) core packaging setup, containerization, and deployment automation with [TT-Metal's](https://github.com/tenstorrent-metal/tt-metal) model execution framework specifically optimized for Tenstorrent hardware and provides an intuitive GUI for model management and interaction. This guide explains how to use TT-Studio in both standard and development environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Quick Start](#quick-start)  
   - [For General Users](#for-general-users)
4. [Running in Development Mode](#running-in-development-mode)
5. [Troubleshooting](#troubleshooting)
6. [Documentation](#documentation)
   - [Frontend Documentation](#frontend-documentation)
   - [Backend API Documentation](#backend-api-documentation)
   - [Running vLLM Models in TT-Studio](#running-vllm-models-and-mock-vllm-model-in-tt-studio)  
   - [Running AI Agent with Chat LLM Models in TT-Studio](#running-ai-agent-in-tt-studio)

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

### For General Users

To set up TT-Studio:

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/tenstorrent/tt-studio.git
   cd tt-studio
   ```

2. **Run the Setup Script**:

   Run the `run.py` script:

   ```bash
   # On Linux
   python run.py
   
   # On macOS
   python3 run.py
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
   > This will clone the TT Inference Server repository as a submodule, which is required for the running vLLM based models on a Tenstorrent device.

   #### See this [section](#command-line-options) for more information on command-line arguments available within the setup script.

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
---

## Running in Development Mode

Developers can run the app with live code reloading for easier development.

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

- **Frequently Asked Questions (FAQ)**: [docs/FAQ.md](docs/FAQ.md)  
  A compilation of frequently asked questions to help users quickly solve common issues.
