#! WIll BE DEPRECATED SOON

#! This script is deprecated and will be removed soon.
#! Please use the run.py python script in the root of the project.

#!/bin/bash

# # SPDX-License-Identifier: Apache-2.0
# # 
# # SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# set -euo pipefail  # Exit on error, print commands, unset variables treated as errors, and exit on pipeline failure

# # --- Color Definitions ---
# C_RESET='\033[0m'
# C_RED='\033[0;31m'
# C_GREEN='\033[0;32m'
# C_YELLOW='\033[0;33m'
# C_BLUE='\033[0;34m'
# C_MAGENTA='\033[0;35m'
# C_CYAN='\033[0;36m'
# C_WHITE='\033[0;37m'
# C_BOLD='\033[1m'
# C_ORANGE='\033[38;5;208m'
# C_TT_PURPLE='\033[38;5;99m' # Corresponds to #7C68FA

# # Define setup script path
# SETUP_SCRIPT="./setup.sh"

# # Step 0: detect OS
# OS_NAME="$(uname)"

# # Function to check Docker installation
# check_docker_installation() {
#     if ! command -v docker &> /dev/null; then
#         echo -e "${C_RED}⛔ Error: Docker is not installed.${C_RESET}"
#         if [[ "$OS_NAME" == "Darwin" ]]; then
#             echo -e "${C_YELLOW}Please install Docker Desktop from: https://www.docker.com/products/docker-desktop${C_RESET}"
#         else
#             echo -e "${C_YELLOW}Please install Docker using: sudo apt install docker.io docker-compose-plugin${C_RESET}"
#             echo -e "${C_YELLOW}Then add your user to the docker group: sudo usermod -aG docker $USER${C_RESET}"
#         fi
#         exit 1
#     fi

#     if ! docker compose version &> /dev/null; then
#         echo -e "${C_RED}⛔ Error: Docker Compose is not installed.${C_RESET}"
#         if [[ "$OS_NAME" == "Darwin" ]]; then
#             echo -e "${C_YELLOW}Please install Docker Desktop from: https://www.docker.com/products/docker-desktop${C_RESET}"
#         else
#             echo -e "${C_YELLOW}Please install Docker Compose using: sudo apt install docker-compose-plugin${C_RESET}"
#         fi
#         exit 1
#     fi
# }

# # Function to shorten path for display
# shorten_path() {
#     local path="$1"
#     IFS='/' read -ra segments <<< "$path"
#     local num_segments=${#segments[@]}
    
#     if [ $num_segments -le 3 ]; then
#         echo "$path"
#     else
#         echo ".../${segments[$num_segments-3]}/${segments[$num_segments-2]}/${segments[$num_segments-1]}"
#     fi
# }

# # Function to show usage/help
# usage() {
#     echo -e "${C_TT_PURPLE}${C_BOLD}"
#     echo "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓"
#     echo "┃        🤖  TT Studio Startup Script - Help & Usage         ┃"
#     echo "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛"
#     echo -e "${C_RESET}"
#     echo -e "${C_BOLD}${C_CYAN}Usage:${C_RESET} ${C_WHITE}./startup.sh [options]${C_RESET}\n"
#     echo -e "${C_BOLD}${C_YELLOW}Description:${C_RESET}"
#     echo -e "  This script sets up the TT-Studio environment by performing the following steps:"
#     echo -e "    ${C_GREEN}1.${C_RESET} 🧭  Detects the OS."
#     echo -e "    ${C_GREEN}2.${C_RESET} 🛠️   Sets the TT_STUDIO_ROOT variable in .env based on the running directory."
#     echo -e "    ${C_GREEN}3.${C_RESET} 🌐  Checks for and creates a Docker network named 'tt_studio_network' if not present."
#     echo -e "    ${C_GREEN}4.${C_RESET} 🚀  Runs Docker Compose to start the TT Studio services.\n"
#     echo -e "${C_BOLD}${C_MAGENTA}Options:${C_RESET}"
#     echo -e "${C_CYAN}  --help      ${C_RESET}${C_WHITE}❓  Show this help message and exit.${C_RESET}"
#     # echo -e "${C_CYAN}  --setup     ${C_RESET}${C_WHITE}🔧  Run the setup script with sudo and all steps before executing main steps.${C_RESET}"
#     echo -e "${C_CYAN}  --cleanup   ${C_RESET}${C_WHITE}🧹  Stop and remove Docker services.${C_RESET}"
#     echo -e "${C_CYAN}  --dev       ${C_RESET}${C_WHITE}💻  Run in development mode with live code reloading.${C_RESET}\n"
#     echo -e "${C_BOLD}${C_ORANGE}Examples:${C_RESET}"
#     #! TODO add back in support once setup scripts are merged in
#     # echo -e "  ./startup.sh --setup             # Run setup steps as sudo, then main steps" phase this out for now .
#     echo -e "  ${C_GREEN}./startup.sh${C_RESET}           ${C_WHITE}# Run the main setup steps directly${C_RESET}"
#     echo -e "  ${C_GREEN}./startup.sh --cleanup${C_RESET}  ${C_WHITE}# Stop and clean up Docker services${C_RESET}"
#     echo -e "  ${C_GREEN}./startup.sh --help${C_RESET}     ${C_WHITE}# Display this help message${C_RESET}"
#     echo -e "  ${C_GREEN}./startup.sh --dev${C_RESET}      ${C_WHITE}# Run in development mode${C_RESET}\n"
#     echo -e "${C_TT_PURPLE}${C_BOLD}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${C_RESET}"
#     echo -e "${C_TT_PURPLE}${C_BOLD}┃  For more info, see the README or visit our documentation.  ┃${C_RESET}"
#     echo -e "${C_TT_PURPLE}${C_BOLD}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${C_RESET}"
#     exit 0
# }

# # Initialize flags
# RUN_SETUP=false
# RUN_CLEANUP=false
# RUN_TT_HARDWARE=false
# RUN_DEV_MODE=false

