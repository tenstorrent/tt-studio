#!/bin/bash

# SPDX-License-Identifier: Apache-2.0
# 
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

set -euo pipefail  # Exit on error, print commands, unset variables treated as errors, and exit on pipeline failure

# Define setup script path
SETUP_SCRIPT="./setup.sh"

# Step 0: detect OS
OS_NAME="$(uname)"

# Function to show usage/help
usage() {
    echo -e "🤖 Usage: ./startup.sh [options]"
    echo
    echo -e "This script sets up the TT-Studio environment by performing the following steps:"
    echo -e "  1. 🧭 Detects the OS."
    echo -e "  2. 🛠️  Sets the TT_STUDIO_ROOT variable in .env based on the running directory."
    echo -e "  3. 🌐 Checks for and creates a Docker network named 'tt_studio_network' if not present."
    echo -e "  4. 🚀 Runs Docker Compose to start the TT Studio services."
    echo
    echo -e "Options:"
    echo -e "  --help              ❓ Show this help message and exit."
    echo -e "  --setup             🔧 Run the setup script with sudo and all steps before executing main steps."
    echo -e "  --cleanup           🧹 Stop and remove Docker services."
    echo -e "  --dev               💻 Run in development mode with live code reloading."
    echo
    echo -e "Examples:"
    #! TODO add back in support once setup scripts are merged in
    # echo -e "  ./startup.sh --setup             # Run setup steps as sudo, then main steps" phase this out for now .
    echo -e "  ./startup.sh                     # Run the main setup steps directly"
    echo -e "  ./startup.sh --cleanup           # Stop and clean up Docker services"
    echo -e "  ./startup.sh --help              # Display this help message"
    echo -e "  ./startup.sh --dev               # Run in development mode"
    exit 0
}

# Initialize flags
RUN_SETUP=false
RUN_CLEANUP=false
RUN_TT_HARDWARE=false
RUN_DEV_MODE=false

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
        --dev)
            RUN_DEV_MODE=true
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
    
    # Clean up FastAPI server if it's running
    FASTAPI_PID_FILE="${TT_STUDIO_ROOT}/fastapi.pid"
    if [[ -f "$FASTAPI_PID_FILE" ]]; then
        FASTAPI_PID=$(cat "$FASTAPI_PID_FILE")
        if kill -0 "$FASTAPI_PID" 2>/dev/null; then
            echo "🧹 Stopping FastAPI server (PID: $FASTAPI_PID)..."
            sudo kill "$FASTAPI_PID"
            sleep 2
            if kill -0 "$FASTAPI_PID" 2>/dev/null; then
                echo "🧹 Force killing FastAPI server..."
                sudo kill -9 "$FASTAPI_PID"
            fi
            echo "✅ FastAPI server stopped."
        fi
        rm -f "$FASTAPI_PID_FILE"
    fi
    
    # Clean up log file
    rm -f "${TT_STUDIO_ROOT}/fastapi.log"
    
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

# run a simple command to check if /dev/tenstorrent exists 
if [[ -e "/dev/tenstorrent" ]]; then
    echo "🖥️ Tenstorrent device detected at /dev/tenstorrent."

    # Prompt user for enabling TT hardware support
    if [[ "$RUN_TT_HARDWARE" = false ]]; then
        while true; do
            read -p "Do you want to mount Tenstorrent hardware? (y/n): " enable_hardware
            case "$enable_hardware" in
                [Yy]* ) 
                    RUN_TT_HARDWARE=true
                    echo "Enabling Tenstorrent hardware support..."
                    break
                    ;;
                [Nn]* ) 
                    RUN_TT_HARDWARE=false
                    break
                    ;;
                * ) 
                    echo "Please answer 'y' or 'n'"
                    ;;
            esac
        done
    fi
else
    echo "⛔ No Tenstorrent device found at /dev/tenstorrent. Skipping Mounting hardware setup."
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

