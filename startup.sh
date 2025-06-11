#!/bin/bash

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
    # echo -e "  --setup             🔧 Run the setup script with sudo and all steps before executing main steps."
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
            echo -e "${C_RED}⛔ Unknown option: $arg${C_RESET}"
            usage
            ;;
    esac
done

# Display welcome banner unless in cleanup mode
if [[ "$RUN_CLEANUP" = false ]]; then
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
fi

# Set TT_STUDIO_ROOT before any operations
TT_STUDIO_ROOT="$(pwd)"
echo -e "${C_CYAN}TT_STUDIO_ROOT is set to: ${TT_STUDIO_ROOT}${C_RESET}"

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

# Step 4: Pull Docker image for agent 
echo -e "${C_BLUE}Pulling latest agent image...${C_RESET}"
docker pull ghcr.io/tenstorrent/tt-studio/agent_image:v1.1 || { echo -e "${C_RED}Docker pull failed. Please authenticate and re-run the docker pull manually.${C_RESET}"; }

# Step 5: Run Docker Compose with appropriate configuration
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

# Final summary display
echo
echo -e "${C_GREEN}✔ Setup Complete!${C_RESET}"
echo
echo -e "${C_WHITE}${C_BOLD}┌─────────────────────────────────────────────────────────┐${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│                                                         │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   🚀 Tenstorrent TT Studio is ready!                  │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│                                                         │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   Access it at: ${C_CYAN}http://localhost:3000${C_RESET}${C_WHITE}${C_BOLD}                 │${C_RESET}"
if [[ "$OS_NAME" == "Darwin" ]]; then
    echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Cmd+Click the link to open in browser)${C_RESET}${C_WHITE}${C_BOLD}             │${C_RESET}"
else
    echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Ctrl+Click the link to open in browser)${C_RESET}${C_WHITE}${C_BOLD}            │${C_RESET}"
fi
echo -e "${C_WHITE}${C_BOLD}│                                                         │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}└─────────────────────────────────────────────────────────┘${C_RESET}"
echo

# Display info about special modes if they are enabled
if [[ "$RUN_DEV_MODE" = true || "$RUN_TT_HARDWARE" = true ]]; then
    echo -e "${C_WHITE}${C_BOLD}┌─────────────────────────────────────────────────────────┐${C_RESET}"
    echo -e "${C_WHITE}${C_BOLD}│                    ${C_YELLOW}Active Modes${C_WHITE}${C_BOLD}                         │${C_RESET}"
    if [[ "$RUN_DEV_MODE" = true ]]; then
        echo -e "${C_WHITE}${C_BOLD}│   ${C_CYAN}💻 Development Mode: ENABLED${C_WHITE}${C_BOLD}                        │${C_RESET}"
    fi
    if [[ "$RUN_TT_HARDWARE" = true ]]; then
        echo -e "${C_WHITE}${C_BOLD}│   ${C_CYAN}🔧 Tenstorrent Device: MOUNTED${C_WHITE}${C_BOLD}                     │${C_RESET}"
    fi
    echo -e "${C_WHITE}${C_BOLD}└─────────────────────────────────────────────────────────┘${C_RESET}"
    echo
fi

echo -e "${C_WHITE}${C_BOLD}┌─────────────────────────────────────────────────────────┐${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}🧹 To stop all services, run:${C_RESET}${C_WHITE}${C_BOLD}                       │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}│   ${C_MAGENTA}./startup.sh --cleanup${C_RESET}${C_WHITE}${C_BOLD}                              │${C_RESET}"
echo -e "${C_WHITE}${C_BOLD}└─────────────────────────────────────────────────────────┘${C_RESET}"
echo

# If in dev mode, show logs
if [[ "$RUN_DEV_MODE" = true ]]; then
    echo -e "${C_YELLOW}📜 Tailing logs in development mode. Press Ctrl+C to stop.${C_RESET}"
    echo
    cd "${TT_STUDIO_ROOT}/app" && docker compose logs -f
fi