# # Parse options
# for arg in "$@"; do
#     case $arg in
#         --help)
#             usage
#             ;;
#         --setup)
#             RUN_SETUP=true
#             ;;
#         --cleanup)
#             RUN_CLEANUP=true
#             ;;
#         --tt-hardware)
#             RUN_TT_HARDWARE=true
#             ;;
#         --dev)
#             RUN_DEV_MODE=true
#             ;;
#         *)
#             echo -e "${C_RED}⛔ Unknown option: $arg${C_RESET}"
#             usage
#             ;;
#     esac
# done

# # Check Docker installation first
# check_docker_installation

# # Function to display the welcome banner
# function display_welcome_banner() {
#     # Clear screen for a clean splash screen effect
#     clear
#     echo -e "${C_TT_PURPLE}"
#     echo "┌──────────────────────────────────┐"
#     echo "│      ✨ Welcome to TT Studio     │"
#     echo "└──────────────────────────────────┘"
#     echo ""
#     echo "████████╗████████╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ "
#     echo "╚══██╔══╝╚══██╔══╝    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗"
#     echo "   ██║      ██║       ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║"
#     echo "   ██║      ██║       ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║"
#     echo "   ██║      ██║       ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝"
#     echo "   ╚═╝      ╚═╝       ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ "
#     echo -e "${C_RESET}"
#     echo ""
#     # An extra newline for spacing
#     echo
# }

# # Display welcome banner unless in cleanup mode
# if [[ "$RUN_CLEANUP" = false ]]; then
#     display_welcome_banner
# fi

# # Set TT_STUDIO_ROOT before any operations
# TT_STUDIO_ROOT="$(pwd)"
# SHORT_PATH=$(shorten_path "$TT_STUDIO_ROOT")
# echo -e "${C_CYAN}TT_STUDIO_ROOT is set to: ${SHORT_PATH}${C_RESET}"

# DOCKER_COMPOSE_FILE="${TT_STUDIO_ROOT}/app/docker-compose.yml"
# DOCKER_COMPOSE_TT_HARDWARE_FILE="${TT_STUDIO_ROOT}/app/docker-compose.tt-hardware.yml"
# ENV_FILE_PATH="${TT_STUDIO_ROOT}/app/.env"
# ENV_FILE_DEFAULT="${TT_STUDIO_ROOT}/app/.env.default"

# if [[ ! -f "$DOCKER_COMPOSE_FILE" ]]; then
#     echo -e "${C_RED}⛔ Error: docker-compose.yml not found at $DOCKER_COMPOSE_FILE.${C_RESET}"
#     exit 1
# fi

# # Cleanup step if --cleanup is provided
# if [[ "$RUN_CLEANUP" = true ]]; then
#     echo -e "${C_YELLOW}🧹 Stopping and removing Docker services...${C_RESET}"
#     cd "${TT_STUDIO_ROOT}/app" && docker compose down
#     if [[ $? -eq 0 ]]; then
#         echo -e "${C_GREEN}✅ Services stopped and removed.${C_RESET}"
#     else
#         echo -e "${C_RED}⛔ Failed to clean up services.${C_RESET}"
#         exit 1
#     fi
    
#     # Clean up FastAPI server if it's running
#     FASTAPI_PID_FILE="${TT_STUDIO_ROOT}/fastapi.pid"
#     echo "🧹 Cleaning up FastAPI server..."
    
#     # Check if port 8001 is in use and kill any process using it
#     if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost 8001 >/dev/null 2>&1; then
#         echo "🧹 Stopping processes on port 8001..."
        
#         # Try multiple approaches to be thorough
#         # 1. Check PID file
#         if [[ -f "$FASTAPI_PID_FILE" ]]; then
#             FASTAPI_PID=$(cat "$FASTAPI_PID_FILE")
#             if kill -0 "$FASTAPI_PID" 2>/dev/null; then
#                 echo "🧹 Stopping FastAPI server (PID: $FASTAPI_PID)..."
#                 sudo kill "$FASTAPI_PID"
#                 sleep 2
#                 if kill -0 "$FASTAPI_PID" 2>/dev/null; then
#                     echo "🧹 Force killing FastAPI server..."
#                     sudo kill -9 "$FASTAPI_PID"
#                 fi
#                 echo "✅ FastAPI server stopped."
#             fi
#         fi
        
#         # 2. Try finding process on port 8001 directly
#         PORT_PID=$(lsof -Pi :8001 -sTCP:LISTEN -t 2>/dev/null || echo "")
#         if [[ -n "$PORT_PID" ]]; then
#             echo "🧹 Found additional process on port 8001 (PID: $PORT_PID)..."
#             sudo kill -15 $PORT_PID 2>/dev/null || true
#             sleep 2
            
#             # Check if process is still running
#             if kill -0 $PORT_PID 2>/dev/null; then
#                 echo "⚠️  Process still running. Attempting force kill..."
#                 sudo kill -9 $PORT_PID 2>/dev/null || true
#                 sleep 1
#             fi
#         fi
        
#         # 3. OS specific approach for any remaining process
#         if [[ "$OS_NAME" == "Darwin" ]]; then
#             # macOS
#             sudo lsof -i :8001 -sTCP:LISTEN -t | xargs sudo kill -9 2>/dev/null || true
#         else
#             # Linux
#             sudo fuser -k 8001/tcp 2>/dev/null || true
#         fi
        
#         # Final check
#         if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost 8001 >/dev/null 2>&1; then
#             echo "⚠️ Warning: Could not free port 8001 completely."
#         else
#             echo "✅ Port 8001 has been freed."
#         fi
#     else
#         echo "✅ Port 8001 is already free."
#     fi
    
#     # Clean up PID and log files
#     rm -f "$FASTAPI_PID_FILE"
#     rm -f "${TT_STUDIO_ROOT}/fastapi.log"
#     echo "✅ Removed PID and log files."
    
#     echo -e "${C_GREEN}🧹 Cleanup completed successfully.${C_RESET}"
#     exit 0
# fi

