#!/bin/bash
# ⚠️ DEPRECATION WARNING ⚠️
# [DEPRECATED]
# This script is deprecated and will not be maintained.
# Please use the `run.py` script instead.
# The `run.py` script is the new entry point for the TT-Studio project.
# It is located in the `app` directory.

# SPDX-License-Identifier: Apache-2.0
# 
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

set -euo pipefail  # Exit on error, print commands, unset variables treated as errors, and exit on pipeline failure

# --- Color Definitions ---
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_BLUE='\033[0;34m'
C_MAGENTA='\033[0;35m'
C_CYAN='\033[0;36m'
C_WHITE='\033[0;37m'
C_BOLD='\033[1m'
C_ORANGE='\033[38;5;208m'
C_TT_PURPLE='\033[38;5;99m' # Corresponds to #7C68FA

# --- Color Definitions ---
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_BLUE='\033[0;34m'
C_MAGENTA='\033[0;35m'
C_CYAN='\033[0;36m'
C_WHITE='\033[0;37m'
C_BOLD='\033[1m'
C_ORANGE='\033[38;5;208m'
C_TT_PURPLE='\033[38;5;99m' # Corresponds to #7C68FA

# Define setup script path
SETUP_SCRIPT="./setup.sh"

# Step 0: detect OS
OS_NAME="$(uname)"

# Function to check Docker installation
check_docker_installation() {
    if ! command -v docker &> /dev/null; then
        echo -e "${C_RED}⛔ Error: Docker is not installed.${C_RESET}"
        if [[ "$OS_NAME" == "Darwin" ]]; then
            echo -e "${C_YELLOW}Please install Docker Desktop from: https://www.docker.com/products/docker-desktop${C_RESET}"
        else
            echo -e "${C_YELLOW}Please install Docker using: sudo apt install docker.io docker-compose-plugin${C_RESET}"
            echo -e "${C_YELLOW}Then add your user to the docker group: sudo usermod -aG docker $USER${C_RESET}"
        fi
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        echo -e "${C_RED}⛔ Error: Docker Compose is not installed.${C_RESET}"
        if [[ "$OS_NAME" == "Darwin" ]]; then
            echo -e "${C_YELLOW}Please install Docker Desktop from: https://www.docker.com/products/docker-desktop${C_RESET}"
        else
            echo -e "${C_YELLOW}Please install Docker Compose using: sudo apt install docker-compose-plugin${C_RESET}"
        fi
        exit 1
    fi
}

