#!/bin/bash

# SPDX-License-Identifier: Apache-2.0
# 
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# Define setup script path
SETUP_SCRIPT="./setup.sh"

# Step 0: detect OS
OS_NAME="$(uname)"

# Function to show usage/help
usage() {
    echo -e "🤖 Usage: ./startup.sh [options]"
    echo
    echo -e "This script sets up the TT Studio environment by performing the following steps:"
    echo -e "  1. 🧭 Detects the OS."
    echo -e "  2. 🛠️  Sets the TT_STUDIO_ROOT variable in .env based on the running directory."
    echo -e "  3. 🌐 Checks for and creates a Docker network named 'llm_studio_network' if not present."
    echo -e "  4. 🚀 Runs Docker Compose to start the TT Studio services."
    echo
    echo -e "Options:"
    echo -e "  --help              ❓ Show this help message and exit."
    echo -e "  --setup             🔧 Run the setup script with sudo and all steps before executing main steps."
    echo -e "  --cleanup           🧹 Stop and remove Docker services."
    echo -e "  --tt-hardware       🖥️  Configure for TT hardware support in Docker Compose."
    echo
    echo -e "Examples:"
    echo -e "  ./startup.sh --setup             # Run setup steps as sudo, then main steps"
    echo -e "  ./startup.sh                     # Run the main setup steps directly"
    echo -e "  ./startup.sh --cleanup           # Stop and clean up Docker services"
    echo -e "  ./startup.sh --tt-hardware       # Run with TT hardware configuration"
    echo -e "  ./startup.sh --help              # Display this help message"
    exit 0
}

# Initialize flags
RUN_SETUP=false
RUN_CLEANUP=false
RUN_TT_HARDWARE=false

# Parse options
for arg in "$@"; do
    case $arg in
        --help)
            usage
            ;;
        --setup)
            RUN_SETUP=true
            ;;
        --cleanup)
            RUN_CLEANUP=true
            ;;
        --tt-hardware)
            RUN_TT_HARDWARE=true
            ;;
        *)
            echo "⛔ Unknown option: $arg"
            usage
            ;;
    esac
done

# Set TT_STUDIO_ROOT before any operations
TT_STUDIO_ROOT="$(pwd)"
echo "TT_STUDIO_ROOT is set to: ${TT_STUDIO_ROOT}"

DOCKER_COMPOSE_FILE="${TT_STUDIO_ROOT}/app/docker-compose.yml"
DOCKER_COMPOSE_TT_HARDWARE_FILE="${TT_STUDIO_ROOT}/app/docker-compose.tt-hardware.yml"
ENV_FILE_PATH="${TT_STUDIO_ROOT}/app/.env"
ENV_FILE_DEFAULT="${TT_STUDIO_ROOT}/app/.env.default"

if [[ ! -f "$DOCKER_COMPOSE_FILE" ]]; then
    echo "⛔ Error: docker-compose.yml not found at $DOCKER_COMPOSE_FILE."
    exit 1
fi

# Cleanup step if --cleanup is provided
if [[ "$RUN_CLEANUP" = true ]]; then
    echo "🧹 Stopping and removing Docker services..."
    cd "${TT_STUDIO_ROOT}/app" && docker compose down
    if [[ $? -eq 0 ]]; then
        echo "✅ Backend service stopped and removed."
    else
        echo "⛔ Failed to clean up backend service."
        exit 1
    fi
    exit 0
fi

# Step 0: Conditionally run setup.sh with sudo and all steps if --setup is provided
if [[ "$RUN_SETUP" = true ]]; then
    echo "🔧 Running setup script with sudo for all steps..."
    if [[ -x "$SETUP_SCRIPT" ]]; then
        sudo "$SETUP_SCRIPT" --sudo all
        if [[ $? -ne 0 ]]; then
            echo "⛔ Setup script encountered an error. Exiting."
            exit 1
        fi
    else
        echo "⛔ Error: Setup script '$SETUP_SCRIPT' not found or not executable."
        exit 1
    fi
fi

# Step 1: Create .env from .env.default if necessary, and set TT_STUDIO_ROOT and ENABLE_TT_HARDWARE
if [[ ! -f "${ENV_FILE_PATH}" && -f "${ENV_FILE_DEFAULT}" ]]; then
    echo "Creating .env file from .env.default"
    cp "${ENV_FILE_DEFAULT}" "${ENV_FILE_PATH}"
fi

# Update TT_STUDIO_ROOT and ENABLE_TT_HARDWARE in the .env file
if [[ -f "${ENV_FILE_PATH}" ]]; then
    # Check OS and set sed command accordingly
    if [[ "$OS_NAME" == "Darwin" ]]; then
        # macOS sed requires an empty string after -i
        sed -i '' "s|^TT_STUDIO_ROOT=.*|TT_STUDIO_ROOT=${TT_STUDIO_ROOT}|g" "${ENV_FILE_PATH}"

        if [[ "$RUN_TT_HARDWARE" = true ]]; then
            sed -i '' "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=true|g" "${ENV_FILE_PATH}"
            echo "Enabled TT hardware support in .env file"
        else
            sed -i '' "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=false|g" "${ENV_FILE_PATH}"
            echo "Disabled TT hardware support in .env file"
        fi
    else
        # Linux syntax for sed
        sed -i "s|^TT_STUDIO_ROOT=.*|TT_STUDIO_ROOT=${TT_STUDIO_ROOT}|g" "${ENV_FILE_PATH}"

        if [[ "$RUN_TT_HARDWARE" = true ]]; then
            sed -i "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=true|g" "${ENV_FILE_PATH}"
            echo "Enabled TT hardware support in .env file"
        else
            sed -i "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=false|g" "${ENV_FILE_PATH}"
            echo "Disabled TT hardware support in .env file"
        fi
    fi
else
    echo "⛔ Error: .env file does not exist and could not be created."
    exit 1
fi

# Step 2: Source env vars
source "${ENV_FILE_PATH}"

# Step 3: Check if the Docker network already exists
NETWORK_NAME="llm_studio_network"
if docker network ls | grep -qw "${NETWORK_NAME}"; then
    echo "Network '${NETWORK_NAME}' exists."
else
    echo "Creating network '${NETWORK_NAME}'..."
    docker network create --driver bridge "${NETWORK_NAME}"
    if [ $? -eq 0 ]; then
        echo "Network created successfully."
    else
        echo "Failed to create network."
        exit 1
    fi
fi

# Step 4: Run Docker Compose with or without hardware support
if [[ "$RUN_TT_HARDWARE" = true ]]; then
    echo "🚀 Running Docker Compose with TT hardware support..."
    docker compose -f "${TT_STUDIO_ROOT}/app/docker-compose.yml" -f "${DOCKER_COMPOSE_TT_HARDWARE_FILE}" up --build -d
else
    echo "🚀 Running Docker Compose without TT hardware support..."
    docker compose -f "${TT_STUDIO_ROOT}/app/docker-compose.yml" up --build -d
fi

# Final message
echo "============================================="
echo "          🎉 TT Studio Setup Complete!          "
echo "============================================="
echo
echo "🚀 The app is now accessible at: http://localhost:3000"
echo
echo "============================================="
echo "           🧹 Cleanup Instructions             "
echo "============================================="
echo
echo "🛑 To stop the app and the services, run: './startup.sh --cleanup'"
echo
echo "============================================="