# # Step 0: Conditionally run setup.sh with sudo and all steps if --setup is provided
# if [[ "$RUN_SETUP" = true ]]; then
#     echo -e "${C_BLUE}🔧 Running setup script with sudo for all steps...${C_RESET}"
#     if [[ -x "$SETUP_SCRIPT" ]]; then
#         sudo "$SETUP_SCRIPT" --sudo all
#         if [[ $? -ne 0 ]]; then
#             echo -e "${C_RED}⛔ Setup script encountered an error. Exiting.${C_RESET}"
#             exit 1
#         fi
#     else
#         echo -e "${C_RED}⛔ Error: Setup script '$SETUP_SCRIPT' not found or not executable.${C_RESET}"
#         exit 1
#     fi
# fi

# # Step 1: Create .env from .env.default if necessary, and set TT_STUDIO_ROOT and ENABLE_TT_HARDWARE
# if [[ ! -f "${ENV_FILE_PATH}" && -f "${ENV_FILE_DEFAULT}" ]]; then
#     echo -e "${C_BLUE}Creating .env file from .env.default${C_RESET}"
#     cp "${ENV_FILE_DEFAULT}" "${ENV_FILE_PATH}"
# fi

# # Function to check if a value is a placeholder
# is_placeholder() {
#     local value="$1"
#     # Check for common placeholder patterns
#     if [[ "$value" =~ ^(hf_\*+|tvly-[x]+|\*+|placeholder|your_token|xxx+|default|change_me)$ ]]; then
#         return 0  # Is a placeholder
#     fi
#     return 1  # Not a placeholder
# }

# # Function to check if configuration is tracked as completed
# is_configured() {
#     local config_name="$1"
#     if [[ -f "${ENV_FILE_PATH}" ]] && grep -q "^${config_name}_CONFIGURED=true" "${ENV_FILE_PATH}"; then
#         return 0  # Already configured
#     fi
#     return 1  # Not configured
# }

# # Function to mark a configuration as completed
# mark_as_configured() {
#     local config_name="$1"
#     if [[ -f "${ENV_FILE_PATH}" ]] && ! grep -q "^${config_name}_CONFIGURED=true" "${ENV_FILE_PATH}"; then
#         echo "${config_name}_CONFIGURED=true" >> "${ENV_FILE_PATH}"
#     fi
# }

# # Function to standardize environment variable format when writing to file
# write_env_var() {
#     local var_name="$1"
#     local var_value="$2"
#     local is_string="$3"
    
#     if [[ -f "${ENV_FILE_PATH}" ]]; then
#         # Format the value properly - strings get quoted, booleans don't
#         local formatted_value
#         if [[ "$is_string" == "true" ]]; then
#             # String values get double quotes
#             formatted_value="\"${var_value}\""
#         else
#             # Boolean or numeric values don't get quotes
#             formatted_value="${var_value}"
#         fi
        
#         # Check if variable already exists in file
#         if grep -q "^${var_name}=" "${ENV_FILE_PATH}"; then
#             # Update existing variable
#             if [[ "$OS_NAME" == "Darwin" ]]; then
#                 sed -i '' "s|^${var_name}=.*|${var_name}=${formatted_value}|g" "${ENV_FILE_PATH}"
#             else
#                 sed -i "s|^${var_name}=.*|${var_name}=${formatted_value}|g" "${ENV_FILE_PATH}"
#             fi
#         else
#             # Add new variable
#             echo "${var_name}=${formatted_value}" >> "${ENV_FILE_PATH}"
#         fi
        
#         # Mark as configured
#         mark_as_configured "${var_name}"
#     fi
# }

# # Function to parse boolean values from .env file
# parse_boolean_env() {
#     local raw_value="$1"
    
#     # Remove any quotes
#     raw_value=$(echo "$raw_value" | tr -d "'\"")
    
#     # Trim whitespace and get first word
#     raw_value=$(echo "$raw_value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | awk '{print $1}')
    
#     # Convert to lowercase
#     raw_value=$(echo "$raw_value" | tr '[:upper:]' '[:lower:]')
    
#     echo "$raw_value"
# }

# # Check for JWT_SECRET and HF_TOKEN in app/.env
# JWT_SECRET=""
# HF_TOKEN=""
# DJANGO_SECRET_KEY=""
# TAVILY_API_KEY=""
# VITE_APP_TITLE="TT Studio"
# VITE_ENABLE_DEPLOYED="false"
# VITE_ENABLE_RAG_ADMIN="false"
# RAG_ADMIN_PASSWORD=""
    
# if [[ -f "${ENV_FILE_PATH}" ]]; then
#     echo "🔍 Checking for credentials in app/.env file..."
    
#     # Extract environment variables if they exist
#     JWT_SECRET_LINE=$(grep -E "^JWT_SECRET=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$JWT_SECRET_LINE" ]]; then
#         JWT_SECRET=$(echo "$JWT_SECRET_LINE" | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
#         if [[ -n "$JWT_SECRET" ]]; then
#             # Check if it's a placeholder
#             if is_placeholder "$JWT_SECRET"; then
#                 echo "⚠️  Found JWT_SECRET in app/.env but it appears to be a placeholder"
#                 JWT_SECRET=""
#             else
#                 echo "✅ Found JWT_SECRET in app/.env"
#             fi
#         fi
#     fi
    
#     HF_TOKEN_LINE=$(grep -E "^HF_TOKEN=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$HF_TOKEN_LINE" ]]; then
#         HF_TOKEN=$(echo "$HF_TOKEN_LINE" | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
#         if [[ -n "$HF_TOKEN" ]]; then
#             # Check if it's a placeholder - but valid HF tokens actually start with hf_
#             # so only check for obvious placeholder patterns like hf_*** not legitimate tokens
#             if [[ "$HF_TOKEN" =~ ^hf_\*+$ ]] || [[ "$HF_TOKEN" == "hf_***" ]] || is_placeholder "$HF_TOKEN"; then
#                 echo "⚠️  Found HF_TOKEN in app/.env but it appears to be a placeholder"
#                 HF_TOKEN=""
#             else
#                 echo "✅ Found HF_TOKEN in app/.env"
#             fi
#         fi
#     fi
    
