# SPDX-License-Identifier: Apache-2.0
# 
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

#!/bin/bash

# Define setup script path
SETUP_SCRIPT="./setup.sh"

# step 0: detect OS
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
    echo
    echo -e "Examples:"
    echo -e "  ./startup.sh --setup     # Run setup steps as sudo, then main steps"
    echo -e "  ./startup.sh             # Run the main setup steps directly"
    echo -e "  ./startup.sh --cleanup   # Stop and clean up Docker services"
    echo -e "  ./startup.sh --help      # Display this help message"
    exit 0
}

# Initialize flags
RUN_SETUP=false
RUN_CLEANUP=false

# Parse options
if [[ "$#" -gt 0 ]]; then
    case $1 in
        --help)
            usage
            ;;
        --setup)
            RUN_SETUP=true
            ;;
        --cleanup)
            RUN_CLEANUP=true
            ;;
        *)
            echo "⛔ Unknown option: $1"
            usage
            ;;
    esac
fi

# Set TT_STUDIO_ROOT before any operations
TT_STUDIO_ROOT="$(pwd)"

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

# step 1: Set TT_STUDIO_ROOT and create .env from .env.default if necessary
ENV_FILE_PATH="${TT_STUDIO_ROOT}/app/.env"
ENV_FILE_DEFAULT="${TT_STUDIO_ROOT}/app/.env.default"

# Check if .env exists, if not create from .env.default
if [[ ! -f "${ENV_FILE_PATH}" && -f "${ENV_FILE_DEFAULT}" ]]; then
    echo "Creating .env file from .env.default"
    cp "${ENV_FILE_DEFAULT}" "${ENV_FILE_PATH}"
fi

# Update TT_STUDIO_ROOT in .env
if [[ -f "${ENV_FILE_PATH}" ]]; then
    sed -i "/^TT_STUDIO_ROOT=/c\\TT_STUDIO_ROOT=${TT_STUDIO_ROOT}" "${ENV_FILE_PATH}"
    echo "Set TT_STUDIO_ROOT to: ${TT_STUDIO_ROOT} in .env file"
else
    echo "Error: .env file does not exist and could not be created."
    exit 1
fi

# step 2: source env vars
source "${ENV_FILE_PATH}"

# step 3: Check if the Docker network already exists
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

# step 4: run docker compose
docker compose -f "${TT_STUDIO_ROOT}/app/docker-compose.yml" up -d


# Final message
echo "============================================="
echo "🎉 TT Studio setup completed successfully!"
echo "============================================="
echo
echo -e "🚀 The frontend is now accessible at: \e[1mhttp://localhost:3000\e[0m"
echo
echo "============================================="
echo "🧹 Cleanup Instructions:"
echo "  - To stop the service, run: './startup.sh --cleanup'"