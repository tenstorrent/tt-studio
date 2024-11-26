# TT Studio

TT Studio enables rapid deployment of LLM inference servers locally and is optimized for Tenstorrent hardware. This guide explains how to set up and use TT Studio in both standard and development modes.

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
5. [Documentation](#documentation)
   - [Frontend Documentation](#frontend-documentation)
   - [Backend API Documentation](#backend-api-documentation)
   - [Running Llama3.1-70B in TT-Studio](#running-llama31-70b-in-tt-studio)


---
## Prerequisites
1. Docker: Ensure that Docker is installed on your machine. You can refer to the installation guide [here](https://docs.docker.com/engine/install/).

---
## Quick Start

### For General Users

To set up TT Studio:

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/tenstorrent/tt-studio.git
   cd tt-studio
   ```

2. **Run the Startup Script**:

   Run the `startup.sh` script:

   ```bash
   ./startup.sh
   ```

   #### See this [section](#command-line-options) for more information on command-line arguments available within the startup script.

3. **Access the Application**:

   The app will be available at [http://localhost:3000](http://localhost:3000).

4. **Cleanup**:
   - To stop and remove Docker services, run:
     ```bash
     ./startup.sh --cleanup
     ```
5. Running on a Remote Machine

   To forward traffic between your local machine and a remote server, enabling you to access the frontend application in your local browser, follow these steps:

   Use the following SSH command to port forward both the frontend and backend ports:

   ```bash
   # Port forward frontend (3000) to allow local access from the remote server
   ssh -L 3000:localhost:3000 <username>@<remote_server>
   ```

> ⚠️ **Note**: To use Tenstorrent hardware, during the run of `startup.sh` script and select "yes" when prompted to mount hardware. This will automatically configure the necessary settings, eliminating manual edits to docker-compose.yml.
---

### For Developers

Developers can control and run the app directly via `docker-compose`, keeping this running in a terminal allows for hot reload of the frontend app. For any backend changes its advisable to re restart the services.

1.  **Run in Development Mode**:

    ```bash
    cd tt-studio/app
    docker-compose up --build
    ```

2.  **Stop the Services**:

    ```bash
    docker-compose down
    ```

3.  **Using the Echo Model**:
    - For local testing, you can use the provided `echo` model, which repeats the prompt.
      Build the Docker image with:
      ```bash
      cd models/dummy_echo_model
      docker build -t dummy_echo_model:v0.0.1 .
      ```
4.  **Running on a Machine with Tenstorrent Hardware**:

    To run TT-STUDIO on a device with Tenstorrent hardware, you need to uncomment specific lines in the `app/docker-compose.yml` file. Follow these steps:

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

The `startup.sh` script automates the TT Studio setup process. It can be run with or without Docker, depending on your usage scenario.

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

If a Tenstorrent device (/dev/tenstorrent) is detected, the script will prompt you to mount it.

---

## Documentation

- **Frontend Documentation**: [app/frontend/README.md](app/frontend/README.md)  
  Detailed documentation about the frontend of TT Studio, including setup, development, and customization guides.

- **Backend API Documentation**: [app/api/README.md](app/api/README.md)  
  Information on the backend API, powered by Django Rest Framework, including available endpoints and integration details.

- **Running Llama3.1-70B in TT-Studio**: [HowToRunLlama3.1-70b.md](HowToRunLlama3.1-70b.md)  
  Step-by-step instructions on how to configure and run the Llama3.1-70B model using TT Studio.

- **Contribution Guide**: [CONTRIBUTING.md](CONTRIBUTING.md)  
  If you’re interested in contributing to the project, please refer to our contribution guidelines. This includes setting up a development environment, code standards, and the process for submitting pull requests.

- **Frequently Asked Questions (FAQ)**: [FAQ.md](FAQ.md)  
  A compilation of frequently asked questions to help users quickly solve common issues and understand key features of TT Studio.