#     DJANGO_SECRET_KEY_LINE=$(grep -E "^DJANGO_SECRET_KEY=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$DJANGO_SECRET_KEY_LINE" ]]; then
#         DJANGO_SECRET_KEY=$(echo "$DJANGO_SECRET_KEY_LINE" | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
#         if [[ -n "$DJANGO_SECRET_KEY" ]]; then
#             # Check if it's a placeholder
#             if is_placeholder "$DJANGO_SECRET_KEY" || [[ "$DJANGO_SECRET_KEY" == "django-insecure-default" ]]; then
#                 echo "⚠️  Found DJANGO_SECRET_KEY in app/.env but it appears to be a placeholder"
#                 DJANGO_SECRET_KEY=""
#             else
#                 echo "✅ Found DJANGO_SECRET_KEY in app/.env"
#             fi
#         fi
#     fi
    
#     TAVILY_API_KEY_LINE=$(grep -E "^TAVILY_API_KEY=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$TAVILY_API_KEY_LINE" ]]; then
#         TAVILY_API_KEY=$(echo "$TAVILY_API_KEY_LINE" | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
#         if [[ -n "$TAVILY_API_KEY" ]]; then
#             # Check if it's a placeholder - but valid keys start with tvly-
#             # so only check for obvious placeholder patterns like tvly-xxx
#             if [[ "$TAVILY_API_KEY" =~ ^tvly-[x]+$ ]] || [[ "$TAVILY_API_KEY" == "tvly-xxx" ]] || is_placeholder "$TAVILY_API_KEY"; then
#                 echo "⚠️  Found TAVILY_API_KEY in app/.env but it appears to be a placeholder"
#                 TAVILY_API_KEY=""
#             else
#                 echo "✅ Found TAVILY_API_KEY in app/.env"
#             fi
#         fi
#     fi
    
#     VITE_APP_TITLE_LINE=$(grep -E "^VITE_APP_TITLE=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$VITE_APP_TITLE_LINE" ]]; then
#         VITE_APP_TITLE=$(echo "$VITE_APP_TITLE_LINE" | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
#         if [[ -n "$VITE_APP_TITLE" ]]; then
#             echo "✅ Found VITE_APP_TITLE in app/.env"
#         fi
#     fi
    
#     VITE_ENABLE_DEPLOYED_LINE=$(grep -E "^VITE_ENABLE_DEPLOYED=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$VITE_ENABLE_DEPLOYED_LINE" ]]; then
#         # Extract everything after the equals sign
#         raw_value=$(echo "$VITE_ENABLE_DEPLOYED_LINE" | cut -d '=' -f2-)
#         # Use our parsing function for proper cleaning
#         VITE_ENABLE_DEPLOYED=$(parse_boolean_env "$raw_value")
        
#         echo "Found VITE_ENABLE_DEPLOYED in .env file: '$raw_value'"
#         echo "Parsed as: '$VITE_ENABLE_DEPLOYED'"
#     fi
    
#     VITE_ENABLE_RAG_ADMIN_LINE=$(grep -E "^VITE_ENABLE_RAG_ADMIN=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$VITE_ENABLE_RAG_ADMIN_LINE" ]]; then
#         # Extract everything after the equals sign
#         raw_value=$(echo "$VITE_ENABLE_RAG_ADMIN_LINE" | cut -d '=' -f2-)
#         # Use our parsing function for proper cleaning
#         VITE_ENABLE_RAG_ADMIN=$(parse_boolean_env "$raw_value")
        
#         echo "Found VITE_ENABLE_RAG_ADMIN in .env file: '$raw_value'"
#         echo "Parsed as: '$VITE_ENABLE_RAG_ADMIN'"
#     fi
    
#     RAG_ADMIN_PASSWORD_LINE=$(grep -E "^RAG_ADMIN_PASSWORD=" "${ENV_FILE_PATH}" 2>/dev/null || echo "")
#     if [[ -n "$RAG_ADMIN_PASSWORD_LINE" ]]; then
#         RAG_ADMIN_PASSWORD=$(echo "$RAG_ADMIN_PASSWORD_LINE" | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
#         if [[ -n "$RAG_ADMIN_PASSWORD" ]]; then
#             # Check if it's a placeholder
#             if is_placeholder "$RAG_ADMIN_PASSWORD" || [[ "$RAG_ADMIN_PASSWORD" == "tt-studio-rag-admin-password" ]]; then
#                 echo "⚠️  Found RAG_ADMIN_PASSWORD in app/.env but it appears to be a placeholder"
#                 RAG_ADMIN_PASSWORD=""
#             else
#                 echo "✅ Found RAG_ADMIN_PASSWORD in app/.env"
#             fi
#         fi
#     fi
# fi

# # Prompt for environment variables if not found
# echo
# echo -e "\e[1;36m=====================================================\e[0m"
# echo -e "\e[1;36m         🔑 Configuration Required                   \e[0m"
# echo -e "\e[1;36m=====================================================\e[0m"
# echo

# # Prompt for JWT_SECRET if not found
# if [[ -z "$JWT_SECRET" ]] && ! is_configured "JWT_SECRET"; then
#     while true; do
#         read -s -p "🔐 Enter JWT_SECRET (for authentication): " JWT_SECRET
#         echo
#         if [[ -n "$JWT_SECRET" ]]; then
#             break
#         else
#             echo "⛔ JWT_SECRET cannot be empty. Please enter a valid JWT secret."
#         fi
#     done
    
#     # Save to app/.env using standardized format
#     write_env_var "JWT_SECRET" "${JWT_SECRET}" "true"
#     echo "✅ JWT_SECRET saved to app/.env"
# fi

# # Prompt for HF_TOKEN if not found
# if [[ -z "$HF_TOKEN" ]] && ! is_configured "HF_TOKEN"; then
#     while true; do
#         read -s -p "🤗 Enter HF_TOKEN (Hugging Face token): " HF_TOKEN
#         echo
#         if [[ -n "$HF_TOKEN" ]]; then
#             break
#         else
#             echo "⛔ HF_TOKEN cannot be empty. Please enter a valid Hugging Face token."
#         fi
#     done
    
#     # Save to app/.env using standardized format
#     write_env_var "HF_TOKEN" "${HF_TOKEN}" "true"
#     echo "✅ HF_TOKEN saved to app/.env"
# fi