# Function to shorten path for display
shorten_path() {
    local path="$1"
    IFS='/' read -ra segments <<< "$path"
    local num_segments=${#segments[@]}
    
    if [ $num_segments -le 3 ]; then
        echo "$path"
    else
        echo ".../${segments[$num_segments-3]}/${segments[$num_segments-2]}/${segments[$num_segments-1]}"
    fi
}

# Function to show usage/help
usage() {
    echo -e "${C_TT_PURPLE}${C_BOLD}"
    echo "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓"
    echo "┃        🤖  TT Studio Startup Script - Help & Usage         ┃"
    echo "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛"
    echo -e "${C_RESET}"
    echo -e "${C_BOLD}${C_CYAN}Usage:${C_RESET} ${C_WHITE}./startup.sh [options]${C_RESET}\n"
    echo -e "${C_BOLD}${C_YELLOW}Description:${C_RESET}"
    echo -e "  This script sets up the TT-Studio environment by performing the following steps:"
    echo -e "    ${C_GREEN}1.${C_RESET} 🧭  Detects the OS."
    echo -e "    ${C_GREEN}2.${C_RESET} 🛠️   Sets the TT_STUDIO_ROOT variable in .env based on the running directory."
    echo -e "    ${C_GREEN}3.${C_RESET} 🌐  Checks for and creates a Docker network named 'tt_studio_network' if not present."
    echo -e "    ${C_GREEN}4.${C_RESET} 🚀  Runs Docker Compose to start the TT Studio services.\n"
    echo -e "${C_BOLD}${C_MAGENTA}Options:${C_RESET}"
    echo -e "${C_CYAN}  --help      ${C_RESET}${C_WHITE}❓  Show this help message and exit.${C_RESET}"
    # echo -e "${C_CYAN}  --setup     ${C_RESET}${C_WHITE}🔧  Run the setup script with sudo and all steps before executing main steps.${C_RESET}"
    echo -e "${C_CYAN}  --cleanup   ${C_RESET}${C_WHITE}🧹  Stop and remove Docker services.${C_RESET}"
    echo -e "${C_CYAN}  --dev       ${C_RESET}${C_WHITE}💻  Run in development mode with live code reloading.${C_RESET}\n"
    echo -e "${C_BOLD}${C_ORANGE}Examples:${C_RESET}"
    #! TODO add back in support once setup scripts are merged in
    # echo -e "  ./startup.sh --setup             # Run setup steps as sudo, then main steps" phase this out for now .
    echo -e "  ${C_GREEN}./startup.sh${C_RESET}           ${C_WHITE}# Run the main setup steps directly${C_RESET}"
    echo -e "  ${C_GREEN}./startup.sh --cleanup${C_RESET}  ${C_WHITE}# Stop and clean up Docker services${C_RESET}"
    echo -e "  ${C_GREEN}./startup.sh --help${C_RESET}     ${C_WHITE}# Display this help message${C_RESET}"
    echo -e "  ${C_GREEN}./startup.sh --dev${C_RESET}      ${C_WHITE}# Run in development mode${C_RESET}\n"
    echo -e "${C_TT_PURPLE}${C_BOLD}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${C_RESET}"
    echo -e "${C_TT_PURPLE}${C_BOLD}┃  For more info, see the README or visit our documentation.  ┃${C_RESET}"
    echo -e "${C_TT_PURPLE}${C_BOLD}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${C_RESET}"
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
            echo -e "${C_RED}⛔ Unknown option: $arg${C_RESET}"
            usage
            ;;
    esac
done

# Check Docker installation first
check_docker_installation

# Function to display the welcome banner
function display_welcome_banner() {
    # Clear screen for a clean splash screen effect
    clear
    echo -e "${C_TT_PURPLE}"
    echo "┌──────────────────────────────────┐"
    echo "│      ✨ Welcome to TT Studio     │"
    echo "└──────────────────────────────────┘"
    echo ""
    echo "████████╗████████╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ "
    echo "╚══██╔══╝╚══██╔══╝    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗"
    echo "   ██║      ██║       ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║"
    echo "   ██║      ██║       ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║"
    echo "   ██║      ██║       ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝"
    echo "   ╚═╝      ╚═╝       ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ "
    echo -e "${C_RESET}"
    echo ""
    # An extra newline for spacing
    echo
}

# Display welcome banner unless in cleanup mode
if [[ "$RUN_CLEANUP" = false ]]; then
    display_welcome_banner
fi

# Set TT_STUDIO_ROOT before any operations
TT_STUDIO_ROOT="$(pwd)"
SHORT_PATH=$(shorten_path "$TT_STUDIO_ROOT")
echo -e "${C_CYAN}TT_STUDIO_ROOT is set to: ${SHORT_PATH}${C_RESET}"

DOCKER_COMPOSE_FILE="${TT_STUDIO_ROOT}/app/docker-compose.yml"
DOCKER_COMPOSE_TT_HARDWARE_FILE="${TT_STUDIO_ROOT}/app/docker-compose.tt-hardware.yml"
ENV_FILE_PATH="${TT_STUDIO_ROOT}/app/.env"
ENV_FILE_DEFAULT="${TT_STUDIO_ROOT}/app/.env.default"

if [[ ! -f "$DOCKER_COMPOSE_FILE" ]]; then
    echo -e "${C_RED}⛔ Error: docker-compose.yml not found at $DOCKER_COMPOSE_FILE.${C_RESET}"
    exit 1
fi

# Cleanup step if --cleanup is provided
if [[ "$RUN_CLEANUP" = true ]]; then
    echo -e "${C_YELLOW}🧹 Stopping and removing Docker services...${C_RESET}"
    cd "${TT_STUDIO_ROOT}/app" && docker compose down
    if [[ $? -eq 0 ]]; then
        echo -e "${C_GREEN}✅ Services stopped and removed.${C_RESET}"
    else
        echo -e "${C_RED}⛔ Failed to clean up services.${C_RESET}"
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
    echo -e "${C_BLUE}🔧 Running setup script with sudo for all steps...${C_RESET}"
    if [[ -x "$SETUP_SCRIPT" ]]; then
        sudo "$SETUP_SCRIPT" --sudo all
        if [[ $? -ne 0 ]]; then
            echo -e "${C_RED}⛔ Setup script encountered an error. Exiting.${C_RESET}"
            exit 1
        fi
    else
        echo -e "${C_RED}⛔ Error: Setup script '$SETUP_SCRIPT' not found or not executable.${C_RESET}"
        exit 1
    fi
fi

# Step 1: Create .env from .env.default if necessary, and set TT_STUDIO_ROOT and ENABLE_TT_HARDWARE
if [[ ! -f "${ENV_FILE_PATH}" && -f "${ENV_FILE_DEFAULT}" ]]; then
    echo -e "${C_BLUE}Creating .env file from .env.default${C_RESET}"
    cp "${ENV_FILE_DEFAULT}" "${ENV_FILE_PATH}"
fi

# run a simple command to check if /dev/tenstorrent exists 
if [[ -e "/dev/tenstorrent" ]]; then
    echo -e "${C_GREEN}🖥️ Tenstorrent device detected at /dev/tenstorrent.${C_RESET}"

    # Prompt user for enabling TT hardware support
    if [[ "$RUN_TT_HARDWARE" = false ]]; then
        echo
        echo -e "${C_RED}❓ QUESTION: Do you want to mount Tenstorrent hardware?${C_RESET}"
        echo -e "${C_YELLOW}   This will enable direct access to your Tenstorrent device.${C_RESET}"
        while true; do
            echo -n -e "${C_CYAN}   Please choose (y/n): ${C_RESET}"
            read enable_hardware
            case "$enable_hardware" in
                [Yy]* ) 
                    RUN_TT_HARDWARE=true
                    echo -e "${C_GREEN}Enabling Tenstorrent hardware support...${C_RESET}"
                    break
                    ;;
                [Nn]* ) 
                    RUN_TT_HARDWARE=false
                    break
                    ;;
                * ) 
                    echo -e "${C_RED}   ⚠️  Please answer 'y' or 'n'${C_RESET}"
                    ;;
            esac
        done
    fi