# Step 2: Source env vars, ensure directories
source "${ENV_FILE_PATH}"
# make persistent volume on host user user permissions
if [ ! -d "$HOST_PERSISTENT_STORAGE_VOLUME" ]; then
    mkdir "$HOST_PERSISTENT_STORAGE_VOLUME"
    if [ $? -ne 0 ]; then
        echo "⛔ Error: Failed to create directory $HOST_PERSISTENT_STORAGE_VOLUME"
        exit 1
    fi
fi

# Step 3: Check if the Docker network already exists
NETWORK_NAME="tt_studio_network"
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

# Step 4: Pull Docker image for agent 
docker pull ghcr.io/tenstorrent/tt-studio/agent_image:v1.1 || { echo "Docker pull failed. Please authenticate and re-run the docker pull manually."; }

# Before running Docker Compose, ask about dev mode if not specified in args
if [[ "$RUN_DEV_MODE" = false ]]; then
    while true; do
        read -p "Do you want to run in development mode? (y/n): " enable_dev_mode
        case "$enable_dev_mode" in
            [Yy]* ) 
                RUN_DEV_MODE=true
                echo "Enabling development mode..."
                break
                ;;
            [Nn]* ) 
                RUN_DEV_MODE=false
                break
                ;;
            * ) 
                echo "Please answer 'y' or 'n'"
                ;;
        esac
    done
fi

# Step 5: Run Docker Compose with appropriate configuration
COMPOSE_FILES="-f ${TT_STUDIO_ROOT}/app/docker-compose.yml"

if [[ "$RUN_DEV_MODE" = true ]]; then
    echo "🚀 Running Docker Compose in development mode..."
    COMPOSE_FILES="${COMPOSE_FILES} -f ${TT_STUDIO_ROOT}/app/docker-compose.dev-mode.yml"
else
    echo "🚀 Running Docker Compose in production mode..."
fi

if [[ "$RUN_TT_HARDWARE" = true ]]; then
    echo "🚀 Running Docker Compose with TT hardware support..."
    COMPOSE_FILES="${COMPOSE_FILES} -f ${DOCKER_COMPOSE_TT_HARDWARE_FILE}"
else
    echo "🚀 Running Docker Compose without TT hardware support..."
fi

echo "🚀 Running Docker Compose with above selected configuration..."
docker compose ${COMPOSE_FILES} up --build -d

# Step 6: Setup TT Inference Server FastAPI
echo
echo -e "\e[1;36m=====================================================\e[0m"
echo -e "\e[1;36m         🔧 Setting up TT Inference Server          \e[0m"
echo -e "\e[1;36m=====================================================\e[0m"

INFERENCE_SERVER_DIR="${TT_STUDIO_ROOT}/tt-inference-server"

# Clone the repository if it doesn't exist
if [ ! -d "$INFERENCE_SERVER_DIR" ]; then
    echo "📥 Cloning TT Inference Server repository..."
    git clone -b atupe/inference-server-fastapi https://github.com/tenstorrent/tt-inference-server.git "$INFERENCE_SERVER_DIR"
    if [ $? -ne 0 ]; then
        echo "⛔ Error: Failed to clone tt-inference-server repository"
        exit 1
    fi
else
    echo "📁 TT Inference Server directory already exists, pulling latest changes..."
    cd "$INFERENCE_SERVER_DIR"
    git fetch origin atupe/inference-server-fastapi
    git checkout atupe/inference-server-fastapi
    git pull origin atupe/inference-server-fastapi
    if [ $? -ne 0 ]; then
        echo "⛔ Error: Failed to update tt-inference-server repository"
        exit 1
    fi
fi

# Change to the inference server directory
cd "$INFERENCE_SERVER_DIR"