# # Prompt for DJANGO_SECRET_KEY if not found
# if [[ -z "$DJANGO_SECRET_KEY" ]] && ! is_configured "DJANGO_SECRET_KEY"; then
#     while true; do
#         read -s -p "🔑 Enter DJANGO_SECRET_KEY (for Django security): " DJANGO_SECRET_KEY
#         echo
#         if [[ -n "$DJANGO_SECRET_KEY" ]]; then
#             break
#         else
#             echo "⛔ DJANGO_SECRET_KEY cannot be empty. Please enter a valid Django secret."
#         fi
#     done
    
#     # Save to app/.env using standardized format
#     write_env_var "DJANGO_SECRET_KEY" "${DJANGO_SECRET_KEY}" "true"
#     echo "✅ DJANGO_SECRET_KEY saved to app/.env"
# fi

# # Prompt for TAVILY_API_KEY if not found
# if [[ -z "$TAVILY_API_KEY" ]] && ! is_configured "TAVILY_API_KEY"; then
#     while true; do
#         read -s -p "🔍 Enter TAVILY_API_KEY (for search functionality): " TAVILY_API_KEY
#         echo
#         if [[ -n "$TAVILY_API_KEY" ]]; then
#             break
#         else
#             echo "⛔ TAVILY_API_KEY cannot be empty. Please enter a valid Tavily API key."
#         fi
#     done
    
#     # Save to app/.env using standardized format
#     write_env_var "TAVILY_API_KEY" "${TAVILY_API_KEY}" "true"
#     echo "✅ TAVILY_API_KEY saved to app/.env"
# fi

# # Prompt for VITE_APP_TITLE if not found
# if [[ -z "$VITE_APP_TITLE" ]] && ! is_configured "VITE_APP_TITLE"; then
#     read -p "📝 Enter application title (default: TT Studio): " input_title
#     if [[ -n "$input_title" ]]; then
#         VITE_APP_TITLE="$input_title"
#     else
#         VITE_APP_TITLE="TT Studio"
#     fi
    
#     # Save to app/.env using standardized format
#     write_env_var "VITE_APP_TITLE" "${VITE_APP_TITLE}" "true"
#     echo "✅ VITE_APP_TITLE saved to app/.env"
# fi

# # Prompt for VITE_ENABLE_DEPLOYED if not found or invalid
# if [[ -z "$VITE_ENABLE_DEPLOYED" || ! "$VITE_ENABLE_DEPLOYED" =~ ^(true|false)$ ]] && ! is_configured "VITE_ENABLE_DEPLOYED"; then
#     echo "📋 Enable deployed mode? (true/false)"
#     echo "   - Enter 'true' to enable AI playground mode and interact with models deployed elsewhere"
#     echo "   - Enter 'false' to deploy your own local models via TT Studio"
#     while true; do
#         read -p "Enter 'true' or 'false' (default: false): " input_deployed
#         if [[ -z "$input_deployed" ]]; then
#             VITE_ENABLE_DEPLOYED="false"
#             break
#         elif [[ "$input_deployed" =~ ^(true|false)$ ]]; then
#             VITE_ENABLE_DEPLOYED="$input_deployed"
#             break
#         else
#             echo "⛔ Invalid input. Please enter 'true' or 'false'."
#         fi
#     done
    
#     # Save to app/.env using standardized format
#     write_env_var "VITE_ENABLE_DEPLOYED" "${VITE_ENABLE_DEPLOYED}" "false"
#     echo "✅ VITE_ENABLE_DEPLOYED saved to app/.env"
# fi

# # Prompt for VITE_ENABLE_RAG_ADMIN if not found or invalid
# if [[ -z "$VITE_ENABLE_RAG_ADMIN" || ! "$VITE_ENABLE_RAG_ADMIN" =~ ^(true|false)$ ]] && ! is_configured "VITE_ENABLE_RAG_ADMIN"; then
#     echo "📋 Enable RAG admin functionality? (true/false)"
#     while true; do
#         read -p "Enter 'true' or 'false' (default: false): " input_rag
#         if [[ -z "$input_rag" ]]; then
#             VITE_ENABLE_RAG_ADMIN="false"
#             break
#         elif [[ "$input_rag" =~ ^(true|false)$ ]]; then
#             VITE_ENABLE_RAG_ADMIN="$input_rag"
#             break
#         else
#             echo "⛔ Invalid input. Please enter 'true' or 'false'."
#         fi
#     done
    
#     # Save to app/.env using standardized format
#     write_env_var "VITE_ENABLE_RAG_ADMIN" "${VITE_ENABLE_RAG_ADMIN}" "false"
#     echo "✅ VITE_ENABLE_RAG_ADMIN saved to app/.env"
# fi

# # Prompt for RAG_ADMIN_PASSWORD if RAG admin is enabled
# if [[ "$VITE_ENABLE_RAG_ADMIN" == "true" ]] && [[ -z "$RAG_ADMIN_PASSWORD" ]] && ! is_configured "RAG_ADMIN_PASSWORD"; then
#     # Debug output
#     echo "RAG admin is enabled, checking for password..."
    
#     # Check if we have a value but it might be empty or a placeholder
#     VALID_PASSWORD=false
#     if [[ -n "$RAG_ADMIN_PASSWORD" ]]; then
#         # Remove quotes but keep the content
#         RAG_ADMIN_PASSWORD=$(echo "$RAG_ADMIN_PASSWORD" | sed -e 's/^"\|^'"'"'//g' -e 's/"\$\|'"'"'$//g')
        
