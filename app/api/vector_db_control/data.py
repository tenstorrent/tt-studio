# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

TT_INFERENCE_SERVER = """
# TT-Inference-Server

Tenstorrent Inference Server (`tt-inference-server`) is the repo of available model APIs for deploying on Tenstorrent hardware.

## Official Repository

[https://github.com/tenstorrent/tt-inference-server](https://github.com/tenstorrent/tt-inference-server/)


## Getting Started
Please follow setup instructions for the model you want to serve, `Model Name` in tables below link to corresponding implementation.

Note: models with Status [🔍 preview] are under active development. If you encounter setup or stability problems please [file an issue](https://github.com/tenstorrent/tt-inference-server/issues/new?template=Blank+issue) and our team will address it.

## LLMs

For automated and pre-configured vLLM inference server using Docker please see the [Model Readiness Workflows User Guide](docs/workflows_user_guide.md).

| Model Name | Model URL | Hardware | Status | tt-metal commit | vLLM commit | Docker Image |
|------------|-----------|----------|--------|-----------------|-------------|--------------|
| [QwQ-32B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/Qwen/QwQ-32B) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | 🔍 preview | [v0.56.0-rc51](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc51/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc51-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [DeepSeek-R1-Distill-Llama-70B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | 🔍 preview | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Qwen2.5-72B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/Qwen/Qwen2.5-72B) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | 🔍 preview | [v0.56.0-rc33](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc33/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc33-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Qwen2.5-72B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | 🔍 preview | [v0.56.0-rc33](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc33/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc33-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Qwen2.5-7B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/Qwen/Qwen2.5-7B) | [n150](https://tenstorrent.com/hardware/wormhole) | 🔍 preview | [v0.56.0-rc33](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc33/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc33-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Qwen2.5-7B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) | [n150](https://tenstorrent.com/hardware/wormhole) | 🔍 preview | [v0.56.0-rc33](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc33/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc33-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.3-70B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.2-11B-Vision](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.2-11B-Vision) | [n150](https://tenstorrent.com/hardware/wormhole) | 🔍 preview | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.2-11B-Vision-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.2-11B-Vision-Instruct) | [n150](https://tenstorrent.com/hardware/wormhole) | 🔍 preview | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.2-1B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.2-1B) | [n150](https://tenstorrent.com/hardware/wormhole) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.2-1B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct) | [n150](https://tenstorrent.com/hardware/wormhole) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.2-3B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.2-3B) | [n150](https://tenstorrent.com/hardware/wormhole) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.2-3B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct) | [n150](https://tenstorrent.com/hardware/wormhole) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.1-70B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.1-70B) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.1-70B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct) | [TT-LoudBox/TT-QuietBox](https://tenstorrent.com/hardware/tt-quietbox) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.1-8B](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.1-8B) | [n150](https://tenstorrent.com/hardware/wormhole) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |
| [Llama-3.1-8B-Instruct](vllm-tt-metal-llama3/README.md) | [HF Repo](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) | [n150](https://tenstorrent.com/hardware/wormhole) | ✅ ready | [v0.56.0-rc47](https://github.com/tenstorrent/tt-metal/tree/v0.56.0-rc47/models/demos/llama3) | [e2e0002a](https://github.com/tenstorrent/vllm/tree/e2e0002ac7dc) | [0.0.4-v0.56.0-rc47-e2e0002ac7dc](https://ghcr.io/tenstorrent/tt-inference-server/vllm-tt-metal-src-release-ubuntu-20.04-amd64) |

# CNNs

| Model Name                    | Model URL                                                             | Hardware                                                                 | Status      | Minimum Release Version                                                          |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------- |
| [YOLOv4](tt-metal-yolov4/README.md)                        | [GH Repo](https://github.com/AlexeyAB/darknet)                    | [n150](https://tenstorrent.com/hardware/wormhole)                        | 🔍 preview  | [v0.0.1](https://github.com/tenstorrent/tt-inference-server/releases/tag/v0.0.1) |

"""