# Check if port 8001 is already in use
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 8001 is already in use. Attempting to find and stop existing process..."
    EXISTING_PID=$(lsof -Pi :8001 -sTCP:LISTEN -t)
    if [[ -n "$EXISTING_PID" ]]; then
        echo "🛑 Found existing process on port 8001 (PID: $EXISTING_PID). Stopping it..."
        sudo kill "$EXISTING_PID" 2>/dev/null || true
        sleep 2
        if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "🛑 Force killing process on port 8001..."
            sudo kill -9 "$EXISTING_PID" 2>/dev/null || true
            sleep 1
        fi
    fi
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "🐍 Creating Python virtual environment..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "⛔ Error: Failed to create virtual environment"
        exit 1
    fi
else
    echo "🐍 Virtual environment already exists"
fi

# Install requirements
echo "📦 Installing Python requirements..."
.venv/bin/pip install -r requirements-api.txt
if [ $? -ne 0 ]; then
    echo "⛔ Error: Failed to install requirements"
    exit 1
fi

# Prompt for required environment variables
echo
echo -e "\e[1;36m=====================================================\e[0m"
echo -e "\e[1;36m         🔑 Configuration Required                   \e[0m"
echo -e "\e[1;36m=====================================================\e[0m"
echo

# Prompt for JWT_SECRET
while true; do
    read -s -p "🔐 Enter JWT_SECRET (for authentication): " JWT_SECRET
    echo
    if [[ -n "$JWT_SECRET" ]]; then
        break
    else
        echo "⛔ JWT_SECRET cannot be empty. Please enter a valid JWT secret."
    fi
done

# Prompt for HF_TOKEN
while true; do
    read -s -p "🤗 Enter HF_TOKEN (Hugging Face token): " HF_TOKEN
    echo
    if [[ -n "$HF_TOKEN" ]]; then
        break
    else
        echo "⛔ HF_TOKEN cannot be empty. Please enter a valid Hugging Face token."
    fi
done

# Export the environment variables
export JWT_SECRET
export HF_TOKEN

echo "✅ Environment variables configured successfully"
echo

# Start FastAPI server in background with logging
echo "🚀 Starting FastAPI server on port 8001..."
echo "🔐 FastAPI server requires sudo privileges. Please enter your password:"

# Prompt for sudo password upfront so it's cached for background process
sudo -v
if [ $? -ne 0 ]; then
    echo "⛔ Error: Failed to authenticate with sudo"
    exit 1
fi

echo "✅ Sudo authentication successful. Starting FastAPI server..."
FASTAPI_LOG_FILE="${TT_STUDIO_ROOT}/fastapi.log"
# Use a wrapper script to properly capture the uvicorn PID
sudo JWT_SECRET="$JWT_SECRET" HF_TOKEN="$HF_TOKEN" bash -c "
    .venv/bin/uvicorn api:app --host 0.0.0.0 --port 8001 > \"$FASTAPI_LOG_FILE\" 2>&1 &
    echo \$! > \"${TT_STUDIO_ROOT}/fastapi.pid\"
" &
FASTAPI_PID=""

# Wait for PID file to be created and read the actual PID
echo "⏳ Waiting for FastAPI server to start..."
HEALTH_CHECK_RETRIES=30
HEALTH_CHECK_DELAY=2

# Wait for PID file to be created
for ((i=1; i<=10; i++)); do
    if [[ -f "${TT_STUDIO_ROOT}/fastapi.pid" ]] && [[ -n "$(cat "${TT_STUDIO_ROOT}/fastapi.pid" 2>/dev/null)" ]]; then
        FASTAPI_PID=$(cat "${TT_STUDIO_ROOT}/fastapi.pid")
        echo "📋 FastAPI PID: $FASTAPI_PID"
        break
    fi
    echo "⏳ Waiting for PID file (attempt $i/10)..."
    sleep 1
done

if [[ -z "$FASTAPI_PID" ]]; then
    echo "⛔ Error: Failed to get FastAPI PID"
    exit 1
fi