#         # Check if it's a placeholder
#         if [[ "$RAG_ADMIN_PASSWORD" == "tt-studio-rag-admin-password" ]] || [[ "$RAG_ADMIN_PASSWORD" == "test-456" ]] || is_placeholder "$RAG_ADMIN_PASSWORD"; then
#             echo "⚠️  Found RAG_ADMIN_PASSWORD in app/.env but it appears to be a placeholder"
#             RAG_ADMIN_PASSWORD=""
#         elif [[ -n "$RAG_ADMIN_PASSWORD" ]]; then
#             echo "✅ Found valid RAG_ADMIN_PASSWORD in app/.env"
#             VALID_PASSWORD=true
#             # Update in .env file anyway to ensure it's properly formatted (no quotes)
#             if [[ -f "${ENV_FILE_PATH}" ]]; then
#                 if grep -q "^RAG_ADMIN_PASSWORD=" "${ENV_FILE_PATH}"; then
#                     # Update existing RAG_ADMIN_PASSWORD
#                     if [[ "$OS_NAME" == "Darwin" ]]; then
#                         sed -i '' "s|^RAG_ADMIN_PASSWORD=.*|RAG_ADMIN_PASSWORD=${RAG_ADMIN_PASSWORD}|g" "${ENV_FILE_PATH}"
#                     else
#                         sed -i "s|^RAG_ADMIN_PASSWORD=.*|RAG_ADMIN_PASSWORD=${RAG_ADMIN_PASSWORD}|g" "${ENV_FILE_PATH}"
#                     fi
#                 else
#                     echo "RAG_ADMIN_PASSWORD=${RAG_ADMIN_PASSWORD}" >> "${ENV_FILE_PATH}"
#                 fi
#                 # Mark as configured
#                 mark_as_configured "RAG_ADMIN_PASSWORD"
#             fi
#         fi
#     fi
    
#     # Always prompt if RAG admin is enabled and no valid password found
#     if [[ "$VALID_PASSWORD" == "false" ]]; then
#         echo "🔒 RAG admin is enabled. You must set a password."
#         while true; do
#             read -s -p "🔒 Enter RAG_ADMIN_PASSWORD: " RAG_ADMIN_PASSWORD
#             echo
#             if [[ -n "$RAG_ADMIN_PASSWORD" ]]; then
#                 break
#             else
#                 echo "⛔ RAG_ADMIN_PASSWORD cannot be empty when RAG admin is enabled."
#             fi
#         done
        
#         # Save to app/.env using standardized format
#         write_env_var "RAG_ADMIN_PASSWORD" "${RAG_ADMIN_PASSWORD}" "true"
#         echo "✅ RAG_ADMIN_PASSWORD saved to app/.env"
#     fi
# fi

# # Export the environment variables
# export JWT_SECRET
# export HF_TOKEN
# export DJANGO_SECRET_KEY
# export TAVILY_API_KEY
# export VITE_APP_TITLE
# export VITE_ENABLE_DEPLOYED
# export VITE_ENABLE_RAG_ADMIN
# export RAG_ADMIN_PASSWORD

# echo "✅ Environment variables configured successfully"

# # Step 2: Source env vars, ensure directories
# source "${ENV_FILE_PATH}"
# # make persistent volume on host user user permissions
# if [ ! -d "$HOST_PERSISTENT_STORAGE_VOLUME" ]; then
#     echo -e "${C_BLUE}Creating persistent storage directory...${C_RESET}"
#     mkdir "$HOST_PERSISTENT_STORAGE_VOLUME"
#     if [ $? -ne 0 ]; then
#         echo -e "${C_RED}⛔ Error: Failed to create directory $HOST_PERSISTENT_STORAGE_VOLUME${C_RESET}"
#         exit 1
#     fi
# fi

# # Step 3: Check if the Docker network already exists
# NETWORK_NAME="tt_studio_network"
# if docker network ls | grep -qw "${NETWORK_NAME}"; then
#     echo -e "${C_BLUE}Network '${NETWORK_NAME}' exists.${C_RESET}"
# else
#     echo -e "${C_BLUE}Creating network '${NETWORK_NAME}'...${C_RESET}"
#     docker network create --driver bridge "${NETWORK_NAME}"
#     if [ $? -eq 0 ]; then
#         echo -e "${C_GREEN}Network created successfully.${C_RESET}"
#     else
#         echo -e "${C_RED}Failed to create network.${C_RESET}"
#         exit 1
#     fi
# fi

# # Display Docker version information
# echo -e "${C_BLUE}Docker version:${C_RESET}"
# docker --version
# echo -e "${C_BLUE}Docker Compose version:${C_RESET}"
# docker compose version

# # Step 4: Run Docker Compose with appropriate configuration
# COMPOSE_FILES="-f ${TT_STUDIO_ROOT}/app/docker-compose.yml"

# # Detect TT hardware automatically
# echo -e "${C_BLUE}🔍 Checking for Tenstorrent hardware...${C_RESET}"
# if [ -e "/dev/tenstorrent" ] || [ -d "/dev/tenstorrent" ]; then
#     echo -e "${C_GREEN}✅ Tenstorrent hardware detected - enabling hardware support automatically${C_RESET}"
#     RUN_TT_HARDWARE=true
# else
#     echo -e "${C_YELLOW}⚠️ No Tenstorrent hardware detected${C_RESET}"
#     # Still respect manual flag if set
#     if [[ "$RUN_TT_HARDWARE" = true ]]; then
#         echo -e "${C_BLUE}🔧 Hardware support enabled manually via --tt-hardware flag${C_RESET}"
#     fi
# fi

# if [[ "$RUN_DEV_MODE" = true ]]; then
#     echo -e "${C_MAGENTA}🚀 Running Docker Compose in development mode...${C_RESET}"
#     COMPOSE_FILES="${COMPOSE_FILES} -f ${TT_STUDIO_ROOT}/app/docker-compose.dev-mode.yml"
# else
#     echo -e "${C_MAGENTA}🚀 Running Docker Compose in production mode...${C_RESET}"
# fi

# if [[ "$RUN_TT_HARDWARE" = true ]]; then
#     echo -e "${C_MAGENTA}🚀 Running Docker Compose with TT hardware support...${C_RESET}"
#     COMPOSE_FILES="${COMPOSE_FILES} -f ${DOCKER_COMPOSE_TT_HARDWARE_FILE}"
# else
#     echo -e "${C_MAGENTA}🚀 Running Docker Compose without TT hardware support...${C_RESET}"
# fi

# echo -e "${C_BOLD}${C_BLUE}🚀 Starting services with selected configuration...${C_RESET}"
# docker compose ${COMPOSE_FILES} up --build -d