TT_STUDIO_INFO = """
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
5. [Documentation](#documentation)
   - [Frontend Documentation](#frontend-documentation)
   - [Backend API Documentation](#backend-api-documentation)
   - [Running vLLM Models in TT-Studio](#running-vllm-model(s)-and-mock-vllm-model-in-tt-Studio)  
   - [Running AI Agent with Chat LLM Models in TT-Studio](#running-ai-agent-in-tt-Studio)  

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

   Select your desired model and configure its corresponding weights by following the instructions in [HowToRun_vLLM_Models.md](./HowToRun_vLLM_Models.md).

3. **Run the Startup Script**:

   Run the `startup.sh` script:

   ```bash
   ./startup.sh
   ```

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
   # Port forward frontend (3000) to allow local access from the remote server
   ssh -L 3000:localhost:3000 <username>@<remote_server>
   ```

> ⚠️ **Note**: To use Tenstorrent hardware, during the run of `startup.sh` script, select "yes" when prompted to mount hardware. This will automatically configure the necessary settings, eliminating manual edits to docker compose.yml.
---

## Running in Development Mode

Developers can control and run the app directly via `docker compose`, keeping this running in a terminal allows for hot reload of the frontend app.

1. **Start the Application**:

   Navigate to the project directory and start the application:

   ```bash
   cd tt-studio/app
   docker compose up --build
   ```

   Alternatively, run the backend and frontend servers interactively:

   ```bash
   docker compose up
   ```

   To force a rebuild of Docker images:

   ```bash
   docker compose up --build
   ```

2. **Hot Reload & Debugging**:

   #### Frontend
   - The frontend supports hot reloading when running inside the `docker compose` environment.
   - Ensure that the required lines (**71-73**) in `docker-compose.yml` are uncommented.

   #### Backend
   - Local files in `./api` are mounted to `/api` within the container for development.
   - Code changes trigger an automatic rebuild and redeployment of the Django server.
   - To manually start the Django development server:

     ```bash
     ./manage.py runserver 0.0.0.0:8000
     ```

3. **Stopping the Services**:

   To shut down the application and remove running containers:

   ```bash
   docker compose down
   ```

4. **Using the Mock vLLM Model**:

   - For local testing, you can use the `Mock vLLM` model, which generates a random set of characters as output.
   - Instructions to run it are available [here](./HowToRun_vLLM_Models.md).

5. **Running on a Machine with Tenstorrent Hardware**:

    To run TT-Studio on a device with Tenstorrent hardware, you need to uncomment specific lines in the `app/docker-compose.yml` file. Follow these steps:

    1.  Navigate to the `app` directory:

        ```bash
        cd app/
        ```

    2.  Open the `docker-compose.yml` file in an editor (e.g., `vim` or a code editor like `VS CODE` ):

        ```bash
        vim docker-compose.yml
        # or
        code docker-compose.yml
        ```

    3.  Uncomment the following lines that have a `! flag` in front of them to enable Tenstorrent hardware support:
        ```yaml
        #* DEV: Uncomment devices to use Tenstorrent hardware
        #! devices:
        #* mounts all Tenstorrent devices to the backend container
        #!   - /dev/tenstorrent:/dev/tenstorrent
        ```
        By uncommenting these lines, Docker will mount the Tenstorrent device (`/dev/tenstorrent`) to the backend container. This allows the docker container to utilize the Tenstorrent hardware for running machine learning models directly on the card.

---

## Using `startup.sh`

The `startup.sh` script automates the TT-Studio setup process. It can be run with or without Docker, depending on your usage scenario.

### Basic Usage

To use the startup script, run:

```bash
./startup.sh [options]
```

### Command-Line Options

| Option          | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `--help`        | Display help message with usage details.                      |
| `--setup`       | Run the `setup.sh` script with sudo privileges for all steps. |
| `--cleanup`     | Stop and remove all Docker services.                          |

To display the same help section in the terminal, one can run:
```bash
./startup.sh --help
```
##### Automatic Tenstorrent Hardware Detection

If a Tenstorrent device (`/dev/tenstorrent`) is detected, the script will prompt you to mount it.

---

## Documentation

- **Frontend Documentation**: [app/frontend/README.md](app/frontend/README.md)  
  Detailed documentation about the frontend of TT Studio, including setup, development, and customization guides.

- **Backend API Documentation**: [app/api/README.md](app/api/README.md)  
  Information on the backend API, powered by Django Rest Framework, including available endpoints and integration details.

- **Running vLLM Model(s) and Mock vLLM Model in TT-Studio**: [HowToRun_vLLM_Models.md](HowToRun_vLLM_Models.md)  
  Step-by-step instructions on how to configure and run the vLLM model(s) using TT-Studio.

- **Running AI Agent with Chat LLM Models in TT-Studio**: [app/api/agent_control/README.md](app/api/agent_control/README.md)
   Instructions on how to run AI Agent by providing an API Key. 

- **Contribution Guide**: [CONTRIBUTING.md](CONTRIBUTING.md)  
  If you're interested in contributing to the project, please refer to our contribution guidelines. This includes setting up a development environment, code standards, and the process for submitting pull requests.

- **Frequently Asked Questions (FAQ)**: [FAQ.md](FAQ.md)  
  A compilation of frequently asked questions to help users quickly solve common issues and understand key features of TT-Studio.
"""