else
    echo -e "${C_YELLOW}⛔ No Tenstorrent device found at /dev/tenstorrent. Skipping Mounting hardware setup.${C_RESET}"
fi

# Update TT_STUDIO_ROOT and ENABLE_TT_HARDWARE in the .env file
if [[ -f "${ENV_FILE_PATH}" ]]; then
    # Check OS and set sed command accordingly
    if [[ "$OS_NAME" == "Darwin" ]]; then
        # macOS sed requires an empty string after -i
        sed -i '' "s|^TT_STUDIO_ROOT=.*|TT_STUDIO_ROOT=${TT_STUDIO_ROOT}|g" "${ENV_FILE_PATH}"

        if [[ "$RUN_TT_HARDWARE" = true ]]; then
            sed -i '' "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=true|g" "${ENV_FILE_PATH}"
            echo -e "${C_BLUE}Enabled TT hardware support in .env file${C_RESET}"
        else
            sed -i '' "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=false|g" "${ENV_FILE_PATH}"
            echo -e "${C_BLUE}Disabled TT hardware support in .env file${C_RESET}"
        fi
    else
        # Linux syntax for sed
        sed -i "s|^TT_STUDIO_ROOT=.*|TT_STUDIO_ROOT=${TT_STUDIO_ROOT}|g" "${ENV_FILE_PATH}"

        if [[ "$RUN_TT_HARDWARE" = true ]]; then
            sed -i "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=true|g" "${ENV_FILE_PATH}"
            echo -e "${C_BLUE}Enabled TT hardware support in .env file${C_RESET}"
        else
            sed -i "s|^ENABLE_TT_HARDWARE=.*|ENABLE_TT_HARDWARE=false|g" "${ENV_FILE_PATH}"
            echo -e "${C_BLUE}Disabled TT hardware support in .env file${C_RESET}"
        fi
    fi
