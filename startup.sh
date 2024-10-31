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
    echo -e "  2. 🛠️  Sets the TT_STUDIO_ROOT variable in .env and validates the location."
    echo -e "  3. 🔄 Sources environment variables from .env file."
    echo -e "  4. 📥 Installs necessary components (TODO: tt-firmware, tt-kmd, tt-smi)."
    echo -e "  5. 🌐 Checks for and creates a Docker network named 'llm_studio_network' if not present."
    echo -e "  6. 🚀 Runs Docker Compose to start the TT Studio services."
    echo
    echo -e "Options:"
    echo -e "  --help              ❓ Show this help message and exit."
    echo -e "  --setup             🔧 Run the setup script with sudo and all steps before executing main steps."
    echo
    echo -e "Examples:"
    echo -e "  ./startup.sh --setup  # Run setup steps as sudo, then main steps"
    echo -e "  ./startup.sh          # Run the main setup steps directly"
    echo -e "  ./startup.sh --help   # Display this help message"
    echo
    echo -e "Cleanup Command:"
    echo -e "  To stop and remove the backend service, run:"
    echo -e "    docker compose -f \${TT_STUDIO_ROOT}/app/docker-compose.yml down"
    exit 0
}

# Initialize setup flag
RUN_SETUP=false

# Parse options
if [[ "$#" -gt 0 ]]; then
    case $1 in
        --help)
            usage
            ;;
        --setup)
            RUN_SETUP=true
            ;;
        *)
            echo "⛔ Unknown option: $1"
            usage
            ;;
    esac
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

# step 1: automatically set TT_STUDIO_ROOT in .env and validate it
TT_STUDIO_ROOT="$(git rev-parse --show-toplevel)"
if [[ "${TT_STUDIO_ROOT}" =~ tt-studio$ ]]; then
    echo "using TT_STUDIO_ROOT:=${TT_STUDIO_ROOT}"
else
    echo "Error: TT_STUDIO_ROOT:=${TT_STUDIO_ROOT} does not end with 'tt-studio'"
    echo "startup.sh script must be run from the top level of tt-studio repo."
    exit 1
fi
ENV_FILE_PATH="${TT_STUDIO_ROOT}/app/.env"
ENV_FILE_TT_STUDIO_ROOT_LINE="TT_STUDIO_ROOT=${TT_STUDIO_ROOT}"
if [[ "${OS_NAME}" == "Darwin" ]]; then
    # macOS uses Darwin as the kernel name, use sed with an empty string for the in-place flag
    # newlines required to add newlines to .env file
    sed -i '' "/^TT_STUDIO_ROOT=/c\\
${ENV_FILE_TT_STUDIO_ROOT_LINE}
" "${ENV_FILE_PATH}"
else
    # Assuming Linux, use sed directly without an empty string
    sed -i "/^TT_STUDIO_ROOT=/c\\${ENV_FILE_TT_STUDIO_ROOT_LINE}" "${ENV_FILE_PATH}"
fi

# step 2: source env vars
source "${ENV_FILE_PATH}"

# step 3:
# TODO: install tt-firmware, tt-kmd, tt-smi

# step 4: Check if the Docker network already exists
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

# step 5: run docker compose
docker compose -f "${TT_STUDIO_ROOT}/app/docker-compose.yml" up -d
echo "To clean up backend service run: 'docker compose -f ${TT_STUDIO_ROOT}/app/docker-compose.yml down'"