TENSTORRENT_OVERVIEW = """
Tenstorrent is a hardware company that designs and produces AI accelerators. Their products include the Grayskull and Wormhole architectures, 
designed for efficient AI and machine learning workloads. The company focuses on creating scalable solutions for AI computation.
"""

TT_METAL="""
# Install

These instructions will guide you through the installation of Tenstorrent system tools and drivers, followed by the installation of TT-Metalium and TT-NN.

> [!IMPORTANT]
>
> If you are using a release version of this software, check installation instructions packaged with it.
> You can find them in either the release assets for that version, or in the source files for that [version tag](https://github.com/tenstorrent/tt-metal/tags).

## Prerequisites:

### 1: Set Up the Hardware
- Follow the instructions for the Tenstorrent device you are using at: [Hardware Setup](https://docs.tenstorrent.com)

---

### 2: Install Driver & Firmware

Note the current compatibility matrix:

| Device               | OS              | Python   | Driver (TT-KMD)    | Firmware (TT-Flash)                        | TT-SMI                | TT-Topology                    |
|----------------------|-----------------|----------|--------------------|--------------------------------------------|-----------------------|--------------------------------|
| Galaxy (Wormhole 4U) | Ubuntu 22.04    | 3.10     | 1.31 or above      | fw_pack-80.10.1.0                          | v3.0.12 or above      | v1.1.3 or above, `mesh` config |
| Galaxy (Wormhole 6U) | Ubuntu 22.04    | 3.10     | 1.31 or above      | fw_pack-80.17.0.0 (v80.17.0.0)             | v3.0.12 or above      | v1.1.3 or above, `mesh` config |
| Wormhole             | Ubuntu 22.04    | 3.10     | v1.31 or above     | fw_pack-80.17.0.0 (v80.17.0.0)             | v3.0.12 or above      | N/A                            |
| T3000 (Wormhole)     | Ubuntu 22.04    | 3.10     | v1.31 or above     | fw_pack-80.17.0.0 (v80.17.0.0)             | v3.0.12 or above      | v1.1.3 or above, `mesh` config |
| Blackhole            | Ubuntu 22.04    | 3.10     | v1.31 or above     | fw_pack-80.15.0.0 (v80.15.0.0)             | v3.0.5 or above       | N/A                            |

#### Install System-level Dependencies
```
wget https://raw.githubusercontent.com/tenstorrent/tt-metal/refs/heads/main/install_dependencies.sh
chmod a+x install_dependencies.sh
sudo ./install_dependencies.sh
```

---

#### Install the Driver (TT-KMD)
- DKMS must be installed:

| OS              | Command                |
|------------------------|----------------------------------------------------|
| Ubuntu / Debian        | ```apt install dkms```                             |
| Fedora                 | ```dnf install dkms```                             |
| Enterprise Linux Based | ```dnf install epel-release && dnf install dkms``` |

- Install the latest TT-KMD version:
```
git clone https://github.com/tenstorrent/tt-kmd.git
cd tt-kmd
sudo dkms add .
sudo dkms install "tenstorrent/$(./tools/current-version)"
sudo modprobe tenstorrent
cd ..
```

- For more information visit Tenstorrents [TT-KMD GitHub repository](https://github.com/tenstorrent/tt-kmd).

---

#### Update Device TT-Firmware with TT-Flash

> [!CAUTION]
> Be sure to align the FW version with the compatible version in the table above for your particular configuration.

- Install TT-Flash:

```
pip install git+https://github.com/tenstorrent/tt-flash.git
```

- Reboot to load changes:
```
sudo reboot
```

- Check if TT-Flash is installed:
```
tt-flash --version
```

- Download and install the TT-Firmware version according to the table above. We will use latest here as example:
```
file_name=$(curl -s "https://raw.githubusercontent.com/tenstorrent/tt-firmware/main/latest.fwbundle")
curl -L -o "$file_name" "https://github.com/tenstorrent/tt-firmware/raw/main/$file_name"
tt-flash flash --fw-tar $file_name
```

- For more information visit Tenstorrent's [TT-Firmware GitHub Repository](https://github.com/tenstorrent/tt-firmware) and [TT-Flash Github Repository](https://github.com/tenstorrent/tt-flash).

---

#### Install System Management Interface (TT-SMI)
- Install Tenstorrent Software Management Interface (TT-SMI) according to the table above. We will use a specific version here as an example:
```
pip install git+https://github.com/tenstorrent/tt-smi@v3.0.12
```

- Verify System Configuration

Once hardware and system software are installed, verify that the system has been configured correctly.

  - Run the TT-SMI utility:
  ```
  tt-smi
  ```
  A display with device information, telemetry, and firmware will appear:<br>

![image](https://docs.tenstorrent.com/_images/tt_smi.png)
<br>
  If the tool runs without error, your system has been configured correctly.

- For more information, visit Tenstorrent's [TT-SMI GitHub repository](https://github.com/tenstorrent/tt-smi).

---

#### (Optional) Multi-Card Configuration (TT-Topology)

> [!CAUTION]
> Be sure to align the topology version with the compatible version in the table above for your particular configuration.

- For TT-Loudbox or TT-QuietBox systems, visit Tenstorrent's [TT-Topology README](https://github.com/tenstorrent/tt-topology/blob/main/README.md).

---

### TT-NN / TT-Metalium Installation

#### There are three options for installing TT-Metalium:

- [Option 1: From Source](#option-1-from-source)

  Installing from source gets developers closer to the metal and the source code.

- [Option 2: From Docker Release Image](#option-2-from-docker-release-image)

  Installing from Docker Release Image is the quickest way to access our APIs and to start running AI models.

- [Option 3: From Wheel](#option-3-from-wheel)

  Install from wheel as an alternative method to get quick access to our APIs and to running AI models.

---

### Option 1: From Source
Install from source if you are a developer who wants to be close to the metal and the source code. Recommended for running the demo models.

#### Step 1. Clone the Repository:

```sh
git clone https://github.com/tenstorrent/tt-metal.git --recurse-submodules
```

#### Step 2. Invoke our Build Scripts:

```
./build_metal.sh
```

- (recommended) For an out-of-the-box virtual environment to use, execute:
```
./create_venv.sh
source python_env/bin/activate
```

- (optional) Software dependencies for profiling use:
  - Install dependencies:
  ```sh
  sudo apt install pandoc libtbb-dev libcapstone-dev pkg-config
  ```

  - Download and install [Doxygen](https://www.doxygen.nl/download.html), (v1.9 or higher, but less than v1.10)

- Continue to [You Are All Set!](#you-are-all-set)

---

### Option 2: From Docker Release Image
Installing from Docker Release Image is the quickest way to access our APIs and to start running AI models.

Download the latest Docker release from our [Docker registry](https://github.com/orgs/tenstorrent/packages?q=tt-metalium-ubuntu&tab=packages&q=tt-metalium-ubuntu-22.04-release-amd64) page

```sh
docker pull ghcr.io/tenstorrent/tt-metal/tt-metalium-ubuntu-22.04-release-amd64:latest-rc
docker run -it --rm -v /dev/hugepages-1G:/dev/hugepages-1G --device /dev/tenstorrent ghcr.io/tenstorrent/tt-metal/tt-metalium-ubuntu-22.04-release-amd64:latest-rc bash
```

- For more information on the Docker Release Images, visit our [Docker registry page](https://github.com/orgs/tenstorrent/packages?q=tt-metalium-ubuntu&tab=packages&q=tt-metalium-ubuntu-22.04-release-amd64).

- Continue to [You Are All Set!](#you-are-all-set)

---

### Option 3: From Wheel
Install from wheel for quick access to our APIs and to get an AI model running

#### Step 1. Download and Install the Latest Wheel:

- Navigate to our [releases page](https://github.com/tenstorrent/tt-metal/releases/latest) and download the latest wheel file for the Tenstorrent card architecture you have installed.

- Install the wheel using your Python environment manager of choice. For example, to install with `pip`:

  ```sh
  pip install <wheel_file.whl>
  ```

#### Step 2. (For models users only) Set Up Environment for Models:

To try our pre-built models in `models/`, you must:

  - Install their required dependencies
  - Set appropriate environment variables
  - Set the CPU performance governor to ensure high performance on the host

- This is done by executing the following:
  ```sh
  export PYTHONPATH=$(pwd)
  pip install -r tt_metal/python_env/requirements-dev.txt
  sudo apt-get install cpufrequtils
  sudo cpupower frequency-set -g performance
  ```

---

### You are All Set!

#### To verify your installation, try executing a programming example:

- First, set the following environment variables:

  - Run the appropriate command for the Tenstorrent card you have installed:

  | Card             | Command                              |
  |------------------|--------------------------------------|
  | Grayskull        | ```export ARCH_NAME=grayskull```     |
  | Wormhole         | ```export ARCH_NAME=wormhole_b0```   |
  | Blackhole        | ```export ARCH_NAME=blackhole```     |

  - Run:
  ```
  export TT_METAL_HOME=$(pwd)
  export PYTHONPATH=$(pwd)
  ```

- Then, try running a programming example:
  ```
  python3 -m ttnn.examples.usage.run_op_on_device
  ```

- For more programming examples to try, visit Tenstorrent's [TT-NN Basic Examples Page](https://docs.tenstorrent.com/tt-metal/latest/ttnn/ttnn/usage.html#basic-examples) or get started with [Simple Kernels on TT-Metalium](https://docs.tenstorrent.com/tt-metal/latest/tt-metalium/tt_metal/examples/index.html)

---

### Interested in Contributing?
- For more information on development and contributing, visit Tenstorrent's [CONTRIBUTING.md page](https://github.com/tenstorrent/tt-metal/blob/main/CONTRIBUTING.md)."""

# Define the internal knowledge base
INTERNAL_KNOWLEDGE = [
    TT_INFERENCE_SERVER,
    TT_STUDIO_INFO,
    TENSTORRENT_OVERVIEW,
    TT_METAL
]