else
    echo -e "${C_RED}⛔ Error: .env file does not exist and could not be created.${C_RESET}"
    exit 1
fi

# Step 2: Source env vars, ensure directories
source "${ENV_FILE_PATH}"
# make persistent volume on host user user permissions
if [ ! -d "$HOST_PERSISTENT_STORAGE_VOLUME" ]; then
    echo -e "${C_BLUE}Creating persistent storage directory...${C_RESET}"
    mkdir "$HOST_PERSISTENT_STORAGE_VOLUME"
    if [ $? -ne 0 ]; then
        echo -e "${C_RED}⛔ Error: Failed to create directory $HOST_PERSISTENT_STORAGE_VOLUME${C_RESET}"
        exit 1
    fi
fi

# Step 3: Check if the Docker network already exists
NETWORK_NAME="tt_studio_network"
if docker network ls | grep -qw "${NETWORK_NAME}"; then
    echo -e "${C_BLUE}Network '${NETWORK_NAME}' exists.${C_RESET}"
else
    echo -e "${C_BLUE}Creating network '${NETWORK_NAME}'...${C_RESET}"
    docker network create --driver bridge "${NETWORK_NAME}"
    if [ $? -eq 0 ]; then
        echo -e "${C_GREEN}Network created successfully.${C_RESET}"
    else
        echo -e "${C_RED}Failed to create network.${C_RESET}"
        exit 1
    fi
fi

# Display Docker version information
echo -e "${C_BLUE}Docker version:${C_RESET}"
docker --version
echo -e "${C_BLUE}Docker Compose version:${C_RESET}"
docker compose version

# Step 4: Run Docker Compose with appropriate configuration
COMPOSE_FILES="-f ${TT_STUDIO_ROOT}/app/docker-compose.yml"

if [[ "$RUN_DEV_MODE" = true ]]; then
    echo -e "${C_MAGENTA}🚀 Running Docker Compose in development mode...${C_RESET}"
    COMPOSE_FILES="${COMPOSE_FILES} -f ${TT_STUDIO_ROOT}/app/docker-compose.dev-mode.yml"
else
    echo -e "${C_MAGENTA}🚀 Running Docker Compose in production mode...${C_RESET}"
fi

if [[ "$RUN_TT_HARDWARE" = true ]]; then
    echo -e "${C_MAGENTA}🚀 Running Docker Compose with TT hardware support...${C_RESET}"
    COMPOSE_FILES="${COMPOSE_FILES} -f ${DOCKER_COMPOSE_TT_HARDWARE_FILE}"
else
    echo -e "${C_MAGENTA}🚀 Running Docker Compose without TT hardware support...${C_RESET}"
fi

echo -e "${C_BOLD}${C_BLUE}🚀 Starting services with selected configuration...${C_RESET}"
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
    git clone -b atupe/studio-fastapi-main https://github.com/tenstorrent/tt-inference-server.git "$INFERENCE_SERVER_DIR"
    if [ $? -ne 0 ]; then
        echo "⛔ Error: Failed to clone tt-inference-server repository"
        exit 1
    fi
else
    echo "📁 TT Inference Server directory already exists, pulling latest changes..."
    cd "$INFERENCE_SERVER_DIR"
    git fetch origin atupe/studio-fastapi-main
    git checkout atupe/studio-fastapi-main
    git pull origin atupe/studio-fastapi-main
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
        echo "🔐 FastAPI server: ${C_CYAN}http://localhost:8001${C_RESET} (check: curl http://localhost:8001/)"
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

