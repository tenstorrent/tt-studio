# TT Studio

TT Studio enables rapid deployment of LLM inference servers locally and is optimized for Tenstorrent hardware. This guide explains how to set up and use TT Studio in both standard and development modes. It also guides users through setting up a new Tenstorrent device, including steps for driver installation, firmware flashing, and related configurations.

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

> **Note**: To use Tenstorrent hardware, use the `--tt-hardware` flag with the `startup.sh` script. This will enable the necessary hardware configurations automatically without manual changes to `docker-compose.yml`. See the [Hardware Configuration](#hardware-configuration) section for details.
> **Note**: To use Tenstorrent hardware, use the `--tt-hardware` flag with the `startup.sh` script. This will enable the necessary hardware configurations automatically without manual changes to `docker-compose.yml`. See the [Hardware Configuration](#hardware-configuration) section for details.

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

| Option          | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `--help`        | Display help message with usage details.                      |
| `--setup`       | Run the `setup.sh` script with sudo privileges for all steps. |
| `--cleanup`     | Stop and remove all Docker services.                          |
| `--tt-hardware` | Enable Tenstorrent hardware support in Docker Compose.        |

To understand more about the setup script, see [Setting Up a Tenstorrent Device](#setting-up-a-tenstorrent-device).
| Option          | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `--help`        | Display help message with usage details.                      |
| `--setup`       | Run the `setup.sh` script with sudo privileges for all steps. |
| `--cleanup`     | Stop and remove all Docker services.                          |
| `--tt-hardware` | Enable Tenstorrent hardware support in Docker Compose.        |

To understand more about the setup script, see [Setting Up a Tenstorrent Device](#setting-up-a-tenstorrent-device).

To display more detailed help:

```bash
./startup.sh --help
```

---

## Documentation

- **Frontend Documentation**: [app/frontend/README.md](app/frontend/README.md)
- **Backend API Documentation**: [app/api/README.md](app/api/README.md)
- **Model Implementations Documentation**: [models/README.md](models/README.md)

---