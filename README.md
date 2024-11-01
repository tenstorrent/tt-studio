# TT Studio

TT Studio enables rapid deployment of LLM inference servers locally and is optimized for Tenstorrent hardware. This guide explains how to set up and use TT Studio in both standard and development modes.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
   - [For General Users](#for-general-users)
   - [For Developers](#for-developers)
3. [Using `startup.sh`](#using-startupsh)
   - [Basic Usage](#basic-usage)
   - [Command-Line Options](#command-line-options)
4. [Setting Up a Tenstorrent Device Using `setup.sh`](#setting-up-a-tenstorrent-device)
   - [Overview](#setup-overview)
   - [Steps](#steps)
5. [Hardware Configuration](#hardware-configuration)
6. [Documentation](#documentation)

---

## Overview

TT Studio is an application that can be installed on a local T-Series or Galaxy machine to deploy AI models on TT hardware and launch demo applications. This guide covers installation, basic usage, and configuration for both general users and developers.

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

   - Run the `startup.sh` script:
     ```bash
     ./startup.sh
     ```
     See this [section](#command-line-options) for more information on command-line arguments available within the script.

3. **Access the Application**:

   - The app will be available at [http://localhost:3000](http://localhost:3000). 🚀

4. **Cleanup**:
   - To stop and remove Docker services, run:
     ```bash
     ./startup.sh --cleanup
     ```

> **Note**: To use Tenstorrent hardware, uncomment the lines in `app/docker-compose.yml` under `devices` to mount the necessary devices (see the [Hardware Configuration](#hardware-configuration) section for details).

---

### For Developers

Developers can control container behavior directly with `docker-compose`:

1. **Run in Development Mode**:

   ```bash
   cd tt-studio/app
   docker-compose up --build
   ```

2. **Stop the Services**:

   ```bash
   docker-compose down
   ```

3. **Using the Echo Model**:
   - For local testing, you can use the provided `echo` model, which repeats the prompt.
     Build the Docker image with:
     ```bash
     cd models/dummy_echo_model
     docker build -t dummy_echo_model:v0.0.1 .
     ```

---

## Using `startup.sh`

The `startup.sh` script automates the TT Studio setup process. It can be run with or without Docker, depending on your usage scenario.

### Basic Usage

To use the startup script, run:

```bash
./startup.sh [options]
```

### Command-Line Options

| Option      | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `--help`    | Display help message with usage details.                      |
| `--setup`   | Run the `setup.sh` script with sudo privileges for all steps. |
| `--cleanup` | Stop and remove all Docker services.                          |

Note: to understand more about the setup script, scroll to [this section](#setting-up-a-tenstorrent-device).

To display more detailed help:

```bash
./startup.sh --help
```

---

## Setting Up a Tenstorrent Device

The `setup.sh` script is a multi-step script designed to configure all required environments and dependencies. This section details the setup process for both general users and developers.

### Setup Overview

The `setup.sh` script can be run in one of three main ways:

- **Run all steps sequentially**: Ideal for first-time setup or full reinstallation.
- **Run specific steps**: Useful for troubleshooting or updating a specific part of the setup.
- **Run with sudo privileges**: Needed for certain steps that require system permissions (e.g., installing packages).

---

### Steps

To use `setup.sh`, run:

```bash
./setup.sh [options] <step> ...
```

#### Options

| Option        | Description                                   |
| ------------- | --------------------------------------------- |
| `--help`      | Show help message and exit.                   |
| `--sudo`      | Run all specified steps with sudo privileges. |
| `--sudo-step` | Run a specific step with sudo privileges.     |
| `--step`      | Run a specific step without sudo privileges.  |

#### Steps

| Step    | Description                                               |
| ------- | --------------------------------------------------------- |
| `step1` | Install required packages.                                |
| `step2` | Clone necessary repositories.                             |
| `step3` | Set up hugepages.                                         |
| `step4` | Install DKMS module.                                      |
| `step5` | Flash firmware.                                           |
| `step6` | Run the `tt topology` command to configure mesh topology. |
| `all`   | Run all setup steps sequentially.                         |

---

## Hardware Configuration

To enable Tenstorrent hardware, ensure the following:

1. **Uncomment Device Configuration**:
   In `app/docker-compose.yml`, uncomment the following lines:

   ```yaml
   devices:
     - /dev/tenstorrent:/dev/tenstorrent
   ```

2. **Verify Device Connection**:
   Confirm Tenstorrent devices are connected with:
   ```bash
   ls -l /dev/tenstorrent
   ```

---

## Documentation

- **Frontend Documentation**: [app/frontend/README.md](app/frontend/README.md)
- **Backend API Documentation**: [app/api/README.md](app/api/README.md)
- **Model Implementations Documentation**: [models/README.md](models/README.md)