# Final summary display
echo
echo -e "${C_GREEN}✔ Setup Complete!${C_RESET}"
echo
echo -e "${C_WHITE}${C_BOLD}┌────────────────────────────────────────────────────────────┐${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│                                                            │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   🚀 Tenstorrent TT Studio is ready!                     │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│                                                            │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   Access it at: ${C_CYAN}http://localhost:3000${C_RESET}${C_WHITE}${C_BOLD}                    │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   FastAPI server: ${C_CYAN}http://localhost:8001${C_RESET}${C_WHITE}${C_BOLD}                  │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Health check: curl http://localhost:8001/)${C_RESET}${C_WHITE}${C_BOLD}           │${C_RESET}"
if [[ "$OS_NAME" == "Darwin" ]]; then
    echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Cmd+Click the link to open in browser)${C_RESET}${C_WHITE}${C_BOLD}                │${C_RESET}"
else
    echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Ctrl+Click the link to open in browser)${C_RESET}${C_WHITE}${C_BOLD}               │${C_RESET}"
fi
echo -e "${C_WHITE}${C_BOLD}│                                                            │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}└────────────────────────────────────────────────────────────┘${C_RESET}"
echo

# Display info about special modes if they are enabled
if [[ "$RUN_DEV_MODE" = true || "$RUN_TT_HARDWARE" = true ]]; then
    echo -e "${C_WHITE}${C_BOLD}┌────────────────────────────────────────────────────────────┐${C_RESET}"
    echo -e "${C_WHITE}${C_BOLD}│                    ${C_YELLOW}Active Modes${C_WHITE}${C_BOLD}                            │${C_RESET}"
    if [[ "$RUN_DEV_MODE" = true ]]; then
        echo -e "${C_WHITE}${C_BOLD}│   ${C_CYAN}💻 Development Mode: ENABLED${C_WHITE}${C_BOLD}                           │${C_RESET}"
    fi
    if [[ "$RUN_TT_HARDWARE" = true ]]; then
        echo -e "${C_WHITE}${C_BOLD}│   ${C_CYAN}🔧 Tenstorrent Device: MOUNTED${C_WHITE}${C_BOLD}                         │${C_RESET}"
    fi
    echo -e "${C_WHITE}${C_BOLD}└──────────https://github.com/tenstorrent/tt-inference-server/blob/anirud/fast-api-container-fetching-fixes/requirements-api.txt──────────────────────────────────────────────────┘${C_RESET}"
    echo
fi

echo -e "${C_WHITE}${C_BOLD}┌────────────────────────────────────────────────────────────┐${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}🧹 To stop all services, run:${C_RESET}${C_WHITE}${C_BOLD}                           │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   ${C_MAGENTA}./startup.sh --cleanup${C_RESET}${C_WHITE}${C_BOLD}                                  │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}└────────────────────────────────────────────────────────────┘${C_RESET}"
echo

# Try to open the browser automatically
if [[ "$OS_NAME" == "Darwin" ]]; then
    open "http://localhost:3000" 2>/dev/null || echo -e "${C_YELLOW}⚠️  Please open http://localhost:3000 in your browser manually${C_RESET}"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:3000" 2>/dev/null || echo -e "${C_YELLOW}⚠️  Please open http://localhost:3000 in your browser manually${C_RESET}"
else
    echo -e "${C_YELLOW}⚠️  Please open http://localhost:3000 in your browser manually${C_RESET}"
fi

# If in dev mode, show logs
if [[ "$RUN_DEV_MODE" = true ]]; then
    echo -e "${C_YELLOW}📜 Tailing logs in development mode. Press Ctrl+C to stop.${C_RESET}"
    echo
    cd "${TT_STUDIO_ROOT}/app" && docker compose logs -f &
    tail -f "$FASTAPI_LOG_FILE" &
    wait
fi
