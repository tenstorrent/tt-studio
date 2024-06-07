#!/bin/bash

# step 0: detect OS
OS_NAME="$(uname)"

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
echo "to clean up backend service run: 'docker compose -f ${TT_STUDIO_ROOT}/app/docker-compose.yml down'"