# # Step 6: Setup TT Inference Server FastAPI
# echo
# echo -e "\e[1;36m=====================================================\e[0m"
# echo -e "\e[1;36m         🔧 Setting up TT Inference Server          \e[0m"
# echo -e "\e[1;36m=====================================================\e[0m"

# INFERENCE_SERVER_DIR="${TT_STUDIO_ROOT}/tt-inference-server"

# # Prompt for sudo password upfront so it's cached for background process
# echo "🔐 TT Inference Server setup requires sudo privileges. Please enter your password:"
# sudo -v
# if [ $? -ne 0 ]; then
#     echo "⛔ Error: Failed to authenticate with sudo"
#     exit 1
# fi
# echo "✅ Sudo authentication successful."

# # Clone the repository if it doesn't exist
# if [ ! -d "$INFERENCE_SERVER_DIR" ]; then
#     echo "📥 Cloning TT Inference Server repository..."
#     git clone -b atupe/studio-fastapi-main https://github.com/tenstorrent/tt-inference-server.git "$INFERENCE_SERVER_DIR"
#     if [ $? -ne 0 ]; then
#         echo "⛔ Error: Failed to clone tt-inference-server repository"
#         exit 1
#     fi
# else
#     echo "📁 TT Inference Server directory already exists, pulling latest changes..."
#     cd "$INFERENCE_SERVER_DIR"
#     git fetch origin atupe/studio-fastapi-main
#     git checkout atupe/studio-fastapi-main
#     git pull origin atupe/studio-fastapi-main
#     if [ $? -ne 0 ]; then
#         echo "⛔ Error: Failed to update tt-inference-server repository"
#         exit 1
#     fi
# fi

# # Change to the inference server directory
# cd "$INFERENCE_SERVER_DIR"

# # Check if port 8001 is already in use
# echo "🔍 Checking if port 8001 is already in use..."
# if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost 8001 >/dev/null 2>&1; then
#     echo "⚠️  Port 8001 is already in use. Attempting to free the port..."
    
#     # Try to find the PID using the port with different methods
#     PORT_PID=$(lsof -Pi :8001 -sTCP:LISTEN -t 2>/dev/null || echo "")
#     if [[ -z "$PORT_PID" ]]; then
#         PORT_PID=$(netstat -anp 2>/dev/null | grep "8001" | grep "LISTEN" | awk '{print $7}' | cut -d/ -f1 2>/dev/null || echo "")
#     fi
    
#     if [[ -n "$PORT_PID" ]]; then
#         echo "🛑 Found process using port 8001 (PID: $PORT_PID). Stopping it..."
#         sudo kill -15 $PORT_PID 2>/dev/null || true
#         sleep 2
        
#         # Check if process is still running
#         if kill -0 $PORT_PID 2>/dev/null; then
#             echo "⚠️  Process still running. Attempting force kill..."
#             sudo kill -9 $PORT_PID 2>/dev/null || true
#             sleep 1
#         fi
#     else
#         echo "⚠️  Could not find specific process. Attempting to kill any process on port 8001..."
#         # On macOS, use a different approach
#         if [[ "$OS_NAME" == "Darwin" ]]; then
#             sudo lsof -i :8001 -sTCP:LISTEN -t | xargs sudo kill -9 2>/dev/null || true
#         else
#             sudo fuser -k 8001/tcp 2>/dev/null || true
#         fi
#         sleep 1
#     fi
    
#     # Final check
#     if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost 8001 >/dev/null 2>&1; then
#         echo "❌ Failed to free port 8001. Please manually stop any process using this port."
#         echo "   Try: sudo lsof -i :8001 (to identify the process)"
#         echo "   Then: sudo kill -9 <PID> (to forcibly terminate it)"
#         exit 1
#     else
#         echo "✅ Port 8001 is now available"
#     fi
# else
#     echo "✅ Port 8001 is available"
# fi

# # Create virtual environment if it doesn't exist
# if [ ! -d ".venv" ]; then
#     echo "🐍 Creating Python virtual environment..."
#     python3 -m venv .venv
#     if [ $? -ne 0 ]; then
#         echo "⛔ Error: Failed to create virtual environment"
#         exit 1
#     fi
# else
#     echo "🐍 Virtual environment already exists"
# fi

# # Install requirements
# echo "📦 Installing Python requirements..."
# .venv/bin/pip install -r requirements-api.txt
# if [ $? -ne 0 ]; then
#     echo "⛔ Error: Failed to install requirements"
#     exit 1
# fi

# # Create directories and files that might need sudo access
# FASTAPI_PID_FILE="${TT_STUDIO_ROOT}/fastapi.pid"
# FASTAPI_LOG_FILE="${TT_STUDIO_ROOT}/fastapi.log"

# # Make sure log and PID files are accessible
# echo "🔧 Setting up log and PID files..."
# sudo touch "$FASTAPI_PID_FILE" "$FASTAPI_LOG_FILE"
# sudo chown $(whoami) "$FASTAPI_PID_FILE" "$FASTAPI_LOG_FILE"
# sudo chmod 644 "$FASTAPI_PID_FILE" "$FASTAPI_LOG_FILE"

# # Start FastAPI server in background with logging
# echo "🚀 Starting FastAPI server on port 8001..."

# # Use a wrapper script with error handling
# TEMP_SCRIPT=$(mktemp)
# cat > "$TEMP_SCRIPT" << 'EOF'
# #!/bin/bash
# set -e
# cd "$1"
# # Save PID to file first to avoid permission issues
# echo $$ > "$2"
# # Try to start the server with specific error handling
# if ! "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8001 > "$4" 2>&1; then
#     echo "Failed to start FastAPI server. Check logs at $4"
#     exit 1
# fi
# EOF
# chmod +x "$TEMP_SCRIPT"

# # Execute the script in the background with environment variables
# sudo JWT_SECRET="$JWT_SECRET" HF_TOKEN="$HF_TOKEN" "$TEMP_SCRIPT" "$INFERENCE_SERVER_DIR" "$FASTAPI_PID_FILE" ".venv" "$FASTAPI_LOG_FILE" &
# PID=$!