for ((i=1; i<=HEALTH_CHECK_RETRIES; i++)); do
    # Check if process exists (try both regular and sudo)
    if ! kill -0 "$FASTAPI_PID" 2>/dev/null && ! sudo kill -0 "$FASTAPI_PID" 2>/dev/null; then
        echo "⛔ Error: FastAPI server process died"
        echo "📜 Last few lines of FastAPI log:"
        tail -n 10 "$FASTAPI_LOG_FILE" 2>/dev/null || echo "No log file found"
        exit 1
    fi
    
    # Check if server is responding to HTTP requests
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/ 2>/dev/null | grep -q "200\|404"; then
        echo "✅ FastAPI server started successfully (PID: $FASTAPI_PID)"
        echo "🌐 FastAPI server accessible at: http://localhost:8001"
        break
    elif [ $i -eq $HEALTH_CHECK_RETRIES ]; then
        echo "⛔ Error: FastAPI server failed health check after ${HEALTH_CHECK_RETRIES} attempts"
        echo "📜 Last few lines of FastAPI log:"
        tail -n 10 "$FASTAPI_LOG_FILE" 2>/dev/null || echo "No log file found"
        echo "💡 Try running: curl -v http://localhost:8001/ to debug connection issues"
        exit 1
    fi
    
    echo "⏳ Health check attempt $i/$HEALTH_CHECK_RETRIES - waiting ${HEALTH_CHECK_DELAY}s..."
    sleep $HEALTH_CHECK_DELAY
done

# Return to original directory
cd "$TT_STUDIO_ROOT"

# Final message to the user with instructions on where to access the app
echo -e "\e[1;32m=====================================================\e[0m"
echo -e "\e[1;32m          🎉 TT-Studio Setup Complete! 🎉           \e[0m"
echo -e "\e[1;32m=====================================================\e[0m"
echo
echo -e "\e[1;32m🚀 Applications are now accessible at:\e[0m"
echo -e "   \e[1;32m• TT-Studio:\e[0m \e[4mhttp://localhost:3000\e[0m"
echo -e "   \e[1;32m• FastAPI Server:\e[0m \e[4mhttp://localhost:8001\e[0m"

# Let user know if special modes are enabled
if [[ "$RUN_DEV_MODE" = true ]]; then
    echo
    echo -e "\e[1;34m=====================================================\e[0m"
    echo -e "\e[1;34m             💻 Development Mode: ENABLED            \e[0m"
    echo -e "\e[1;34m=====================================================\e[0m"
    echo -e "\e[1;34m💻 Live code reloading is active for both frontend and backend.\e[0m"
fi

# Let user know if TT hardware support is enabled
if [[ "$RUN_TT_HARDWARE" = true ]]; then
    echo
    echo -e "\e[1;34m=====================================================\e[0m"
    echo -e "\e[1;34m             🔧  Tenstorrent Device: MOUNTED         \e[0m"
    echo -e "\e[1;34m=====================================================\e[0m"
    echo -e "\e[1;34m🔧 Tenstorrent device has been successfully mounted and enabled in this setup.\e[0m"
fi

echo
echo -e "\e[1;33m=====================================================\e[0m"
echo -e "\e[1;33m            🧹 Cleanup Instructions 🧹              \e[0m"
echo -e "\e[1;33m=====================================================\e[0m"
echo
echo -e "\e[1;33m🛑 To stop the app and services, run:\e[0m \e[1;33m'./startup.sh --cleanup'\e[0m"
echo
echo -e "\e[1;33m=====================================================\e[0m"

# If in dev mode, show logs
if [[ "$RUN_DEV_MODE" = true ]]; then
    echo
    echo -e "\e[1;33m=====================================================\e[0m"
    echo -e "\e[1;33m            📜 Starting Log Stream...              \e[0m"
    echo -e "\e[1;33m=====================================================\e[0m"
    echo -e "\e[1;33m⚠️  Press Ctrl+C to stop viewing logs\e[0m"
    echo
    cd "${TT_STUDIO_ROOT}/app" && docker compose logs -f &
    tail -f "$FASTAPI_LOG_FILE" &
    wait
fi