# # Wait for PID file to be created and read the actual PID
# echo "⏳ Waiting for FastAPI server to start..."
# HEALTH_CHECK_RETRIES=30
# HEALTH_CHECK_DELAY=2

# # More robust health check
# for ((i=1; i<=HEALTH_CHECK_RETRIES; i++)); do
#     # First check if process is running
#     if ! ps -p $PID > /dev/null; then
#         echo "⛔ Error: FastAPI server process died"
#         echo "📜 Last few lines of FastAPI log:"
#         tail -n 15 "$FASTAPI_LOG_FILE" 2>/dev/null || echo "No log file found"
        
#         # Check for common errors in the log
#         if grep -q "address already in use" "$FASTAPI_LOG_FILE"; then
#             echo "❌ Error: Port 8001 is still in use by another process."
#             echo "   Please manually stop any process using port 8001:"
#             echo "   1. Run: sudo lsof -i :8001"
#             echo "   2. Run: sudo kill -9 <PID>"
#         fi
#         exit 1
#     fi
    
#     # Check if server is responding to HTTP requests
#     if curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/ 2>/dev/null | grep -q "200\|404"; then
#         echo "✅ FastAPI server started successfully (PID: $PID)"
#         echo "🌐 FastAPI server accessible at: http://localhost:8001"
#         echo "🔐 FastAPI server: ${C_CYAN}http://localhost:8001${C_RESET} (check: curl http://localhost:8001/)"
#         break
#     elif [ $i -eq $HEALTH_CHECK_RETRIES ]; then
#         echo "⛔ Error: FastAPI server failed health check after ${HEALTH_CHECK_RETRIES} attempts"
#         echo "📜 Last few lines of FastAPI log:"
#         tail -n 10 "$FASTAPI_LOG_FILE" 2>/dev/null || echo "No log file found"
#         echo "💡 Try running: curl -v http://localhost:8001/ to debug connection issues"
#         exit 1
#     fi
    
#     echo "⏳ Health check attempt $i/$HEALTH_CHECK_RETRIES - waiting ${HEALTH_CHECK_DELAY}s..."
#     sleep $HEALTH_CHECK_DELAY
# done

# # Return to original directory
# cd "$TT_STUDIO_ROOT"

# # Final summary display
# echo
# echo -e "${C_GREEN}✔ Setup Complete!${C_RESET}"
# echo
# echo -e "${C_WHITE}${C_BOLD}┌────────────────────────────────────────────────────────────┐${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│                                                            │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│   🚀 Tenstorrent TT Studio is ready!                     │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│                                                            │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│   Access it at: ${C_CYAN}http://localhost:3000${C_RESET}${C_WHITE}${C_BOLD}                    │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│   FastAPI server: ${C_CYAN}http://localhost:8001${C_RESET}${C_WHITE}${C_BOLD}                  │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Health check: curl http://localhost:8001/)${C_RESET}${C_WHITE}${C_BOLD}           │${C_RESET}"
# if [[ "$OS_NAME" == "Darwin" ]]; then
#     echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Cmd+Click the link to open in browser)${C_RESET}${C_WHITE}${C_BOLD}                │${C_RESET}"
# else
#     echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}(Ctrl+Click the link to open in browser)${C_RESET}${C_WHITE}${C_BOLD}               │${C_RESET}"
# fi
# echo -e "${C_WHITE}${C_BOLD}│                                                            │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}└────────────────────────────────────────────────────────────┘${C_RESET}"
# echo

# # Display info about special modes if they are enabled
# if [[ "$RUN_DEV_MODE" = true || "$RUN_TT_HARDWARE" = true ]]; then
#     echo -e "${C_WHITE}${C_BOLD}┌────────────────────────────────────────────────────────────┐${C_RESET}"
#     echo -e "${C_WHITE}${C_BOLD}│                    ${C_YELLOW}Active Modes${C_WHITE}${C_BOLD}                            │${C_RESET}"
#     if [[ "$RUN_DEV_MODE" = true ]]; then
#         echo -e "${C_WHITE}${C_BOLD}│   ${C_CYAN}💻 Development Mode: ENABLED${C_WHITE}${C_BOLD}                           │${C_RESET}"
#     fi
#     if [[ "$RUN_TT_HARDWARE" = true ]]; then
#         echo -e "${C_WHITE}${C_BOLD}│   ${C_CYAN}🔧 Tenstorrent Device: MOUNTED${C_WHITE}${C_BOLD}                         │${C_RESET}"
#     fi
#     echo -e "${C_WHITE}${C_BOLD}└────────────────────────────────────────────────────────────┘${C_RESET}"
#     echo
# fi

# echo -e "${C_WHITE}${C_BOLD}┌────────────────────────────────────────────────────────────┐${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│   ${C_YELLOW}🧹 To stop all services, run:${C_RESET}${C_WHITE}${C_BOLD}                           │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}│   ${C_MAGENTA}./startup.sh --cleanup${C_RESET}${C_WHITE}${C_BOLD}                                  │${C_RESET}"
# echo -e "${C_WHITE}${C_BOLD}└────────────────────────────────────────────────────────────┘${C_RESET}"
# echo

# # Try to open the browser automatically
# if [[ "$OS_NAME" == "Darwin" ]]; then
#     open "http://localhost:3000" 2>/dev/null || echo -e "${C_YELLOW}⚠️  Please open http://localhost:3000 in your browser manually${C_RESET}"
# elif command -v xdg-open &> /dev/null; then
#     xdg-open "http://localhost:3000" 2>/dev/null || echo -e "${C_YELLOW}⚠️  Please open http://localhost:3000 in your browser manually${C_RESET}"
# else
#     echo -e "${C_YELLOW}⚠️  Please open http://localhost:3000 in your browser manually${C_RESET}"
# fi

# # If in dev mode, show logs
# if [[ "$RUN_DEV_MODE" = true ]]; then
#     echo -e "${C_YELLOW}📜 Tailing logs in development mode. Press Ctrl+C to stop.${C_RESET}"
#     echo
#     cd "${TT_STUDIO_ROOT}/app" && docker compose logs -f &
#     tail -f "$FASTAPI_LOG_FILE" &
#     wait
# fi

