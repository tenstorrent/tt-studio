# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
TT Studio Setup Script

This script sets up the TT Studio environment including:
- Environment configuration
- Frontend dependencies installation (node_modules)
- Docker services setup
- TT Inference Server FastAPI setup (clones tt-inference-server repo and starts FastAPI on port 8001)

Usage:
    python run.py [options]

Options:
    --dev              Development mode with suggested defaults
    --cleanup          Clean up Docker containers and networks
    --cleanup-all      Clean up everything including persistent data
    --skip-fastapi     Skip TT Inference Server FastAPI setup
    --no-sudo          Skip sudo usage for FastAPI setup
    --check-headers       Check for missing SPDX license headers
    --add-headers         Add missing SPDX license headers (excludes frontend)
    --help-env         Show environment variables help
"""

import os
import sys
import subprocess
import time
import platform
import argparse
import shutil
import re
import getpass
import webbrowser
import socket
import tempfile
import signal
import json
from pathlib import Path
from datetime import datetime
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False

# --- Color Definitions ---
C_RESET = '\033[0m'
C_RED = '\033[0;31m'
C_GREEN = '\033[0;32m'
C_YELLOW = '\033[0;33m'
C_BLUE = '\033[0;34m'
C_MAGENTA = '\033[0;35m'
C_CYAN = '\033[0;36m'
C_WHITE = '\033[0;37m'
C_BOLD = '\033[1m'
C_ORANGE = '\033[38;5;208m'
C_TT_PURPLE = '\033[38;5;99m'

# --- Global Paths and Constants ---
TT_STUDIO_ROOT = os.getcwd()
# INFERENCE_SERVER_BRANCH = "anirud/v0.0.5-fast-api-for-tt-studio"
# switch to this tmp branch for running models on qb-ge
INFERENCE_SERVER_BRANCH = "anirud/feat-qb-ge-tt-studio-link"
OS_NAME = platform.system()

# --- ASCII Art Constants ---
# Credit: figlet font slant by Glenn Chappell
TENSTORRENT_ASCII_ART = r"""   __                  __                             __
  / /____  ____  _____/ /_____  _____________  ____  / /_
 / __/ _ \/ __ \/ ___/ __/ __ \/ ___/ ___/ _ \/ __ \/ __/
/ /_/  __/ / / (__  ) /_/ /_/ / /  / /  /  __/ / / / /_
\__/\___/_/ /_/____/\__/\____/_/  /_/   \___/_/ /_/\__/"""

# --- File Paths ---
DOCKER_COMPOSE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.yml")
DOCKER_COMPOSE_DEV_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.dev-mode.yml")
DOCKER_COMPOSE_PROD_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.prod.yml")
DOCKER_COMPOSE_TT_HARDWARE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.tt-hardware.yml")
ENV_FILE_PATH = os.path.join(TT_STUDIO_ROOT, "app", ".env")
ENV_FILE_DEFAULT = os.path.join(TT_STUDIO_ROOT, "app", ".env.default")
INFERENCE_SERVER_DIR = os.path.join(TT_STUDIO_ROOT, "tt-inference-server")
FASTAPI_PID_FILE = os.path.join(TT_STUDIO_ROOT, "fastapi.pid")
FASTAPI_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "fastapi.log")
DOCKER_CONTROL_SERVICE_DIR = os.path.join(TT_STUDIO_ROOT, "docker-control-service")
DOCKER_CONTROL_PID_FILE = os.path.join(TT_STUDIO_ROOT, "docker-control-service.pid")
DOCKER_CONTROL_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "docker-control-service.log")
PREFS_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_preferences.json")
EASY_CONFIG_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_easy_config.json")

# Global flag to determine if we should overwrite existing values
FORCE_OVERWRITE = False

def run_command(command, check=False, cwd=None, capture_output=False, shell=False):
    """Helper function to run a shell command."""
    try:
        cmd_str = command if shell else ' '.join(command)
        return subprocess.run(command, check=check, cwd=cwd, text=True, capture_output=capture_output, shell=shell)
    except FileNotFoundError as e:
        print(f"{C_RED}⛔ Error: Command not found: {e.filename}{C_RESET}")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        # Don't exit if check=False, just return the result
        if check:
            print(f"{C_RED}⛔ Error executing command: {cmd_str}{C_RESET}")
            if capture_output:
                print(f"{C_RED}Stderr: {e.stderr}{C_RESET}")
            sys.exit(1)
        return e


def check_docker_installation():
    """Function to check Docker installation and daemon connectivity."""
    if not shutil.which("docker"):
        print(f"{C_RED}⛔ Error: Docker is not installed.{C_RESET}")
        print(f"{C_YELLOW}Please install Docker from: https://docs.docker.com/get-docker/{C_RESET}")
        sys.exit(1)

    # Test Docker daemon connectivity - first try without sudo
    result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)

    if result.returncode != 0:
        error_output = result.stderr.lower()

        if "permission denied" in error_output:
            # Permission issue - try with sudo
            print(f"\n{C_YELLOW}🔒 Docker Permission Issue Detected{C_RESET}")
            print(f"{C_YELLOW}Docker socket has secure 660 permissions - sudo access will be used{C_RESET}")
            print(f"{C_CYAN}Verifying Docker daemon is running with sudo...{C_RESET}")

            # Try with sudo to verify Docker daemon is actually running
            sudo_result = subprocess.run(["sudo", "docker", "info"], capture_output=True, text=True, check=False)

            if sudo_result.returncode == 0:
                print(f"{C_GREEN}✅ Docker daemon is running (sudo access confirmed){C_RESET}")
                print(f"{C_CYAN}TT Studio will use sudo for Docker commands when needed{C_RESET}\n")
                # Docker is working with sudo - continue
                return
            else:
                # Even with sudo it's not working
                sudo_error = sudo_result.stderr.lower()
                if "cannot connect" in sudo_error or "connection refused" in sudo_error:
                    print(f"\n{C_RED}⛔ Error: Docker daemon is not running{C_RESET}")
                    print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
                    print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                    print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
                    print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
                    print()
                    print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
                    print(f"   {C_CYAN}sudo service docker start{C_RESET}")
                    print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
                    print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                else:
                    print(f"{C_RED}⛔ Error: Docker daemon error{C_RESET}")
                    print(f"{C_YELLOW}Error: {sudo_result.stderr}{C_RESET}")
                sys.exit(1)

        elif "cannot connect" in error_output or "connection refused" in error_output:
            print(f"\n{C_RED}⛔ Error: Cannot connect to Docker daemon.{C_RESET}")
            print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
            print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
            print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
            print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
            print()
            print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
            print(f"   {C_CYAN}sudo service docker start{C_RESET}")
            print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
            print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
            sys.exit(1)
        else:
            print(f"{C_RED}⛔ Error: Cannot connect to Docker daemon.{C_RESET}")
            print(f"{C_YELLOW}Docker daemon error: {result.stderr}{C_RESET}")
            print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")
            sys.exit(1)
    else:
        # Docker accessible without sudo
        print(f"{C_GREEN}✅ Docker daemon is accessible{C_RESET}")

    # Check if docker compose is available
    compose_result = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True, check=False)

    if compose_result.returncode != 0:
        # Try with sudo if permission denied
        if "permission denied" in compose_result.stderr.lower():
            compose_result = subprocess.run(["sudo", "docker", "compose", "version"], capture_output=True, text=True, check=False)

        if compose_result.returncode != 0:
            print(f"{C_RED}⛔ Error: Docker Compose is not installed or not working correctly.{C_RESET}")
            print(f"{C_YELLOW}Please install Docker Compose from: https://docs.docker.com/compose/install/{C_RESET}")
            sys.exit(1)

def check_docker_access():
    """
    Check if current user has access to Docker socket.
    Returns True if user can access Docker, False otherwise.
    """
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
        return result.returncode == 0
    except Exception:
        return False

def run_docker_command(command, use_sudo=False, capture_output=False, check=False):
    """
    Run a Docker command with automatic sudo fallback if permission denied.

    Args:
        command (list): Docker command to run
        use_sudo (bool): Force use of sudo
        capture_output (bool): Capture command output (only for non-sudo or successful commands)
        check (bool): Raise exception on non-zero exit code

    Returns:
        subprocess.CompletedProcess: Result of command execution
    """
    # First try without sudo if not forced
    if not use_sudo:
        result = subprocess.run(command, capture_output=True, text=True, check=False)

        # If permission denied, try with sudo
        if result.returncode != 0 and "permission denied" in result.stderr.lower():
            print(f"{C_YELLOW}⚠️  Permission denied, retrying with sudo (you may be prompted for password)...{C_RESET}")
            sudo_command = ["sudo"] + command
            # Don't capture output when using sudo interactively - allow password prompt to show
            # But capture stderr to check for errors after authentication
            result = subprocess.run(sudo_command, capture_output=False, text=True, check=check)
            return result

        # If check=True and command failed, raise exception
        if check and result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, command, result.stdout, result.stderr)

        return result
    else:
        # Use sudo directly - don't capture output to allow interactive password prompt
        sudo_command = ["sudo"] + command
        return subprocess.run(sudo_command, capture_output=False, text=True, check=check)

def ensure_docker_group_membership():
    """
    Check if user is in Docker group and provide guidance if not.
    Returns True if user has access, False otherwise.
    """
    if check_docker_access():
        return True

    # Check socket permissions
    try:
        socket_stat = os.stat("/var/run/docker.sock")
        import grp
        socket_group = grp.getgrgid(socket_stat.st_gid).gr_name

        print(f"\n{C_YELLOW}🔒 Docker Socket Access Issue{C_RESET}")
        print(f"{C_YELLOW}{'─' * 60}{C_RESET}")
        print(f"{C_CYAN}The Docker socket requires group membership: {socket_group}{C_RESET}")
        print(f"\n{C_GREEN}To fix this, run:{C_RESET}")
        print(f"   {C_CYAN}sudo usermod -aG {socket_group} $USER{C_RESET}")
        print(f"   {C_CYAN}newgrp {socket_group}{C_RESET}")
        print(f"\n{C_YELLOW}Or continue with sudo access (commands will prompt for password){C_RESET}")
        print(f"{C_YELLOW}{'─' * 60}{C_RESET}\n")

        return False
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Could not check Docker socket permissions: {e}{C_RESET}")
        return False

def is_placeholder(value):
    """Check for common placeholder or empty values."""
    if not value or str(value).strip() == "":
        return True

    placeholder_patterns = [
        'django-insecure-default', 'tvly-xxx', 'hf_***',
        'tt-studio-rag-admin-password', 'cloud llama chat ui url',
        'cloud llama chat ui auth token', 'test-456',
        '<PATH_TO_ROOT_OF_REPO>', 'true or false to enable deployed mode',
        'true or false to enable RAG admin'
    ]

    value_str = str(value).strip().strip('"\'')
    return value_str in placeholder_patterns

def write_env_var(var_name, var_value, quote_value=True):
    """
    Update or add an environment variable to the app/.env file.
    """
    if not os.path.exists(ENV_FILE_PATH):
        open(ENV_FILE_PATH, 'w').close()

    with open(ENV_FILE_PATH, 'r') as f:
        lines = f.readlines()

    var_found = False
    
    if quote_value and var_value and str(var_value).strip():
        # Escape quotes in the value
        escaped_value = str(var_value).replace('"', '\\"')
        formatted_value = f'"{escaped_value}"'
    else:
        formatted_value = str(var_value) if var_value else ""
    
    new_line = f"{var_name}={formatted_value}\n"
    
    for i, line in enumerate(lines):
        if re.match(f"^{re.escape(var_name)}=", line):
            lines[i] = new_line
            var_found = True
            break
            
    if not var_found:
        lines.append(new_line)

    with open(ENV_FILE_PATH, 'w') as f:
        f.writelines(lines)

def get_env_var(var_name, default=""):
    """Safely get a variable from the .env file."""
    if not os.path.exists(ENV_FILE_PATH):
        return default
    with open(ENV_FILE_PATH, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith(f"{var_name}="):
                value = line.split('=', 1)[1]
                return value.strip('"\'')
    return default

def parse_boolean_env(raw_value):
    """Parse boolean values from .env file"""
    return str(raw_value).lower().strip().strip('"\'') in ['true', '1', 't', 'y', 'yes']

def get_existing_env_vars():
    """Read all existing environment variables from .env file"""
    env_vars = {}
    if os.path.exists(ENV_FILE_PATH):
        with open(ENV_FILE_PATH, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key] = value.strip('"\'')
    return env_vars

def save_easy_config(config_dict):
    """Save easy mode configuration to JSON file"""
    try:
        with open(EASY_CONFIG_FILE_PATH, 'w') as f:
            json.dump(config_dict, f, indent=2)
        print(f"{C_GREEN}✅ Easy mode configuration saved to {EASY_CONFIG_FILE_PATH}{C_RESET}")
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Warning: Could not save easy mode configuration: {e}{C_RESET}")

def load_easy_config():
    """Load easy mode configuration from JSON file"""
    if os.path.exists(EASY_CONFIG_FILE_PATH):
        try:
            with open(EASY_CONFIG_FILE_PATH, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not load easy mode configuration: {e}{C_RESET}")
            return None
    return None

def should_configure_var(var_name, current_value):
    """
    Determine if we should configure a variable based on whether it's a placeholder
    and the global FORCE_OVERWRITE flag.
    """
    global FORCE_OVERWRITE
    
    # If we're forcing overwrite, always configure
    if FORCE_OVERWRITE:
        return True
    
    # If it's a placeholder, we should configure it (placeholders should always be replaced)
    if is_placeholder(current_value):
        return True
    
    # Otherwise, skip configuration (keep existing non-placeholder value)
    return False

def load_preferences():
    """Load user preferences from JSON file."""
    if os.path.exists(PREFS_FILE_PATH):
        try:
            with open(PREFS_FILE_PATH, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}

def save_preferences(prefs):
    """Save user preferences to JSON file."""
    try:
        with open(PREFS_FILE_PATH, 'w') as f:
            json.dump(prefs, f, indent=2)
    except IOError as e:
        print(f"{C_YELLOW}Warning: Could not save preferences: {e}{C_RESET}")

def save_preference(key, value):
    """Save a single preference key-value pair."""
    prefs = load_preferences()
    prefs[key] = value
    save_preferences(prefs)

def get_preference(key, default=None):
    """Get a preference value by key, returning default if not found."""
    prefs = load_preferences()
    return prefs.get(key, default)

def clear_preferences():
    """Clear all user preferences by deleting the preferences file."""
    if os.path.exists(PREFS_FILE_PATH):
        try:
            os.remove(PREFS_FILE_PATH)
            return True
        except IOError:
            return False
    return True

def is_first_time_setup():
    """Check if this is the first time setup by checking if preferences exist."""
    return not os.path.exists(PREFS_FILE_PATH)

def display_first_time_welcome():
    """Display welcome message for first-time setup."""
    print(f"\n{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}           📝 First-Time Setup{C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print()
    print(f"{C_CYAN}Welcome to TT Studio! We'll guide you through the initial setup.{C_RESET}")
    print()
    print(f"{C_GREEN}ℹ️  What to expect:{C_RESET}")
    print(f"  • Your responses will be saved for future runs")
    print(f"  • Subsequent runs will be much faster and non-interactive")
    print(f"  • You can reset your preferences anytime with {C_WHITE}--reconfigure{C_RESET}")
    print()
    print(f"{C_YELLOW}Note: You won't be asked these questions again unless you explicitly reset.{C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print()

def ask_overwrite_preference(existing_vars, force_prompt=False):
    """
    Ask user if they want to overwrite existing environment variables.
    Returns True if user wants to overwrite, False otherwise.
    
    Args:
        existing_vars: Dictionary of existing environment variables
        force_prompt: If True, always prompt user even if preference exists
    """
    # Check for saved preference (unless forcing prompt)
    if not force_prompt:
        config_mode = get_preference("configuration_mode")
        if config_mode:
            if config_mode == "keep_existing":
                return False
            elif config_mode == "reconfigure_everything":
                return True
    
    # Filter out placeholder values to show only real configured values
    real_vars = {k: v for k, v in existing_vars.items() if not is_placeholder(v)}
    
    # Debug: Show what variables are being filtered
    placeholder_vars = {k: v for k, v in existing_vars.items() if is_placeholder(v)}
    if placeholder_vars:
        print(f"{C_YELLOW}📋 Found placeholder values that will be configured: {list(placeholder_vars.keys())}{C_RESET}")
    
    if not real_vars:
        print(f"{C_YELLOW}All existing variables appear to be placeholders. Will configure all values.{C_RESET}")
        return True
    
    print(f"\n{C_CYAN}{C_BOLD}🔍 Configuration Status Check{C_RESET}")
    print(f"{C_GREEN}✅ Found an existing TT Studio configuration with {len(real_vars)} configured variables:{C_RESET}")
    print()
    
    # Group variables by category for better display
    core_vars = ["TT_STUDIO_ROOT", "HOST_PERSISTENT_STORAGE_VOLUME", "INTERNAL_PERSISTENT_STORAGE_VOLUME", "BACKEND_API_HOSTNAME"]
    security_vars = ["JWT_SECRET", "DJANGO_SECRET_KEY", "HF_TOKEN", "TAVILY_API_KEY", "RAG_ADMIN_PASSWORD"]
    app_vars = ["VITE_APP_TITLE", "VITE_ENABLE_DEPLOYED", "VITE_ENABLE_RAG_ADMIN"]
    cloud_vars = [k for k in real_vars.keys() if k.startswith("CLOUD_")]
    
    def display_vars(category_name, var_list, emoji):
        category_vars = {k: v for k, v in real_vars.items() if k in var_list}
        if category_vars:
            print(f"{C_BOLD}{emoji} {category_name}:{C_RESET}")
            for var_name, var_value in category_vars.items():
                # Mask sensitive values only if they're not placeholders
                if any(sensitive in var_name.lower() for sensitive in ['secret', 'token', 'password', 'key']):
                    # Don't mask placeholder values - show them so users know they're placeholders
                    if is_placeholder(var_value):
                        display_value = f"[PLACEHOLDER: {var_value}]"
                    else:
                        display_value = "***configured***"
                else:
                    display_value = var_value[:50] + "..." if len(var_value) > 50 else var_value
                print(f"    • {var_name}: {C_CYAN}{display_value}{C_RESET}")
            print()
    
    display_vars("Core Configuration", core_vars, "📁")
    display_vars("Security Credentials", security_vars, "🔐")
    display_vars("Application Settings", app_vars, "⚙️")
    display_vars("Cloud Model APIs", cloud_vars, "☁️")
    
    # Add visual separator
    print("=" * 80)
    
    print(f"{C_YELLOW}{C_BOLD}What would you like to do?{C_RESET}")
    print()
    print(f"  {C_GREEN}{C_BOLD}1 - Keep Existing Configuration (Recommended){C_RESET}")
    print(f"    • Keep all current values as they are")
    print(f"    • Only configure any missing or placeholder values")
    print(f"    • Recommended for normal startup")
    print()
    print(f"  {C_ORANGE}{C_BOLD}2 - Reconfigure Everything{C_RESET}")
    print(f"    • Go through setup prompts for ALL variables")
    print(f"    • Replace existing values with new ones")
    print(f"    • Use this if you want to change your configuration")
    print()
    
    # Add another visual separator before input
    print("=" * 80)
    
    while True:
        print(f"{C_WHITE}{C_BOLD}Choose an option:{C_RESET}")
        print(f"  {C_GREEN}1{C_RESET} - Keep existing configuration (recommended)")
        print(f"  {C_ORANGE}2{C_RESET} - Reconfigure everything")
        print()
        try:
            choice = input(f"Enter your choice (1/2): ").strip()
        except KeyboardInterrupt:
            print(f"\n\n{C_YELLOW}🛑 Setup interrupted by user (Ctrl+C){C_RESET}")
            
            # Build the original command with flags for resume suggestion
            original_cmd = "python run.py"
            if 'args' in locals():
                if args.dev:
                    original_cmd += " --dev"
                if args.skip_fastapi:
                    original_cmd += " --skip-fastapi"
                if args.no_sudo:
                    original_cmd += " --no-sudo"
            
            print(f"{C_CYAN}🔄 To resume setup later, run: {C_WHITE}{original_cmd}{C_RESET}")
            print(f"{C_CYAN}🧹 To clean up any partial setup: {C_WHITE}python run.py --cleanup{C_RESET}")
            print(f"{C_CYAN}❓ For help: {C_WHITE}python run.py --help or alternatively: python3 run.py --help{C_RESET}")
            sys.exit(0)
        
        if choice == "1":
            print(f"\n{C_GREEN}✅ Keeping existing configuration. Only missing values will be configured.{C_RESET}")
            # Show which placeholder values will still need to be configured
            placeholder_vars = {k: v for k, v in existing_vars.items() if is_placeholder(v)}
            if placeholder_vars:
                print(f"{C_CYAN}📝 Note: Placeholder values will still be prompted for configuration:{C_RESET}")
                for var_name in placeholder_vars.keys():
                    print(f"    • {var_name}")
                print()
            save_preference("configuration_mode", "keep_existing")
            return False
        elif choice == "2":
            print(f"\n{C_ORANGE}🔄 Will reconfigure all environment variables.{C_RESET}")
            save_preference("configuration_mode", "reconfigure_everything")
            return True
        else:
            print(f"{C_RED}❌ Please enter 1 to keep existing config or 2 to reconfigure everything.{C_RESET}")
            print()

def configure_environment_sequentially(dev_mode=False, force_reconfigure=False, easy_mode=False):
    """
    Handles all environment configuration in a sequential, top-to-bottom flow.
    Reads existing .env file and prompts for missing or placeholder values.
    
    Args:
        dev_mode (bool): If True, show dev mode banner but still prompt for all values
        force_reconfigure (bool): If True, force reconfiguration and clear preferences
        easy_mode (bool): If True, use minimal prompts and defaults for quick setup
    """
    global FORCE_OVERWRITE
    
    # Show first-time welcome if this is the first time
    if is_first_time_setup():
        display_first_time_welcome()
    
    # Clear preferences if reconfiguring
    if force_reconfigure:
        clear_preferences()
    
    env_file_exists = os.path.exists(ENV_FILE_PATH)
    
    if not env_file_exists:
        if os.path.exists(ENV_FILE_DEFAULT):
            print(f"{C_BLUE}📄 No .env file found. Creating one from the default template...{C_RESET}")
            shutil.copy(ENV_FILE_DEFAULT, ENV_FILE_PATH)
        else:
            print(f"{C_YELLOW}⚠️  Warning: .env.default not found. Creating an empty .env file.{C_RESET}")
            open(ENV_FILE_PATH, 'w').close()
        # When no .env file exists, we should configure everything without asking
        FORCE_OVERWRITE = True
    
    print(f"\n{C_TT_PURPLE}{C_BOLD}TT Studio Environment Configuration{C_RESET}")
    
    if easy_mode:
        print(f"{C_GREEN}⚡ Easy Mode: Minimal prompts, only HF_TOKEN required{C_RESET}")
        print(f"{C_CYAN}   Using defaults for all other values (not for production){C_RESET}")
    elif dev_mode:
        print(f"{C_YELLOW}Development Mode: You can use suggested defaults for quick setup{C_RESET}")
        print(f"{C_CYAN}   Note: Development defaults are NOT secure for production use{C_RESET}")
    else:
        print(f"{C_CYAN}Production Mode: You'll be prompted for secure, production-ready values{C_RESET}")
    
    # Get existing variables
    existing_vars = get_existing_env_vars()
    
    # Only ask about overwrite preference if .env file existed before (skip for easy mode)
    if not easy_mode and env_file_exists and existing_vars:
        FORCE_OVERWRITE = ask_overwrite_preference(existing_vars, force_prompt=force_reconfigure)
    else:
        # No need to ask, we're configuring everything
        if not env_file_exists:
            print(f"\n{C_CYAN}📝 Setting up TT Studio for the first time...{C_RESET}")
            FORCE_OVERWRITE = True
        elif easy_mode:
            # In easy mode with existing .env, don't force overwrite - let individual checks handle it
            print(f"\n{C_CYAN}📝 Using easy mode configuration...{C_RESET}")
            if env_file_exists and existing_vars:
                FORCE_OVERWRITE = False
            else:
                FORCE_OVERWRITE = True
        else:
            print(f"\n{C_CYAN}📝 No existing configuration found. Will configure all environment variables.{C_RESET}")
            FORCE_OVERWRITE = True

    print(f"\n{C_CYAN}📁 Setting core application paths...{C_RESET}")
    write_env_var("TT_STUDIO_ROOT", TT_STUDIO_ROOT, quote_value=False)
    write_env_var("HOST_PERSISTENT_STORAGE_VOLUME", os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume"), quote_value=False)
    write_env_var("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume", quote_value=False)
    write_env_var("BACKEND_API_HOSTNAME", "tt-studio-backend-api")

    print(f"\n{C_TT_PURPLE}{C_BOLD}--- 🔑  Security Credentials  ---{C_RESET}")
    
    # JWT_SECRET
    current_jwt = get_env_var("JWT_SECRET")
    if easy_mode:
        # In easy mode, use default value only if not already configured
        if should_configure_var("JWT_SECRET", current_jwt):
            write_env_var("JWT_SECRET", "test-secret-456")
            print("✅ JWT_SECRET set to default value (test-secret-456).")
        else:
            print("✅ JWT_SECRET already configured (keeping existing value).")
    elif should_configure_var("JWT_SECRET", current_jwt):
        if is_placeholder(current_jwt):
            print(f"🔄 JWT_SECRET has placeholder value '{current_jwt}' - configuring...")
        dev_default = "dev-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter JWT_SECRET (for authentication to model endpoints){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
        
        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("JWT_SECRET", val)
                print("✅ JWT_SECRET saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        print(f"✅ JWT_SECRET already configured (keeping existing value).")
    
    # DJANGO_SECRET_KEY
    current_django = get_env_var("DJANGO_SECRET_KEY")
    if easy_mode:
        # In easy mode, use default value only if not already configured
        if should_configure_var("DJANGO_SECRET_KEY", current_django):
            write_env_var("DJANGO_SECRET_KEY", "django-insecure-default")
            print("✅ DJANGO_SECRET_KEY set to default value.")
        else:
            print("✅ DJANGO_SECRET_KEY already configured (keeping existing value).")
    elif should_configure_var("DJANGO_SECRET_KEY", current_django):
        if is_placeholder(current_django):
            print(f"🔄 DJANGO_SECRET_KEY has placeholder value '{current_django}' - configuring...")
        dev_default = "django-dev-secret-key-not-for-production-12345" if dev_mode else ""
        prompt_text = f"🔑 Enter DJANGO_SECRET_KEY (for Django backend security){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
        
        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DJANGO_SECRET_KEY", val)
                print("✅ DJANGO_SECRET_KEY saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        print(f"✅ DJANGO_SECRET_KEY already configured (keeping existing value).")
            
    # TAVILY_API_KEY (optional)
    current_tavily = get_env_var("TAVILY_API_KEY")
    if easy_mode:
        # In easy mode, skip TAVILY_API_KEY only if not already configured
        if should_configure_var("TAVILY_API_KEY", current_tavily):
            write_env_var("TAVILY_API_KEY", "tavily-api-key-not-configured")
            print("✅ TAVILY_API_KEY skipped (easy mode).")
        else:
            print("✅ TAVILY_API_KEY already configured (keeping existing value).")
    elif should_configure_var("TAVILY_API_KEY", current_tavily):
        prompt_text = "🔍 Enter TAVILY_API_KEY for search agent (optional; press Enter to skip): "
        val = getpass.getpass(prompt_text)
        write_env_var("TAVILY_API_KEY", val or "")
        print("✅ TAVILY_API_KEY saved.")
    else:
        print(f"✅ TAVILY_API_KEY already configured (keeping existing value).")
        
    # HF_TOKEN
    current_hf = get_env_var("HF_TOKEN")
    if easy_mode:
        # In easy mode, only prompt if not already configured
        if should_configure_var("HF_TOKEN", current_hf):
            while True:
                val = getpass.getpass("🤗 Enter HF_TOKEN (Hugging Face token): ")
                if val and val.strip():
                    write_env_var("HF_TOKEN", val)
                    print("✅ HF_TOKEN saved.")
                    break
                print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
        else:
            print(f"✅ HF_TOKEN already configured (keeping existing value).")
    elif should_configure_var("HF_TOKEN", current_hf):
        while True:
            val = getpass.getpass("🤗 Enter HF_TOKEN (Hugging Face token): ")
            if val and val.strip():
                write_env_var("HF_TOKEN", val)
                print("✅ HF_TOKEN saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        print(f"✅ HF_TOKEN already configured (keeping existing value).")

    print(f"\n{C_TT_PURPLE}{C_BOLD}--- ⚙️  Application Configuration  ---{C_RESET}")

    # VITE_APP_TITLE
    current_title = get_env_var("VITE_APP_TITLE")
    if easy_mode:
        # In easy mode, use default value only if not already configured
        if should_configure_var("VITE_APP_TITLE", current_title):
            write_env_var("VITE_APP_TITLE", "Tenstorrent | TT Studio")
            print("✅ VITE_APP_TITLE set to default: Tenstorrent | TT Studio")
        else:
            print(f"✅ VITE_APP_TITLE already configured: {current_title}")
    elif should_configure_var("VITE_APP_TITLE", current_title):
        dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
        val = input(f"📝 Enter application title (default: {dev_default}): ") or dev_default
        write_env_var("VITE_APP_TITLE", val)
        print("✅ VITE_APP_TITLE saved.")
    else:
        print(f"✅ VITE_APP_TITLE already configured: {current_title}")

    print(f"\n{C_CYAN}{C_BOLD}------------------ Mode Selection ------------------{C_RESET}")
    
    # VITE_ENABLE_DEPLOYED
    current_deployed = get_env_var("VITE_ENABLE_DEPLOYED")
    if easy_mode:
        # In easy mode, disable AI Playground (use TT Studio mode) only if not already configured
        if should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
            write_env_var("VITE_ENABLE_DEPLOYED", "false", quote_value=False)
            print("✅ VITE_ENABLE_DEPLOYED set to false (TT Studio mode).")
        else:
            print(f"✅ VITE_ENABLE_DEPLOYED already configured: {current_deployed}")
    elif should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
        print("Enable AI Playground Mode? (Connects to external cloud models)")
        dev_default = "false" if dev_mode else "false"
        
        while True:
            val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
            if val in ["true", "false"]:
                write_env_var("VITE_ENABLE_DEPLOYED", val, quote_value=False)
                print("✅ VITE_ENABLE_DEPLOYED saved.")
                break
            print(f"{C_RED}⛔ Invalid input. Please enter 'true' or 'false'.{C_RESET}")
    else:
        print(f"✅ VITE_ENABLE_DEPLOYED already configured: {current_deployed}")
    
    is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))
    print(f"🔹 AI Playground Mode is {'ENABLED' if is_deployed_mode else 'DISABLED'}")
    
    # VITE_ENABLE_RAG_ADMIN
    current_rag = get_env_var("VITE_ENABLE_RAG_ADMIN")
    if easy_mode:
        # In easy mode, disable RAG admin only if not already configured
        if should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
            write_env_var("VITE_ENABLE_RAG_ADMIN", "false", quote_value=False)
            print("✅ VITE_ENABLE_RAG_ADMIN set to false (easy mode).")
        else:
            print(f"✅ VITE_ENABLE_RAG_ADMIN already configured: {current_rag}")
    elif should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
        print("\nEnable RAG document management admin page?")
        dev_default = "false" if dev_mode else "false"
        
        while True:
            val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
            if val in ["true", "false"]:
                write_env_var("VITE_ENABLE_RAG_ADMIN", val, quote_value=False)
                print("✅ VITE_ENABLE_RAG_ADMIN saved.")
                break
            print(f"{C_RED}⛔ Invalid input. Please enter 'true' or 'false'.{C_RESET}")
    else:
        print(f"✅ VITE_ENABLE_RAG_ADMIN already configured: {current_rag}")
    
    is_rag_admin_enabled = parse_boolean_env(get_env_var("VITE_ENABLE_RAG_ADMIN"))
    print(f"🔹 RAG Admin Page is {'ENABLED' if is_rag_admin_enabled else 'DISABLED'}")

    # RAG_ADMIN_PASSWORD (only if RAG is enabled, or set default in easy mode)
    current_rag_pass = get_env_var("RAG_ADMIN_PASSWORD")
    if easy_mode:
        # In easy mode, set a default value even if RAG is disabled, but only if not already configured
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            write_env_var("RAG_ADMIN_PASSWORD", "tt-studio-rag-admin-password")
            print("✅ RAG_ADMIN_PASSWORD set to default (easy mode).")
        else:
            print("✅ RAG_ADMIN_PASSWORD already configured (keeping existing value).")
    elif is_rag_admin_enabled:
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            dev_default = "dev-admin-123" if dev_mode else ""
            prompt_text = f"Enter RAG_ADMIN_PASSWORD{' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
            
            print("🔒 RAG admin is enabled. You must set a password.")
            while True:
                val = getpass.getpass(prompt_text)
                if not val and dev_mode:
                    val = dev_default
                if val and val.strip():
                    write_env_var("RAG_ADMIN_PASSWORD", val)
                    print("✅ RAG_ADMIN_PASSWORD saved.")
                    break
                print(f"{C_RED}⛔ Password cannot be empty.{C_RESET}")
        else:
            print(f"✅ RAG_ADMIN_PASSWORD already configured (keeping existing value).")

    # Cloud/External model configuration
    cloud_vars = [
        ("CLOUD_CHAT_UI_URL", "🦙 Llama Chat UI URL", False),
        ("CLOUD_CHAT_UI_AUTH_TOKEN", "🔑 Llama Chat UI Auth Token", True),
        ("CLOUD_YOLOV4_API_URL", "👁️  YOLOv4 API URL", False),
        ("CLOUD_YOLOV4_API_AUTH_TOKEN", "🔑 YOLOv4 API Auth Token", True),
        ("CLOUD_SPEECH_RECOGNITION_URL", "🎤 Whisper Speech Recognition URL", False),
        ("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN", "🔑 Whisper Speech Recognition Auth Token", True),
        ("CLOUD_STABLE_DIFFUSION_URL", "🎨 Stable Diffusion URL", False),
        ("CLOUD_STABLE_DIFFUSION_AUTH_TOKEN", "🔑 Stable Diffusion Auth Token", True),
    ]
    
    if easy_mode:
        # In easy mode, set all cloud variables to empty defaults only if not already configured
        for var_name, _, _ in cloud_vars:
            current_val = get_env_var(var_name)
            if should_configure_var(var_name, current_val):
                write_env_var(var_name, "")
        print("✅ Cloud model variables set to empty defaults (easy mode).")
    elif is_deployed_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- ☁️  AI Playground Model Configuration  ---{C_RESET}")
        print(f"{C_YELLOW}Note: These are optional. Press Enter to skip any field.{C_RESET}")
        
        for var_name, prompt, is_secret in cloud_vars:
            current_val = get_env_var(var_name)
            if should_configure_var(var_name, current_val):
                if is_secret:
                    val = getpass.getpass(f"{prompt} (optional): ")
                else:
                    val = input(f"{prompt} (optional): ")
                write_env_var(var_name, val or "")
                status = "saved" if val else "skipped (empty)"
                print(f"✅ {var_name} {status}.")
            else:
                print(f"✅ {var_name} already configured (keeping existing value).")
    else:
        print(f"\n{C_YELLOW}Skipping cloud model configuration (AI Playground mode is disabled).{C_RESET}")
    
    # Frontend configuration (always set in easy mode, optional otherwise)
    if easy_mode:
        current_frontend_host = get_env_var("FRONTEND_HOST")
        current_frontend_port = get_env_var("FRONTEND_PORT")
        current_frontend_timeout = get_env_var("FRONTEND_TIMEOUT")
        
        if should_configure_var("FRONTEND_HOST", current_frontend_host):
            write_env_var("FRONTEND_HOST", "localhost")
        if should_configure_var("FRONTEND_PORT", current_frontend_port):
            write_env_var("FRONTEND_PORT", "3000", quote_value=False)
        if should_configure_var("FRONTEND_TIMEOUT", current_frontend_timeout):
            write_env_var("FRONTEND_TIMEOUT", "60", quote_value=False)
        print("✅ Frontend configuration set to defaults (easy mode).")
    
    print(f"\n{C_GREEN}✅ Environment configuration complete.{C_RESET}")

def display_welcome_banner():
    """Display welcome banner"""
    # Clear screen for a clean splash screen effect
    os.system('cls' if OS_NAME == 'Windows' else 'clear')
    
    # Simple, clean banner without complex Unicode characters
    print(f"{C_TT_PURPLE}{C_BOLD}")
    print("=" * 68)
    print("                   Welcome to TT Studio")
    print("=" * 68)
    print(f"{C_RESET}")
    
    # Tenstorrent ASCII Art
    print(f"{C_TT_PURPLE}{C_BOLD}")
    print(TENSTORRENT_ASCII_ART)
    print(f"{C_RESET}")
    print()
    
    # TT Studio ASCII Art
    print(f"{C_TT_PURPLE}{C_BOLD}")
    print("████████╗████████╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ ")
    print("╚══██╔══╝╚══██╔══╝    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗")
    print("   ██║      ██║       ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║")
    print("   ██║      ██║       ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║")
    print("   ██║      ██║       ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝")
    print("   ╚═╝      ╚═╝       ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ")
    print(f"{C_RESET}")
    
    # Subtitle
    print(f"{C_CYAN}AI Model Development & Deployment Made Easy{C_RESET}")
    print()
    
    # Feature highlights
    print(f"{C_GREEN}Features:{C_RESET}")
    print(f"  • Interactive environment setup")
    print(f"  • Frontend dependencies management")
    print(f"  • Docker orchestration & management") 
    print(f"  • TT Inference Server integration")
    print(f"  • Hardware detection & optimization")
    print(f"  • AI Playground for cloud models")
    print()
    
    # Bottom line
    print("=" * 68)
    print()

def cleanup_resources(args):
    """Clean up Docker resources"""
    print(f"\n{C_TT_PURPLE}{C_BOLD}🧹 Cleaning up TT Studio resources...{C_RESET}")

    # Check Docker access and warn if needed
    has_docker_access = check_docker_access()
    if not has_docker_access:
        print(f"{C_YELLOW}⚠️  Docker permission issue detected - will use sudo for Docker commands{C_RESET}")

    # Build Docker Compose command for cleanup (use same logic as startup)
    docker_compose_cmd = build_docker_compose_command(dev_mode=args.dev, show_hardware_info=False)
    docker_compose_cmd.extend(["down", "-v"])

    # Stop and remove containers
    try:
        print(f"{C_BLUE}🛑 Stopping Docker containers...{C_RESET}")
        result = run_docker_command(docker_compose_cmd, use_sudo=not has_docker_access, capture_output=False)
        if result.returncode == 0:
            print(f"{C_GREEN}✅ Docker containers stopped successfully.{C_RESET}")
        else:
            print(f"{C_GREEN}✅ Docker containers stopped successfully.{C_RESET}")
    except subprocess.CalledProcessError as e:
        print(f"{C_YELLOW}⚠️  Error stopping containers{C_RESET}")
    except Exception as e:
        print(f"{C_YELLOW}⚠️  No running containers to stop.{C_RESET}")

    # Remove network if it exists
    try:
        print(f"{C_BLUE}🌐 Removing Docker network...{C_RESET}")
        result = run_docker_command(["docker", "network", "rm", "tt_studio_network"],
                                    use_sudo=not has_docker_access, capture_output=False)
        if result.returncode == 0:
            print(f"{C_GREEN}✅ Removed network 'tt_studio_network'.{C_RESET}")
        else:
            print(f"{C_YELLOW}⚠️  Network 'tt_studio_network' may not exist or couldn't be removed.{C_RESET}")
    except subprocess.CalledProcessError as e:
        print(f"{C_YELLOW}⚠️  Network 'tt_studio_network' doesn't exist or couldn't be removed.{C_RESET}")
    except Exception:
        print(f"{C_YELLOW}⚠️  Network 'tt_studio_network' doesn't exist or couldn't be removed.{C_RESET}")

    # Clean up FastAPI server
    print(f"{C_BLUE}🔧 Cleaning up FastAPI server...{C_RESET}")
    cleanup_fastapi_server(no_sudo=args.no_sudo)

    # Clean up Docker Control Service
    print(f"{C_BLUE}🔧 Cleaning up Docker Control Service...{C_RESET}")
    cleanup_docker_control_service(no_sudo=args.no_sudo)

    if args.cleanup_all:
        print(f"\n{C_ORANGE}{C_BOLD}🗑️  Performing complete cleanup (--cleanup-all)...{C_RESET}")
        
        # Remove persistent volume
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        if os.path.exists(host_persistent_volume):
            try:
                confirm = input(f"{C_YELLOW}📁 Remove persistent storage at {host_persistent_volume}? (y/N): {C_RESET}")
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}🛑 Cleanup interrupted. Persistent storage kept.{C_RESET}")
                print(f"{C_GREEN}✅ Basic cleanup completed successfully.{C_RESET}")
                return
            
            if confirm.lower() in ['y', 'yes']:
                shutil.rmtree(host_persistent_volume)
                print(f"{C_GREEN}✅ Removed persistent storage.{C_RESET}")
            else:
                print(f"{C_CYAN}📁 Keeping persistent storage.{C_RESET}")
        
        # Remove .env file
        if os.path.exists(ENV_FILE_PATH):
            try:
                confirm = input(f"{C_YELLOW}⚙️  Remove .env configuration file? (y/N): {C_RESET}")
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}🛑 Cleanup interrupted. Configuration file kept.{C_RESET}")
                print(f"{C_GREEN}✅ Partial cleanup completed.{C_RESET}")
                return
            
            if confirm.lower() in ['y', 'yes']:
                os.remove(ENV_FILE_PATH)
                print(f"{C_GREEN}✅ Removed .env file.{C_RESET}")
            else:
                print(f"{C_CYAN}⚙️  Keeping .env file.{C_RESET}")
        
        # Remove TT Inference Server directory
        if os.path.exists(INFERENCE_SERVER_DIR):
            try:
                confirm = input(f"{C_YELLOW}🔧 Remove TT Inference Server directory at {INFERENCE_SERVER_DIR}? (y/N): {C_RESET}")
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}🛑 Cleanup interrupted. TT Inference Server directory kept.{C_RESET}")
                print(f"{C_GREEN}✅ Partial cleanup completed.{C_RESET}")
                return
            
            if confirm.lower() in ['y', 'yes']:
                shutil.rmtree(INFERENCE_SERVER_DIR)
                print(f"{C_GREEN}✅ Removed TT Inference Server directory.{C_RESET}")
            else:
                print(f"{C_CYAN}🔧 Keeping TT Inference Server directory.{C_RESET}")
    
    print(f"\n{C_GREEN}{C_BOLD}✅ Cleanup complete! 🎉{C_RESET}")

def detect_tt_hardware():
    """Detect if Tenstorrent hardware is available."""
    return os.path.exists("/dev/tenstorrent") or os.path.isdir("/dev/tenstorrent")

def build_docker_compose_command(dev_mode=False, show_hardware_info=True):
    """
    Build the Docker Compose command with appropriate override files.
    
    Args:
        dev_mode (bool): Whether to enable development mode
        show_hardware_info (bool): Whether to show hardware detection messages
        
    Returns:
        list: Docker Compose command with appropriate files
    """
    compose_files = ["docker", "compose", "-f", DOCKER_COMPOSE_FILE]
    
    if dev_mode:
        # Add dev mode override if in dev mode and file exists
        if os.path.exists(DOCKER_COMPOSE_DEV_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_DEV_FILE])
            print(f"{C_MAGENTA}🚀 Applying development mode overrides...{C_RESET}")
    else:
        # Add production mode override if not in dev mode and file exists
        if os.path.exists(DOCKER_COMPOSE_PROD_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_PROD_FILE])
            print(f"{C_GREEN}🚀 Applying production mode overrides...{C_RESET}")
    
    # Add TT hardware override if hardware is detected
    if detect_tt_hardware():
        if os.path.exists(DOCKER_COMPOSE_TT_HARDWARE_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_TT_HARDWARE_FILE])
            if show_hardware_info:
                print(f"{C_GREEN}✅ Tenstorrent hardware detected - enabling hardware support{C_RESET}")
        else:
            if show_hardware_info:
                print(f"{C_YELLOW}⚠️  TT hardware detected but override file not found: {DOCKER_COMPOSE_TT_HARDWARE_FILE}{C_RESET}")
    else:
        if show_hardware_info:
            print(f"{C_YELLOW}⚠️  No Tenstorrent hardware detected{C_RESET}")
    
    return compose_files

def check_port_available(port):
    """Check if a port is available (like startup.sh)."""
    try:
        # Use the same approach as startup.sh
        result1 = subprocess.run(["lsof", "-Pi", f":{port}", "-sTCP:LISTEN", "-t"], 
                                capture_output=True, text=True, check=False)
        result2 = subprocess.run(["nc", "-z", "localhost", str(port)], 
                                capture_output=True, text=True, check=False)
        
        # Port is available if both commands fail (no output)
        return not (result1.stdout.strip() or result2.returncode == 0)
    except Exception:
        # Fallback to socket approach
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                return True
        except OSError:
            return False

def check_and_free_ports(ports, no_sudo=False):
    """
    Check if multiple ports are available and attempt to free them if not.
    
    Args:
        ports: List of tuples (port_number, service_name)
        no_sudo: Whether to skip sudo usage
        
    Returns:
        tuple: (bool, list) - (True if all ports OK, list of failed ports with service names)
    """
    failed_ports = []
    
    for port, service_name in ports:
        print(f"{C_BLUE}🔍 Checking if port {port} is available for {service_name}...{C_RESET}")
        if not check_port_available(port):
            print(f"{C_YELLOW}⚠️  Port {port} is already in use. Attempting to free the port...{C_RESET}")
            if not kill_process_on_port(port, no_sudo=no_sudo):
                print(f"{C_RED}❌ Failed to free port {port} for {service_name}{C_RESET}")
                failed_ports.append((port, service_name))
            else:
                print(f"{C_GREEN}✅ Port {port} is now available{C_RESET}")
        else:
            print(f"{C_GREEN}✅ Port {port} is available{C_RESET}")
    
    return (len(failed_ports) == 0, failed_ports)


def wait_for_service_health(service_name, health_url, timeout=300, interval=5):
    """
    Wait for a service to become healthy (HTTP 200 at the given URL).
    Returns True if healthy within timeout, else False.
    Prints live status messages.
    """
    start_time = time.time()
    sys.stdout.write(f"⏳ Waiting for {service_name} to become healthy at {health_url}...\n")
    sys.stdout.flush()
    
    while time.time() - start_time < timeout:
        elapsed = int(time.time() - start_time)
        if HAS_REQUESTS:
            try:
                response = requests.get(health_url, timeout=5)
                if response.status_code == 200:
                    print(f"\n✅ {service_name} is healthy!")
                    return True
            except requests.RequestException:
                pass
        else:
            try:
                resp = urllib.request.urlopen(health_url, timeout=5)
                if resp.getcode() == 200:
                    print(f"\n✅ {service_name} is healthy!")
                    return True
            except Exception:
                pass
        
        sys.stdout.write(f"\r⏳ {service_name} not ready yet... ({elapsed}s/{timeout}s)")
        sys.stdout.flush()
        time.sleep(interval)
    
    print(f"\n⚠️  {service_name} did not become healthy within {timeout} seconds")
    return False


def wait_for_all_services(skip_fastapi=False, is_deployed_mode=False):
    """
    Wait for all core services to become healthy before continuing.
    Returns True if all are healthy.
    """
    print("\n⏳ Waiting for all services to become healthy...")

    services_to_check = [
        ("ChromaDB", "http://localhost:8111/api/v1/heartbeat"),
        ("Backend API", "http://localhost:8000/up/"),
        ("Frontend", "http://localhost:3000/"),
    ]
    # Optionally add FastAPI
    if not skip_fastapi and not is_deployed_mode:
        services_to_check.append(("FastAPI Server", "http://localhost:8001/"))
    
    all_healthy = True
    for service_name, health_url in services_to_check:
        if not wait_for_service_health(service_name, health_url, timeout=120, interval=3):
            all_healthy = False
    
    if all_healthy:
        print("\n✅ All services are healthy and ready!")
    else:
        print("\n⚠️  Some services may not be fully ready, but main app may still be accessible.")
    return all_healthy

def wait_for_frontend_and_open_browser(host="localhost", port=3000, timeout=60, auto_deploy_model=None):
    """
    Wait for frontend service to be healthy before opening browser.
    
    Args:
        host: Frontend host
        port: Frontend port
        timeout: Timeout in seconds
        auto_deploy_model: Model name to auto-deploy (optional)
    
    Returns:
        bool: True if browser opened successfully, False otherwise
    """
    base_url = f"http://{host}:{port}/"
    
    # Add auto-deploy parameter if specified
    if auto_deploy_model:
        from urllib.parse import urlencode
        params = urlencode({"auto-deploy": auto_deploy_model})
        frontend_url = f"{base_url}?{params}"
        print(f"\n🤖 Auto-deploying model: {auto_deploy_model}")
    else:
        frontend_url = base_url
    
    print(f"\n🌐 Ensuring frontend is ready before opening browser...")
    
    if wait_for_service_health("Frontend", base_url, timeout=timeout, interval=2):
        print(f"🚀 Opening browser to {frontend_url}")
        try:
            webbrowser.open(frontend_url)
            return True
        except Exception as e:
            print(f"⚠️  Could not open browser automatically: {e}")
            print(f"💡 Please manually open: {frontend_url}")
            return False
    else:
        print(f"⚠️  Frontend not ready within {timeout} seconds")
        print(f"💡 You can try opening {frontend_url} manually once services are ready")
        return False

def get_frontend_config():
    """
    Getting frontend configuration from environment or defaults.
    """
    # Read from environment variables or use defaults
    host = os.getenv('FRONTEND_HOST', 'localhost')
    port = int(os.getenv('FRONTEND_PORT', '3000'))
    timeout = int(os.getenv('FRONTEND_TIMEOUT', '60'))
    
    return host, port, timeout



def kill_process_on_port(port, no_sudo=False):
    """
    Find and kill a process using a specific port. More robust and cross-platform.
    Handles permissions by trying commands with and without sudo.
    """
    pid = None
    

    # --- macOS and Linux logic ---
    
    # Define commands to try
    lsof_cmd = ["lsof", "-ti", f"tcp:{port}"]
    ss_cmd = ["ss", "-lptn", f"sport = :{port}"]
    
    # Function to run a command and extract PID
    def find_pid_with_command(base_cmd, use_sudo):
        cmd_to_run = base_cmd.copy()
        if use_sudo:
            cmd_to_run.insert(0, "sudo")
        
        # Run command but don't exit on failure
        result = run_command(cmd_to_run, check=False, capture_output=True)
        
        if result.returncode == 0 and result.stdout.strip():
            if "ss" in base_cmd[0]: # ss needs parsing
                match = re.search(r'pid=(\d+)', result.stdout.strip())
                return match.group(1) if match else None
            else: # lsof directly returns PID
                return result.stdout.strip().split('\n')[0]
        return None

    # Try lsof, then lsof with sudo
    if shutil.which("lsof"):
        pid = find_pid_with_command(lsof_cmd, use_sudo=False)
        if not pid and not no_sudo:
            pid = find_pid_with_command(lsof_cmd, use_sudo=True)

    # If lsof failed, try ss, then ss with sudo
    if not pid and shutil.which("ss"):
        pid = find_pid_with_command(ss_cmd, use_sudo=False)
        if not pid and not no_sudo:
            pid = find_pid_with_command(ss_cmd, use_sudo=True)

    if not pid:
        print(f"{C_YELLOW}⚠️  Could not find a specific process using port {port}. This is likely okay.{C_RESET}")
        return True

    print(f"🛑 Found process with PID {pid} using port {port}. Attempting to stop it...")
    
    # Build kill commands
    kill_cmd_graceful = ["kill", "-15", pid]
    kill_cmd_force = ["kill", "-9", pid]
    check_alive_cmd = ["kill", "-0", pid]
    use_sudo_for_kill = not no_sudo and os.geteuid() != 0

    if use_sudo_for_kill:
        kill_cmd_graceful.insert(0, "sudo")
        kill_cmd_force.insert(0, "sudo")
        check_alive_cmd.insert(0, "sudo")

    try:
        run_command(kill_cmd_graceful, check=False)
        time.sleep(2)
        
        result = run_command(check_alive_cmd, check=False, capture_output=True)
        if result.returncode == 0:
            print(f"⚠️  Process {pid} still alive. Forcing termination...")
            run_command(kill_cmd_force, check=True)
            print(f"{C_GREEN}✅ Process {pid} terminated by force.{C_RESET}")
        else:
            print(f"{C_GREEN}✅ Process {pid} terminated gracefully.{C_RESET}")

    except Exception as e:
        print(f"{C_RED}⛔ Failed to kill process {pid}: {e}{C_RESET}")
        print(f"{C_YELLOW}   You may need to stop it manually. Try: {' '.join(kill_cmd_force)}{C_RESET}")
        return False
        
    return True

def is_valid_git_repo(path):
    """Check if directory is a valid git repository.
    
    Args:
        path: Path to check
        
    Returns:
        None if directory doesn't exist
        True if directory is a valid git repository
        False if directory exists but is not a valid git repository
    """
    if not os.path.exists(path):
        return None  # Doesn't exist
    
    git_dir = os.path.join(path, ".git")
    if os.path.isfile(git_dir) or os.path.isdir(git_dir):
        # Verify it's actually valid by checking for HEAD
        try:
            result = subprocess.run(
                ["git", "-C", path, "rev-parse", "--git-dir"],
                capture_output=True, text=True, check=False
            )
            return result.returncode == 0
        except Exception:
            return False
    return False  # Exists but not a git repo

def initialize_submodules():
    """Initialize git submodules if they don't exist or are not properly set up."""
    print(f"🔧 Checking and initializing git submodules...")
    
    # Check if we're in a git repository
    if not os.path.exists(".git"):
        print(f"{C_RED}⛔ Error: Not in a git repository. Cannot initialize submodules.{C_RESET}")
        print(f"   Please ensure you cloned the repository with: git clone --recurse-submodules https://github.com/tenstorrent/tt-studio.git")
        return False
    
    # Check if .gitmodules exists
    if not os.path.exists(".gitmodules"):
        print(f"{C_RED}⛔ Error: .gitmodules file not found. Cannot initialize submodules.{C_RESET}")
        print(f"   Please ensure you have the complete repository.")
        return False
    
    # Check for corrupted submodule directories before attempting initialization
    submodule_path = os.path.join(TT_STUDIO_ROOT, "tt-inference-server")
    repo_state = is_valid_git_repo(submodule_path)
    
    if repo_state is False:  # Directory exists but is corrupted
        print(f"{C_YELLOW}⚠️  Detected corrupted submodule directory at {submodule_path}{C_RESET}")
        print(f"   Cause: Directory exists but is not a valid git repository")
        print(f"   This usually happens when:")
        print(f"   - A previous git operation was interrupted")
        print(f"   - The directory was created manually")
        print(f"   - Git's internal state is corrupted")
        print(f"   Solution: Cleaning up and re-initializing...")
        
        try:
            # Clean up corrupted directory
            shutil.rmtree(submodule_path)
            print(f"{C_GREEN}✅ Removed corrupted directory{C_RESET}")
            
            # Clean up git's internal cache
            git_modules_path = os.path.join(TT_STUDIO_ROOT, ".git", "modules", "tt-inference-server")
            if os.path.exists(git_modules_path):
                shutil.rmtree(git_modules_path)
                print(f"{C_GREEN}✅ Cleaned up git submodule cache{C_RESET}")
        except Exception as cleanup_error:
            print(f"{C_RED}⛔ Error during cleanup: {cleanup_error}{C_RESET}")
            print(f"   Please manually remove: {submodule_path}")
            return False
    
    try:
        # Step 1: Sync submodule configurations to align .gitmodules with .git/config
        print(f"🔄 Synchronizing submodule configurations...")
        run_command(["git", "submodule", "sync", "--recursive"], check=True)
        
        # Step 2: Update submodules to ensure they're properly initialized and on correct branches
        print(f"📦 Initializing and updating git submodules...")
        run_command(["git", "submodule", "update", "--init", "--recursive"], check=True)
        
        # Step 3: Ensure submodules are on the correct branch as specified in .gitmodules
        print(f"🌿 Ensuring submodules are on correct branches...")
        run_command(["git", "submodule", "foreach", "--recursive", "git checkout $(git config -f $toplevel/.gitmodules submodule.$name.branch || echo main)"], check=True)
        
        print(f"✅ Successfully initialized and updated git submodules")
        return True
        
    except (subprocess.CalledProcessError, SystemExit) as e:
        print(f"{C_RED}⛔ Error: Failed to initialize submodules{C_RESET}")
        
        # Provide specific diagnostic information
        error_output = ""
        if hasattr(e, 'stderr') and e.stderr:
            error_output = str(e.stderr)
        elif hasattr(e, 'output') and e.output:
            error_output = str(e.output)
        
        if "already exists and is not an empty directory" in error_output or "already exists" in str(e):
            print(f"   Cause: Submodule directory exists but couldn't be initialized")
            print(f"   This usually happens when:")
            print(f"   - A previous git operation was interrupted")
            print(f"   - The directory was created manually")
            print(f"   - Git's internal state is corrupted")
            print(f"\n   Manual fix:")
            print(f"   1. rm -rf tt-inference-server .git/modules/tt-inference-server")
            print(f"   2. Run this script again")
        else:
            print(f"   Error details: {error_output if error_output else str(e)}")
            print(f"   Please try manually: git submodule update --init --recursive")
        
        return False

def setup_tt_inference_server():
    """Set up TT Inference Server by preparing environment (submodule expected)."""
    print(f"\n{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}         🔧 Setting up TT Inference Server          {C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    
    # Always ensure submodules are properly initialized
    if not initialize_submodules():
        return False
    
    # Check if the directory exists after submodule initialization
    if not os.path.exists(INFERENCE_SERVER_DIR):
        print(f"{C_RED}⛔ Error: TT Inference Server directory still not found at {INFERENCE_SERVER_DIR}{C_RESET}")
        print(f"   This suggests the submodule configuration may be incorrect.")
        return False
    else:
        print(f"📁 TT Inference Server directory found at {INFERENCE_SERVER_DIR}")
    
    # Ensure the submodule is on the correct branch and up to date
    try:
        print(f"🔧 Ensuring TT Inference Server is on the correct branch and up to date...")
        original_dir = os.getcwd()
        os.chdir(INFERENCE_SERVER_DIR)
        
        # Check current branch/status
        result = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True, check=False)
        current_branch = result.stdout.strip()
        
        if current_branch != INFERENCE_SERVER_BRANCH:
            print(f"🌿 Current branch: {current_branch or 'detached HEAD'}, switching to: {INFERENCE_SERVER_BRANCH}")
            
            # Fetch the latest changes from remote
            print(f"📥 Fetching latest changes from remote...")
            run_command(["git", "fetch", "origin"], check=True)
            
            # Check out the correct branch as specified in .gitmodules
            run_command(["git", "checkout", INFERENCE_SERVER_BRANCH], check=True)
            
            # Pull the latest changes
            print(f"📥 Pulling latest changes...")
            run_command(["git", "pull", "origin", INFERENCE_SERVER_BRANCH], check=True)
        else:
            print(f"✅ Already on correct branch: {INFERENCE_SERVER_BRANCH}")
            # Still pull latest changes
            print(f"📥 Pulling latest changes...")
            run_command(["git", "pull", "origin", INFERENCE_SERVER_BRANCH], check=True)
        
        print(f"✅ TT Inference Server is now on the correct branch: {INFERENCE_SERVER_BRANCH}")
        
    except (subprocess.CalledProcessError, SystemExit) as e:
        print(f"{C_YELLOW}⚠️  Warning: Could not update TT Inference Server branch: {e}{C_RESET}")
        print(f"   Continuing with current state...")
    finally:
        os.chdir(original_dir)
    
    # Verify that requirements-api.txt exists
    requirements_file = os.path.join(INFERENCE_SERVER_DIR, "requirements-api.txt")
    if not os.path.exists(requirements_file):
        print(f"{C_RED}⛔ Error: requirements-api.txt not found in TT Inference Server directory{C_RESET}")
        print(f"   Expected path: {requirements_file}")
        print(f"   This suggests the submodule is not properly set up or on the wrong branch.")
        return False
    else:
        print(f"✅ Found requirements-api.txt in TT Inference Server directory")
    
    return True

def setup_fastapi_environment():
    """Set up the FastAPI environment with virtual environment and dependencies."""
    print(f"🔧 Setting up FastAPI environment...")
    
    # Store original directory
    original_dir = os.getcwd()
    
    try:
        # Change to inference server directory (like startup.sh)
        print(f"📁 Changing to TT Inference Server directory: {INFERENCE_SERVER_DIR}")
        os.chdir(INFERENCE_SERVER_DIR)
        
        # Verify we're in the right directory and can see the requirements file
        current_dir = os.getcwd()
        print(f"📍 Current directory: {current_dir}")
        
        if not os.path.exists("requirements-api.txt"):
            print(f"{C_RED}⛔ Error: requirements-api.txt not found in {current_dir}{C_RESET}")
            print(f"📂 Files in current directory:")
            try:
                for item in os.listdir("."):
                    print(f"   - {item}")
            except Exception as e:
                print(f"   Could not list directory: {e}")
            return False
        else:
            print(f"✅ Found requirements-api.txt in {current_dir}")
        
        # Create virtual environment if it doesn't exist (like startup.sh)
        if not os.path.exists(".venv"):
            print(f"🐍 Creating Python virtual environment...")
            try:
                run_command(["python3", "-m", "venv", ".venv"], check=True)
                print(f"✅ Virtual environment created successfully")
            except (subprocess.CalledProcessError, SystemExit) as e:
                print(f"{C_RED}⛔ Error: Failed to create virtual environment: {e}{C_RESET}")
                return False
        else:
            print(f"🐍 Virtual environment already exists")
        
        # Verify the virtual environment was created properly
        venv_pip = ".venv/bin/pip"
        if OS_NAME == "Windows":
            venv_pip = ".venv/Scripts/pip.exe"
        
        if not os.path.exists(venv_pip):
            print(f"{C_RED}⛔ Error: Virtual environment pip not found at {venv_pip}{C_RESET}")
            return False
        
        # Upgrade pip first
        print(f"📦 Upgrading pip in virtual environment...")
        try:
            run_command([venv_pip, "install", "--upgrade", "pip"], check=True)
            print(f"✅ Pip upgraded successfully")
        except (subprocess.CalledProcessError, SystemExit) as e:
            print(f"{C_YELLOW}⚠️  Warning: Failed to upgrade pip: {e}{C_RESET}")
            print(f"   Continuing with installation...")
        
        # Install requirements (like startup.sh)
        print(f"📦 Installing Python requirements from requirements-api.txt...")
        try:
            run_command([venv_pip, "install", "-r", "requirements-api.txt"], check=True)
            print(f"✅ Requirements installed successfully")
        except (subprocess.CalledProcessError, SystemExit) as e:
            print(f"{C_RED}⛔ Error: Failed to install requirements: {e}{C_RESET}")
            print(f"📜 Contents of requirements-api.txt:")
            try:
                with open("requirements-api.txt", "r") as f:
                    for line_num, line in enumerate(f, 1):
                        print(f"   {line_num}: {line.rstrip()}")
            except Exception as read_e:
                print(f"   Could not read requirements file: {read_e}")
            return False
        
        # Verify uvicorn was installed
        venv_uvicorn = ".venv/bin/uvicorn"
        if OS_NAME == "Windows":
            venv_uvicorn = ".venv/Scripts/uvicorn.exe"
        
        if os.path.exists(venv_uvicorn):
            print(f"✅ uvicorn installed successfully at {venv_uvicorn}")
        else:
            print(f"{C_YELLOW}⚠️  Warning: uvicorn not found at expected location {venv_uvicorn}{C_RESET}")
            print(f"   Checking if uvicorn is available in the virtual environment...")
            try:
                run_command([".venv/bin/python", "-c", "import uvicorn; print('uvicorn is available')"], check=True)
                print(f"✅ uvicorn is available in the virtual environment")
            except (subprocess.CalledProcessError, SystemExit):
                print(f"{C_RED}⛔ Error: uvicorn is not available in the virtual environment{C_RESET}")
                return False
        
        return True
    finally:
        # Always return to original directory
        os.chdir(original_dir)

def start_fastapi_server(no_sudo=False):
    """Start the FastAPI server on port 8001."""
    print(f"🚀 Starting FastAPI server on port 8001...")
    
    # Check if port 8001 is available
    if not check_port_available(8001):
        print(f"⚠️  Port 8001 is already in use. Attempting to free the port...")
        if not kill_process_on_port(8001, no_sudo=no_sudo):
            print(f"{C_RED}❌ Failed to free port 8001. Please manually stop any process using this port.{C_RESET}")
            return False
        print(f"✅ Port 8001 is now available")
    else:
        print(f"✅ Port 8001 is available")
    
    # Create PID and log files as regular user (no sudo needed for port 8001)
    # FastAPI writes logs to fastapi.log at repo root, not to persistent volume
    print(f"🔧 Setting up log and PID files...")
    
    for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
        try:
            # Create files as regular user
            with open(file_path, 'w') as f:
                pass
            os.chmod(file_path, 0o644)
        except Exception as e:
            print(f"{C_YELLOW}Warning: Could not create {file_path}: {e}{C_RESET}")
    
    # Get environment variables for the server (exactly like startup.sh)
    jwt_secret = get_env_var("JWT_SECRET")
    hf_token = get_env_var("HF_TOKEN")
    
    # Export the environment variables (exactly like startup.sh)
    if jwt_secret:
        os.environ["JWT_SECRET"] = jwt_secret
    if hf_token:
        os.environ["HF_TOKEN"] = hf_token
    
    # Start the FastAPI server - use the same approach as startup.sh
    venv_uvicorn = os.path.join(INFERENCE_SERVER_DIR, ".venv", "bin", "uvicorn")
    if OS_NAME == "Windows":
        venv_uvicorn = os.path.join(INFERENCE_SERVER_DIR, ".venv", "Scripts", "uvicorn.exe")
    
    if not os.path.exists(venv_uvicorn):
        print(f"{C_RED}⛔ Error: uvicorn not found in virtual environment{C_RESET}")
        print(f"   Expected path: {venv_uvicorn}")
        print(f"   Please ensure requirements-api.txt was installed correctly")
        return False
    
    try:
        # Create a temporary wrapper script exactly like startup.sh
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
            temp_script.write('''#!/bin/bash
set -e
cd "$1"
# Save PID to file first to avoid permission issues
echo $$ > "$2"
# Try to start the server with specific error handling
if ! "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8001 > "$4" 2>&1; then
    echo "Failed to start FastAPI server. Check logs at $4"
    exit 1
fi
''')
            temp_script_path = temp_script.name
        
        # Make the script executable
        os.chmod(temp_script_path, 0o755)
        
        # Start the server using the wrapper script with environment variables
        # Run as the actual user (no sudo needed for port 8001)
        env = os.environ.copy()
        if jwt_secret:
            env["JWT_SECRET"] = jwt_secret
        if hf_token:
            env["HF_TOKEN"] = hf_token
        
        # Run without sudo - port 8001 is non-privileged
        cmd = [temp_script_path, INFERENCE_SERVER_DIR, FASTAPI_PID_FILE, ".venv", FASTAPI_LOG_FILE]
        process = subprocess.Popen(cmd, env=env)
        
        # Health check (same as startup.sh)
        print(f"⏳ Waiting for FastAPI server to start...")
        health_check_retries = 30
        health_check_delay = 2
        
        for i in range(1, health_check_retries + 1):
            # First check if process is running (exactly like startup.sh)
            if process.poll() is not None:
                print(f"{C_RED}⛔ Error: FastAPI server process died{C_RESET}")
                print(f"📜 Last few lines of FastAPI log:")
                try:
                    with open(FASTAPI_LOG_FILE, 'r') as f:
                        lines = f.readlines()
                        for line in lines[-15:]:
                            print(f"   {line.rstrip()}")
                except:
                    print("   No log file found")
                
                # Check for common errors in the log (exactly like startup.sh)
                try:
                    with open(FASTAPI_LOG_FILE, 'r') as f:
                        log_content = f.read()
                        if "address already in use" in log_content:
                            print(f"{C_RED}❌ Error: Port 8001 is still in use by another process.{C_RESET}")
                            print(f"   Please manually stop any process using port 8001:")
                            print(f"   1. Run: sudo lsof -i :8001")
                            print(f"   2. Run: sudo kill -9 <PID>")
                except:
                    pass
                return False
            
            # Check if server is responding to HTTP requests (exactly like startup.sh)
            try:
                result = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:8001/"], 
                                       capture_output=True, text=True, timeout=5, check=False)
                if result.stdout.strip() in ["200", "404"]:
                    print(f"✅ FastAPI server started successfully (PID: {process.pid})")
                    print(f"🌐 FastAPI server accessible at: http://localhost:8001")
                    print(f"🔐 FastAPI server: {C_CYAN}http://localhost:8001{C_RESET} (check: curl http://localhost:8001/)")
                    return True
            except:
                # Fallback to urllib if curl is not available
                try:
                    import urllib.request
                    response = urllib.request.urlopen("http://localhost:8001/", timeout=5)
                    if response.getcode() in [200, 404]:
                        print(f"✅ FastAPI server started successfully (PID: {process.pid})")
                        print(f"🌐 FastAPI server accessible at: http://localhost:8001")
                        print(f"🔐 FastAPI server: {C_CYAN}http://localhost:8001{C_RESET} (check: curl http://localhost:8001/)")
                        return True
                except:
                    pass
            
            if i == health_check_retries:
                print(f"{C_RED}⛔ Error: FastAPI server failed health check after {health_check_retries} attempts{C_RESET}")
                print(f"📜 Last few lines of FastAPI log:")
                try:
                    with open(FASTAPI_LOG_FILE, 'r') as f:
                        lines = f.readlines()
                        for line in lines[-10:]:
                            print(f"   {line.rstrip()}")
                except:
                    print("   No log file found")
                print(f"💡 Try running: curl -v http://localhost:8001/ to debug connection issues")
                return False
            
            print(f"⏳ Health check attempt {i}/{health_check_retries} - waiting {health_check_delay}s...")
            time.sleep(health_check_delay)
        
    except Exception as e:
        print(f"{C_RED}⛔ Error starting FastAPI server: {e}{C_RESET}")
        return False
    finally:
        # Clean up the temporary script
        try:
            os.unlink(temp_script_path)
        except:
            pass
    
    return True

def cleanup_fastapi_server(no_sudo=False):
    """Clean up FastAPI server processes and files."""
    print(f"🧹 Cleaning up FastAPI server...")
    
    # Track what was cleaned
    pid_file_existed = False
    process_killed = False
    port_freed = False
    files_removed = []
    
    # Helper function to check if process is still alive
    def is_process_alive(pid):
        """Check if a process with given PID is still running."""
        try:
            # Signal 0 doesn't kill, just checks if process exists
            os.kill(int(pid), 0)
            return True
        except ProcessLookupError:
            return False  # Process doesn't exist
        except PermissionError:
            # If we can't check, try with sudo
            if not no_sudo:
                result = subprocess.run(["sudo", "kill", "-0", str(pid)], 
                                      capture_output=True, check=False)
                return result.returncode == 0
            return True  # Assume alive if we can't check
    
    # Kill process if PID file exists
    if os.path.exists(FASTAPI_PID_FILE):
        pid_file_existed = True
        try:
            with open(FASTAPI_PID_FILE, 'r') as f:
                pid = f.read().strip()
            if pid and pid.isdigit():
                pid_int = int(pid)
                # Check if process is actually running
                if is_process_alive(pid_int):
                    print(f"🛑 Found FastAPI process with PID {pid}. Stopping it...")
                    try:
                        # Try graceful termination first
                        os.kill(pid_int, signal.SIGTERM)
                        time.sleep(2)
                        
                        # Check if still alive and force kill if needed
                        if is_process_alive(pid_int):
                            print(f"⚠️  Process {pid} still running. Forcing termination...")
                            os.kill(pid_int, signal.SIGKILL)
                            time.sleep(1)
                        
                        # Verify termination
                        if not is_process_alive(pid_int):
                            process_killed = True
                            print(f"✅ FastAPI process {pid} terminated successfully")
                        else:
                            print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                    except PermissionError:
                        if not no_sudo:
                            # Try with sudo
                            print(f"🔐 Using sudo to terminate process {pid}...")
                            subprocess.run(["sudo", "kill", "-15", pid], check=False)
                            time.sleep(2)
                            if is_process_alive(pid_int):
                                subprocess.run(["sudo", "kill", "-9", pid], check=False)
                                time.sleep(1)
                            
                            # Verify termination
                            if not is_process_alive(pid_int):
                                process_killed = True
                                print(f"✅ FastAPI process {pid} terminated successfully")
                            else:
                                print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                        else:
                            print(f"{C_YELLOW}⚠️  Warning: Could not kill process {pid} without sudo{C_RESET}")
                    except ProcessLookupError:
                        # Process already terminated
                        process_killed = True
                        print(f"ℹ️  Process {pid} was already terminated")
                    except Exception as e:
                        print(f"{C_YELLOW}⚠️  Warning: Could not kill FastAPI process {pid}: {e}{C_RESET}")
                else:
                    print(f"ℹ️  PID file exists but process {pid} is not running")
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not read PID file: {e}{C_RESET}")
    
    # Kill any process on port 8001 (this handles cases where PID file is missing but port is in use)
    port_was_in_use = not check_port_available(8001)
    port_result = kill_process_on_port(8001, no_sudo=no_sudo)
    if port_result and port_was_in_use:
        # kill_process_on_port returned True and port was in use, so we freed it
        # Verify port is now available
        if check_port_available(8001):
            port_freed = True
    
    # Remove PID and log files
    # FastAPI writes logs to fastapi.log at repo root (not persistent volume)
    for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                files_removed.append(file_path)
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not remove {file_path}: {e}{C_RESET}")
    
    # Report cleanup status
    if process_killed or port_freed or files_removed:
        print(f"✅ FastAPI server cleanup completed")
        if process_killed:
            print(f"   • Process terminated")
        if port_freed:
            print(f"   • Port 8001 freed")
        if files_removed:
            print(f"   • Removed {len(files_removed)} file(s)")
    elif pid_file_existed:
        # PID file existed but process was already dead
        print(f"✅ FastAPI server cleanup completed (process was already stopped)")
    else:
        # Nothing to clean
        print(f"✅ FastAPI server cleanup completed (no running process found)")

def start_docker_control_service(no_sudo=False):
    """Start the Docker Control Service on port 8002."""
    print(f"🚀 Starting Docker Control Service on port 8002...")

    # Check if user has Docker access
    if not check_docker_access():
        print(f"{C_YELLOW}⚠️  Docker Control Service requires direct Docker socket access{C_RESET}")
        print(f"{C_YELLOW}   (660 permissions detected - service would need sudo which is not supported){C_RESET}")
        print(f"{C_CYAN}   Skipping Docker Control Service - Backend will use direct Docker SDK instead{C_RESET}")
        return False

    # Check if port 8002 is available
    if not check_port_available(8002):
        print(f"⚠️  Port 8002 is already in use. Attempting to free the port...")
        if not kill_process_on_port(8002, no_sudo=no_sudo):
            print(f"{C_RED}❌ Failed to free port 8002. Please manually stop any process using this port.{C_RESET}")
            return False
        print(f"✅ Port 8002 is now available")
    else:
        print(f"✅ Port 8002 is available")

    # Check if service is already running
    if HAS_REQUESTS:
        try:
            response = requests.get("http://127.0.0.1:8002/api/v1/health", timeout=2)
            if response.status_code == 200:
                print(f"{C_GREEN}✅ Docker Control Service already running{C_RESET}")
                return True
        except requests.exceptions.RequestException:
            pass

    # Check if service directory exists
    if not os.path.exists(DOCKER_CONTROL_SERVICE_DIR):
        print(f"{C_RED}⛔ Error: Docker Control Service directory not found at {DOCKER_CONTROL_SERVICE_DIR}{C_RESET}")
        return False

    # Create PID and log files
    print(f"🔧 Setting up log and PID files...")

    for file_path in [DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE]:
        try:
            with open(file_path, 'w') as f:
                pass
            os.chmod(file_path, 0o644)
        except Exception as e:
            print(f"{C_YELLOW}Warning: Could not create {file_path}: {e}{C_RESET}")

    # Check for virtual environment
    venv_dir = os.path.join(DOCKER_CONTROL_SERVICE_DIR, ".venv")
    venv_python = os.path.join(venv_dir, "bin", "python")

    if OS_NAME == "Windows":
        venv_python = os.path.join(venv_dir, "Scripts", "python.exe")

    # Create virtual environment and install dependencies if needed
    if not os.path.exists(venv_dir):
        print("📦 Creating virtual environment for Docker Control Service...")
        try:
            subprocess.run(
                ["python3", "-m", "venv", ".venv"],
                cwd=DOCKER_CONTROL_SERVICE_DIR,
                check=True
            )
        except Exception as e:
            print(f"{C_RED}⛔ Error creating virtual environment: {e}{C_RESET}")
            return False

    # Check if requirements are installed
    requirements_file = os.path.join(DOCKER_CONTROL_SERVICE_DIR, "requirements-api.txt")
    if not os.path.exists(requirements_file):
        print(f"{C_RED}⛔ Error: requirements-api.txt not found at {requirements_file}{C_RESET}")
        return False

    # Install/upgrade dependencies
    print("📦 Installing Docker Control Service dependencies...")
    venv_pip = os.path.join(venv_dir, "bin", "pip")
    if OS_NAME == "Windows":
        venv_pip = os.path.join(venv_dir, "Scripts", "pip.exe")

    try:
        subprocess.run(
            [venv_pip, "install", "--upgrade", "pip"],
            cwd=DOCKER_CONTROL_SERVICE_DIR,
            capture_output=True,
            check=True
        )
        subprocess.run(
            [venv_pip, "install", "-r", "requirements-api.txt"],
            cwd=DOCKER_CONTROL_SERVICE_DIR,
            capture_output=True,
            check=True
        )
    except Exception as e:
        print(f"{C_RED}⛔ Error installing dependencies: {e}{C_RESET}")
        return False

    # Get environment variables for the service
    jwt_secret = get_env_var("DOCKER_CONTROL_JWT_SECRET")

    # Export environment variables
    env = os.environ.copy()
    if jwt_secret:
        env["DOCKER_CONTROL_JWT_SECRET"] = jwt_secret

    # Start the service using uvicorn
    try:
        # Create a temporary wrapper script similar to FastAPI
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
            temp_script.write('''#!/bin/bash
set -e
cd "$1"
# Save PID to file
echo $$ > "$2"
# Start the service
if ! "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8002 > "$4" 2>&1; then
    echo "Failed to start Docker Control Service. Check logs at $4"
    exit 1
fi
''')
            temp_script_path = temp_script.name

        # Make the script executable
        os.chmod(temp_script_path, 0o755)

        # Start the service
        cmd = [temp_script_path, DOCKER_CONTROL_SERVICE_DIR, DOCKER_CONTROL_PID_FILE, ".venv", DOCKER_CONTROL_LOG_FILE]
        process = subprocess.Popen(cmd, env=env)

        # Health check
        print(f"⏳ Waiting for Docker Control Service to start...")
        health_check_retries = 30
        health_check_delay = 2

        for i in range(1, health_check_retries + 1):
            # Check if process is still running
            if process.poll() is not None:
                print(f"{C_RED}⛔ Error: Docker Control Service process died{C_RESET}")
                print(f"📜 Last few lines of log:")
                try:
                    with open(DOCKER_CONTROL_LOG_FILE, 'r') as f:
                        lines = f.readlines()
                        for line in lines[-15:]:
                            print(f"   {line.rstrip()}")
                except:
                    print("   No log file found")
                return False

            # Check if service is responding
            if HAS_REQUESTS:
                try:
                    response = requests.get("http://127.0.0.1:8002/api/v1/health", timeout=5)
                    if response.status_code == 200:
                        print(f"✅ Docker Control Service started successfully (PID: {process.pid})")
                        print(f"🌐 Docker Control Service accessible at: http://localhost:8002")
                        print(f"🔐 API documentation: {C_CYAN}http://localhost:8002/api/v1/docs{C_RESET}")
                        return True
                except:
                    pass
            else:
                # Fallback to urllib if requests not available
                try:
                    import urllib.request
                    response = urllib.request.urlopen("http://localhost:8002/api/v1/health", timeout=5)
                    if response.getcode() == 200:
                        print(f"✅ Docker Control Service started successfully (PID: {process.pid})")
                        print(f"🌐 Docker Control Service accessible at: http://localhost:8002")
                        print(f"🔐 API documentation: {C_CYAN}http://localhost:8002/api/v1/docs{C_RESET}")
                        return True
                except:
                    pass

            if i == health_check_retries:
                print(f"{C_RED}⛔ Error: Docker Control Service failed health check after {health_check_retries} attempts{C_RESET}")
                print(f"📜 Last few lines of log:")
                try:
                    with open(DOCKER_CONTROL_LOG_FILE, 'r') as f:
                        lines = f.readlines()
                        for line in lines[-10:]:
                            print(f"   {line.rstrip()}")
                except:
                    print("   No log file found")
                return False

            print(f"⏳ Health check attempt {i}/{health_check_retries} - waiting {health_check_delay}s...")
            time.sleep(health_check_delay)

    except Exception as e:
        print(f"{C_RED}⛔ Error starting Docker Control Service: {e}{C_RESET}")
        return False
    finally:
        # Clean up the temporary script
        try:
            os.unlink(temp_script_path)
        except:
            pass

    return True

def cleanup_docker_control_service(no_sudo=False):
    """Clean up Docker Control Service processes and files."""
    print(f"🧹 Cleaning up Docker Control Service...")

    # Track what was cleaned
    pid_file_existed = False
    process_killed = False
    port_freed = False
    files_removed = []

    # Helper function to check if process is still alive
    def is_process_alive(pid):
        """Check if a process with given PID is still running."""
        try:
            os.kill(int(pid), 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            if not no_sudo:
                result = subprocess.run(["sudo", "kill", "-0", str(pid)],
                                      capture_output=True, check=False)
                return result.returncode == 0
            return True

    # Kill process if PID file exists
    if os.path.exists(DOCKER_CONTROL_PID_FILE):
        pid_file_existed = True
        try:
            with open(DOCKER_CONTROL_PID_FILE, 'r') as f:
                pid = f.read().strip()
            if pid and pid.isdigit():
                pid_int = int(pid)
                if is_process_alive(pid_int):
                    print(f"🛑 Found Docker Control Service process with PID {pid}. Stopping it...")
                    try:
                        # Try graceful termination first
                        os.kill(pid_int, signal.SIGTERM)
                        time.sleep(2)

                        # Check if still alive and force kill if needed
                        if is_process_alive(pid_int):
                            print(f"⚠️  Process {pid} still running. Forcing termination...")
                            os.kill(pid_int, signal.SIGKILL)
                            time.sleep(1)

                        # Verify termination
                        if not is_process_alive(pid_int):
                            process_killed = True
                            print(f"✅ Docker Control Service process {pid} terminated successfully")
                        else:
                            print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                    except PermissionError:
                        if not no_sudo:
                            print(f"🔐 Using sudo to terminate process {pid}...")
                            subprocess.run(["sudo", "kill", "-15", pid], check=False)
                            time.sleep(2)
                            if is_process_alive(pid_int):
                                subprocess.run(["sudo", "kill", "-9", pid], check=False)
                                time.sleep(1)

                            if not is_process_alive(pid_int):
                                process_killed = True
                                print(f"✅ Docker Control Service process {pid} terminated successfully")
                            else:
                                print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                        else:
                            print(f"{C_YELLOW}⚠️  Warning: Could not kill process {pid} without sudo{C_RESET}")
                    except ProcessLookupError:
                        process_killed = True
                        print(f"ℹ️  Process {pid} was already terminated")
                    except Exception as e:
                        print(f"{C_YELLOW}⚠️  Warning: Could not kill process {pid}: {e}{C_RESET}")
                else:
                    print(f"ℹ️  PID file exists but process {pid} is not running")
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not read PID file: {e}{C_RESET}")

    # Kill any process on port 8002
    port_was_in_use = not check_port_available(8002)
    port_result = kill_process_on_port(8002, no_sudo=no_sudo)
    if port_result and port_was_in_use:
        if check_port_available(8002):
            port_freed = True

    # Remove PID and log files
    for file_path in [DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE]:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                files_removed.append(file_path)
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not remove {file_path}: {e}{C_RESET}")

    # Report cleanup status
    if process_killed or port_freed or files_removed:
        print(f"✅ Docker Control Service cleanup completed")
        if process_killed:
            print(f"   • Process terminated")
        if port_freed:
            print(f"   • Port 8002 freed")
        if files_removed:
            print(f"   • Removed {len(files_removed)} file(s)")
    elif pid_file_existed:
        print(f"✅ Docker Control Service cleanup completed (process was already stopped)")
    else:
        print(f"✅ Docker Control Service cleanup completed (no running process found)")

def request_sudo_authentication(force_prompt=False):
    """
    Request sudo authentication upfront and cache it for later use.
    
    Args:
        force_prompt (bool): If True, always prompt even if sudo is already authenticated
    
    Returns:
        bool: True if authenticated, False otherwise
    """
    # Check if sudo is available
    if not shutil.which("sudo"):
        print(f"{C_RED}⛔ Error: sudo is not available on this system.{C_RESET}")
        return False
    
    # First, check if sudo is already authenticated (non-interactive mode)
    if not force_prompt:
        check_result = subprocess.run(["sudo", "-n", "-v"], capture_output=True, text=True)
        if check_result.returncode == 0:
            print(f"{C_GREEN}✅ Sudo is already authenticated (using cached credentials).{C_RESET}")
            return True
    
    print(f"🔐 TT Inference Server setup requires sudo privileges. Please enter your password:")
    try:
        # Test sudo access - this will prompt for password if needed
        result = subprocess.run(["sudo", "-v"], check=True, capture_output=True, text=True)
        print(f"✅ Sudo authentication successful.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"{C_RED}⛔ Error: Failed to authenticate with sudo{C_RESET}")
        if e.returncode == 1:
            print(f"{C_YELLOW}   This usually means the password was incorrect or sudo access was denied.{C_RESET}")
        return False
    except FileNotFoundError:
        print(f"{C_RED}⛔ Error: sudo command not found{C_RESET}")
        return False

def ensure_frontend_dependencies(force_prompt=False, easy_mode=False):
    """
    Ensures frontend dependencies are available locally for IDE support.
    This is optional for running the app, as dependencies are always installed
    inside the Docker container, but it greatly improves the development experience
    (e.g., for TypeScript autocompletion).
    
    Args:
        force_prompt (bool): If True, always prompt user even if preference exists
        easy_mode (bool): If True, automatically skip npm installation without prompting
    """
    frontend_dir = os.path.join(TT_STUDIO_ROOT, "app", "frontend")
    node_modules_dir = os.path.join(frontend_dir, "node_modules")
    package_json_path = os.path.join(frontend_dir, "package.json")

    print(f"\n{C_BLUE}📦 Checking frontend dependencies for IDE support...{C_RESET}")

    if not os.path.exists(package_json_path):
        print(f"{C_RED}⛔ Error: package.json not found in {frontend_dir}. Cannot continue.{C_RESET}")
        return False

    # If node_modules already exists and is populated, we're good.
    if os.path.exists(node_modules_dir) and os.listdir(node_modules_dir):
        print(f"{C_GREEN}✅ Local node_modules found. IDE support is active.{C_RESET}")
        return True

    print(f"{C_YELLOW}💡 Local node_modules directory not found or is empty.{C_RESET}")
    print(f"{C_CYAN}   Installing them locally will enable IDE features like autocompletion.{C_RESET}")
    print(f"{C_CYAN}   This is optional; the application will still run correctly using the dependencies inside the Docker container.{C_RESET}")

    # Check for local npm installation
    has_local_npm = shutil.which("npm")

    try:
        if has_local_npm:
            # In easy mode, automatically skip npm installation
            if easy_mode:
                print(f"{C_YELLOW}Skipping local npm installation (easy mode). IDE features may be limited.{C_RESET}")
                save_preference("npm_install_locally", 'n')
                return True
            
            # Check for saved preference
            npm_pref = get_preference("npm_install_locally")
            choice = None
            
            if not force_prompt and npm_pref:
                if npm_pref in ['n', 'no', 'false']:
                    print(f"{C_YELLOW}Skipping local dependency installation (using saved preference). IDE features may be limited.{C_RESET}")
                    return True
                # else preference is to install
                choice = npm_pref
            else:
                choice = input(f"Do you want to run 'npm install' locally? (Y/n): ").lower().strip() or 'y'
                save_preference("npm_install_locally", choice)
            
            # Check the actual choice (either from preference or from user input)
            if choice not in ['n', 'no', 'false']:
                print(f"\n{C_BLUE}📦 Installing dependencies locally with npm...{C_RESET}")
                run_command(["npm", "install"], check=True, cwd=frontend_dir)
                print(f"{C_GREEN}✅ Frontend dependencies installed successfully.{C_RESET}")
            else:
                print(f"{C_YELLOW}Skipping local dependency installation. IDE features may be limited.{C_RESET}")

        else: # No local npm found
            print(f"\n{C_YELLOW}⚠️ 'npm' command not found on your local machine.{C_RESET}")
            
            # Check for saved preference
            docker_pref = get_preference("npm_install_via_docker")
            choice = None
            
            if not force_prompt and docker_pref:
                if docker_pref in ['n', 'no', 'false']:
                    print(f"{C_YELLOW}Skipping local dependency installation (using saved preference). IDE features may be limited.{C_RESET}")
                    return True
                choice = docker_pref
            else:
                choice = input(f"Do you want to install dependencies using Docker? (Y/n): ").lower().strip() or 'y'
                save_preference("npm_install_via_docker", choice)
            
            # Check the actual choice (either from preference or from user input)
            if choice not in ['n', 'no', 'false']:
                print(f"\n{C_BLUE}📦 Installing dependencies using a temporary Docker container...{C_RESET}")
                # This command runs `npm install` inside a container and mounts the result back to the host.
                docker_cmd = [
                    "docker", "run", "--rm",
                    "-v", f"{frontend_dir}:/app",
                    "-w", "/app",
                    "node:22-alpine3.20",
                    "npm", "install"
                ]
                run_command(docker_cmd, check=True)
                print(f"{C_GREEN}✅ Frontend dependencies installed successfully using Docker.{C_RESET}")
            else:
                print(f"{C_YELLOW}Skipping local dependency installation. IDE features may be limited.{C_RESET}")

    except (subprocess.CalledProcessError, SystemExit) as e:
        print(f"{C_RED}⛔ Error installing frontend dependencies: {e}{C_RESET}")
        print(f"{C_YELLOW}   Could not install dependencies locally. IDE features may be limited, but the app will still run.{C_RESET}")
        return True # Still return True, as this is not a fatal error for the application itself.
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}🛑 Installation cancelled by user.{C_RESET}")
        return True

    return True

def get_spdx_header_type(file_path):
    """
    Determines the appropriate SPDX header type based on file extension.
    """
    suffix = file_path.suffix.lower()
    name = file_path.name
    
    if suffix in ('.py', '.sh') or name == 'Dockerfile':
        return 'hash'
    elif suffix in ('.ts', '.tsx', '.js', '.jsx'):
        return 'double_slash'
    elif suffix == '.css':
        return 'css'
    elif suffix in ('.html', '.htm'):
        return 'html'
    else:
        return None

def get_spdx_headers():
    """
    Returns SPDX header templates for different file types.
    """
    current_year = datetime.now().year
    
    return {
        # Python, Bash, Dockerfile
        'hash': f"""# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
        # TypeScript, JavaScript
        'double_slash': f"""// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
        # CSS
        'css': f"""/* SPDX-License-Identifier: Apache-2.0
 *
 * SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
 */
""",
        # HTML
        'html': f"""<!-- SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC -->
"""
    }

def should_skip_spdx_directory(directory_path):
    """
    Determines if a directory should be skipped during SPDX processing.
    """
    directory_name = directory_path.name
    
    # Skip common directories that shouldn't have SPDX headers
    skip_dirs = {
        'node_modules',
        '.git',
        '.venv',
        '__pycache__',
        '.pytest_cache',
        'dist',
        'build',
        '.next',
        'coverage',
        '.nyc_output',
        'frontend',  # Explicitly exclude frontend directory
        'tt-inference-server',  # Exclude submodule
        'tt_studio_persistent_volume',  # Exclude runtime data
    }
    
    return directory_name in skip_dirs

def add_spdx_header_to_file(file_path, headers):
    """
    Adds the SPDX header to the file if it doesn't already contain it.
    """
    header_type = get_spdx_header_type(file_path)
    if header_type is None:
        return False
    
    header = headers[header_type]
    
    try:
        with open(file_path, "r+", encoding='utf-8') as file:
            content = file.read()
            if "SPDX-License-Identifier" not in content:
                file.seek(0, 0)
                file.write(header + "\n" + content)
                print(f"{C_GREEN}✅ Added SPDX header to: {file_path}{C_RESET}")
                return True
            else:
                return False
    except Exception as e:
        print(f"{C_RED}❌ Error processing {file_path}: {e}{C_RESET}")
        return False

def check_spdx_headers():
    """
    Check for missing SPDX headers in the codebase (excluding frontend).
    """
    print(f"{C_BLUE}{C_BOLD}🔍 Checking for missing SPDX license headers...{C_RESET}")
    
    repo_root = Path(TT_STUDIO_ROOT)
    directories_to_process = [
        repo_root / "app" / "backend",
        repo_root / "app" / "agent", 
        repo_root / "app" / "frontend",
        repo_root / "dev-tools",
        repo_root / "models",
        repo_root / "docs",
        repo_root,  # Root level files (like run.py, startup.sh)
    ]
    
    missing_headers = []
    total_files_checked = 0
    
    for directory in directories_to_process:
        if not directory.exists():
            print(f"{C_YELLOW}⚠️  Directory does not exist: {directory}{C_RESET}")
            continue
            
        print(f"{C_CYAN}📁 Checking directory: {directory}{C_RESET}")
        for file_path in directory.rglob("*"):
            if file_path.is_file():
                # Skip files in excluded directories
                if any(should_skip_spdx_directory(parent) for parent in file_path.parents):
                    continue
                    
                # Check if the file is a supported type
                if get_spdx_header_type(file_path) is not None:
                    total_files_checked += 1
                    try:
                        with open(file_path, "r", encoding='utf-8') as file:
                            content = file.read()
                            if "SPDX-License-Identifier" not in content:
                                missing_headers.append(str(file_path))
                    except Exception as e:
                        print(f"{C_YELLOW}⚠️  Could not read {file_path}: {e}{C_RESET}")
    
    print(f"\n{C_BLUE}📊 SPDX Header Check Results:{C_RESET}")
    print(f"  Total files checked: {total_files_checked}")
    print(f"  Files with missing headers: {len(missing_headers)}")
    
    if missing_headers:
        print(f"\n{C_RED}{C_BOLD}❌ Files missing SPDX headers:{C_RESET}")
        for file_path in missing_headers:
            print(f"  {C_RED}• {file_path}{C_RESET}")
        print(f"\n{C_CYAN}💡 To add missing headers, run: {C_WHITE}python run.py --add-headers{C_RESET}")
        print(f"   {C_CYAN}or alternatively:{C_RESET}")
        print(f"   {C_CYAN}python3 run.py --add-headers{C_RESET}")
        return False
    else:
        print(f"\n{C_GREEN}{C_BOLD}✅ All files have proper SPDX license headers!{C_RESET}")
        return True

def add_spdx_headers():
    """
    Add missing SPDX headers to all source files (excluding frontend).
    """
    print(f"{C_BLUE}{C_BOLD}📝 Adding missing SPDX license headers...{C_RESET}")
    
    repo_root = Path(TT_STUDIO_ROOT)
    directories_to_process = [
        repo_root / "app" / "backend",
        repo_root / "app" / "agent", 
        repo_root / "dev-tools",
        repo_root / "models",
        repo_root / "docs",
        repo_root,  # Root level files (like run.py, startup.sh)
    ]
    
    headers = get_spdx_headers()
    files_modified = 0
    total_files_checked = 0
    
    for directory in directories_to_process:
        if not directory.exists():
            print(f"{C_YELLOW}⚠️  Directory does not exist: {directory}{C_RESET}")
            continue
            
        print(f"{C_CYAN}📁 Processing directory: {directory}{C_RESET}")
        for file_path in directory.rglob("*"):
            if file_path.is_file():
                # Skip files in excluded directories
                if any(should_skip_spdx_directory(parent) for parent in file_path.parents):
                    continue
                    
                # Check if the file is a supported type
                if get_spdx_header_type(file_path) is not None:
                    total_files_checked += 1
                    if add_spdx_header_to_file(file_path, headers):
                        files_modified += 1
    
    print(f"\n{C_BLUE}📊 SPDX Header Addition Results:{C_RESET}")
    print(f"  Total files checked: {total_files_checked}")
    print(f"  Files modified: {files_modified}")
    
    if files_modified > 0:
        print(f"\n{C_GREEN}{C_BOLD}✅ Successfully added SPDX headers to {files_modified} files!{C_RESET}")
    else:
        print(f"\n{C_GREEN}{C_BOLD}✅ All files already have proper SPDX license headers!{C_RESET}")

def fix_docker_issues():
    """Automatically fix common Docker service and permission issues."""
    print(f"\n{C_TT_PURPLE}{C_BOLD}🔧 TT Studio Docker Fix Utility{C_RESET}")
    print(f"{C_YELLOW}{'=' * 60}{C_RESET}")

    try:
        # Step 1: Start Docker service
        print(f"\n{C_BLUE}🚀 Starting Docker service...{C_RESET}")
        result = subprocess.run(["sudo", "service", "docker", "start"],
                              capture_output=True, text=True, check=False)

        if result.returncode == 0:
            print(f"{C_GREEN}✅ Docker service started successfully{C_RESET}")
        else:
            print(f"{C_YELLOW}⚠️  Docker service start returned code {result.returncode}{C_RESET}")
            if result.stderr:
                print(f"{C_YELLOW}   {result.stderr.strip()}{C_RESET}")

        # Step 2: Determine socket group and provide guidance
        print(f"\n{C_BLUE}🔒 Checking Docker socket permissions...{C_RESET}")
        try:
            import grp
            socket_stat = os.stat("/var/run/docker.sock")
            socket_group = grp.getgrgid(socket_stat.st_gid).gr_name
            current_user = getpass.getuser()

            print(f"{C_CYAN}Docker socket group: {socket_group}{C_RESET}")
            print(f"\n{C_YELLOW}Choose permission fix method:{C_RESET}")
            print(f"  {C_GREEN}1){C_RESET} Add user to {socket_group} group (recommended, secure)")
            print(f"  {C_GREEN}2){C_RESET} Set socket to 666 (quick fix, less secure)")
            print(f"  {C_GREEN}3){C_RESET} Keep current permissions and use sudo for Docker commands")

            try:
                choice = input(f"\n{C_CYAN}Enter choice (1-3) [1]: {C_RESET}").strip() or "1"
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}⚠️  Cancelled by user{C_RESET}")
                return False

            if choice == "1":
                print(f"\n{C_BLUE}Adding user '{current_user}' to '{socket_group}' group...{C_RESET}")
                group_result = subprocess.run(["sudo", "usermod", "-aG", socket_group, current_user],
                                            capture_output=True, text=True, check=False)

                if group_result.returncode == 0:
                    print(f"{C_GREEN}✅ User added to {socket_group} group{C_RESET}")
                    print(f"\n{C_YELLOW}⚠️  IMPORTANT: You need to log out and log back in for group changes to take effect{C_RESET}")
                    print(f"{C_CYAN}Or run this command to apply changes in current session:{C_RESET}")
                    print(f"   {C_WHITE}newgrp {socket_group}{C_RESET}")
                else:
                    print(f"{C_RED}❌ Failed to add user to group: {group_result.stderr.strip() if group_result.stderr else 'Unknown error'}{C_RESET}")
                    return False

            elif choice == "2":
                print(f"\n{C_YELLOW}⚠️  Setting socket permissions to 666 (less secure){C_RESET}")
                socket_result = subprocess.run(["sudo", "chmod", "666", "/var/run/docker.sock"],
                                             capture_output=True, text=True, check=False)

                if socket_result.returncode == 0:
                    print(f"{C_GREEN}✅ Docker socket permissions set to 666{C_RESET}")
                    print(f"{C_YELLOW}Note: To reset to secure 660, run: sudo chmod 660 /var/run/docker.sock{C_RESET}")
                else:
                    print(f"{C_RED}❌ Failed to set permissions: {socket_result.stderr.strip() if socket_result.stderr else 'Unknown error'}{C_RESET}")
                    return False

            elif choice == "3":
                print(f"\n{C_CYAN}✅ Keeping current permissions{C_RESET}")
                print(f"{C_YELLOW}TT Studio will use sudo for Docker commands when needed{C_RESET}")

            else:
                print(f"{C_RED}❌ Invalid choice{C_RESET}")
                return False

        except Exception as e:
            print(f"{C_YELLOW}⚠️  Could not check socket permissions: {e}{C_RESET}")
            print(f"{C_YELLOW}Defaulting to 666 permissions...{C_RESET}")
            socket_result = subprocess.run(["sudo", "chmod", "666", "/var/run/docker.sock"],
                                         capture_output=True, text=True, check=False)
            if socket_result.returncode == 0:
                print(f"{C_GREEN}✅ Docker socket permissions set to 666{C_RESET}")

        # Step 3: Test Docker connectivity
        print(f"\n{C_BLUE}🔍 Testing Docker connectivity...{C_RESET}")
        test_result = subprocess.run(["docker", "info"],
                                   capture_output=True, text=True, check=False)

        if test_result.returncode == 0:
            print(f"{C_GREEN}✅ Docker is working correctly!{C_RESET}")
            print(f"\n{C_GREEN}{C_BOLD}🎉 Docker fix completed successfully!{C_RESET}")
            print(f"{C_CYAN}You can now run: {C_WHITE}python run.py{C_RESET}")
        else:
            print(f"{C_RED}❌ Docker connectivity test failed{C_RESET}")
            if test_result.stderr:
                print(f"{C_YELLOW}Error: {test_result.stderr.strip()}{C_RESET}")
            print(f"\n{C_YELLOW}You may need to manually troubleshoot Docker installation.{C_RESET}")
            return False

    except FileNotFoundError:
        print(f"{C_RED}❌ Error: 'sudo' or 'docker' command not found{C_RESET}")
        print(f"{C_YELLOW}Please ensure Docker is installed and sudo is available.{C_RESET}")
        return False
    except Exception as e:
        print(f"{C_RED}❌ Unexpected error during Docker fix: {e}{C_RESET}")
        return False

    print(f"{C_YELLOW}{'=' * 60}{C_RESET}")
    return True

def main():
    """Main function to orchestrate the script."""
    try:
        parser = argparse.ArgumentParser(
            description=f"""
{C_TT_PURPLE}{C_BOLD}🚀 TT Studio Setup Script{C_RESET}

{C_CYAN}A comprehensive setup tool for Tenstorrent TT Studio that handles:{C_RESET}
• Environment configuration with interactive prompts
• Frontend dependencies installation (node_modules)
• Docker services orchestration  
• TT Inference Server FastAPI setup
• Hardware detection and optimization

{C_YELLOW}For detailed environment variable help, use: {C_CYAN}--help-env{C_RESET}
        """,
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog=f"""
{C_GREEN}{C_BOLD}Examples:{C_RESET}
  {C_CYAN}python run.py{C_RESET}                   🚀 Normal interactive setup
  {C_CYAN}python run.py --easy{C_RESET}            ⚡ Easy setup - minimal prompts, only HF_TOKEN required
  {C_CYAN}python run.py --dev{C_RESET}             🛠️  Development mode with suggested defaults
  {C_CYAN}python run.py --reconfigure{C_RESET}      🔄 Reset preferences and reconfigure all options
  {C_CYAN}python run.py --cleanup{C_RESET}         🧹 Clean up containers and networks only
  {C_CYAN}python run.py --cleanup-all{C_RESET}     🗑️  Complete cleanup including data and config
  {C_CYAN}python run.py --skip-fastapi{C_RESET}    ⏭️  Skip FastAPI server setup (auto-skipped in AI Playground mode)
  {C_CYAN}python run.py --no-browser{C_RESET}      🚫 Skip automatic browser opening
  {C_CYAN}python run.py --wait-for-services{C_RESET} ⏳ Wait for all services to be healthy before completing
  {C_CYAN}python run.py --check-headers{C_RESET} 🔍 Check for missing SPDX license headers
  {C_CYAN}python run.py --add-headers{C_RESET} 📝 Add missing SPDX license headers (excludes frontend)
  {C_CYAN}python run.py --fix-docker{C_RESET}   🔧 Automatically fix Docker service and permission issues
  {C_CYAN}python run.py --help-env{C_RESET}        📚 Show detailed environment variables help

{C_MAGENTA}For more information, visit: https://github.com/tenstorrent/tt-studio{C_RESET}
        """
        )
        parser.add_argument("--dev", action="store_true", 
                           help="🛠️  Development mode - show suggested defaults but still prompt for all values")
        parser.add_argument("--cleanup", action="store_true", 
                           help="🧹 Clean up Docker containers and networks")
        parser.add_argument("--cleanup-all", action="store_true", 
                           help="🗑️  Clean up everything including persistent data and .env file")
        parser.add_argument("--help-env", action="store_true", 
                           help="📚 Show detailed help for environment variables")
        parser.add_argument("--reconfigure", action="store_true",
                           help="🔄 Reset preferences and reconfigure all options")
        parser.add_argument("--skip-fastapi", action="store_true",
                           help="⏭️  Skip TT Inference Server FastAPI setup (auto-skipped in AI Playground mode)")
        parser.add_argument("--skip-docker-control", action="store_true",
                           help="⏭️  Skip Docker Control Service setup")
        parser.add_argument("--no-sudo", action="store_true",
                           help="🚫 Skip sudo usage for FastAPI setup (may limit functionality)")
        parser.add_argument("--no-browser", action="store_true", 
                           help="🚫 Skip automatic browser opening")
        parser.add_argument("--wait-for-services", action="store_true", 
                           help="⏳ Wait for all services to be healthy before completing")
        parser.add_argument("--browser-timeout", type=int, default=60,
                   help="⏳ Timeout in seconds for waiting for frontend before opening browser")
        parser.add_argument("--add-headers", action="store_true",
                   help="📝 Add missing SPDX license headers to all source files (excludes frontend)")
        parser.add_argument("--check-headers", action="store_true",
                   help="🔍 Check for missing SPDX license headers without adding them")
        parser.add_argument("--auto-deploy", type=str, metavar="MODEL_NAME",
                   help="🤖 Automatically deploy the specified model after startup (e.g., 'Llama-3.2-1B-Instruct')")
        parser.add_argument("--fix-docker", action="store_true",
                   help="🔧 Automatically fix Docker service and permission issues")
        parser.add_argument("--easy", action="store_true",
                   help="🚀 Easy setup mode - only prompts for HF_TOKEN, uses defaults for everything else")
        
        args = parser.parse_args()
        
        if args.help_env:
            print(f"""
{C_TT_PURPLE}{C_BOLD}TT Studio Environment Variables Help{C_RESET}

{C_CYAN}{C_BOLD}Core Configuration:{C_RESET}
{'=' * 80}
  {C_YELLOW}TT_STUDIO_ROOT{C_RESET}                      Root directory of the repository
  {C_YELLOW}HOST_PERSISTENT_STORAGE_VOLUME{C_RESET}      Host path for persistent storage
  {C_YELLOW}INTERNAL_PERSISTENT_STORAGE_VOLUME{C_RESET}  Container path for persistent storage
  {C_YELLOW}BACKEND_API_HOSTNAME{C_RESET}                Backend API hostname

{C_RED}{C_BOLD}Security (Required):{C_RESET}
{'=' * 80}
  {C_YELLOW}JWT_SECRET{C_RESET}                          JWT authentication secret
  {C_YELLOW}DJANGO_SECRET_KEY{C_RESET}                   Django application secret key
  {C_YELLOW}HF_TOKEN{C_RESET}                            Hugging Face API token

{C_YELLOW}{C_BOLD}Optional Services:{C_RESET}
{'=' * 80}
  {C_YELLOW}TAVILY_API_KEY{C_RESET}                      Tavily search API key (optional)

{C_GREEN}{C_BOLD}Application Modes:{C_RESET}
{'=' * 80}
  {C_YELLOW}VITE_APP_TITLE{C_RESET}                      Application title
  {C_YELLOW}VITE_ENABLE_DEPLOYED{C_RESET}                Enable AI Playground mode (true/false)
  {C_YELLOW}VITE_ENABLE_RAG_ADMIN{C_RESET}               Enable RAG admin interface (true/false)
  {C_YELLOW}RAG_ADMIN_PASSWORD{C_RESET}                  RAG admin password (required if RAG enabled)

{C_BLUE}{C_BOLD}Cloud Models (Only when AI Playground is enabled):{C_RESET}
{'=' * 80}
  {C_YELLOW}CLOUD_CHAT_UI_URL{C_RESET}                   Llama Chat UI endpoint
  {C_YELLOW}CLOUD_CHAT_UI_AUTH_TOKEN{C_RESET}            Llama Chat UI authentication token
  {C_YELLOW}CLOUD_YOLOV4_API_URL{C_RESET}                YOLOv4 API endpoint
  {C_YELLOW}CLOUD_YOLOV4_API_AUTH_TOKEN{C_RESET}         YOLOv4 API authentication token
  {C_YELLOW}CLOUD_SPEECH_RECOGNITION_URL{C_RESET}        Whisper API endpoint
  {C_YELLOW}CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN{C_RESET} Whisper API authentication token
  {C_YELLOW}CLOUD_STABLE_DIFFUSION_URL{C_RESET}          Stable Diffusion API endpoint
  {C_YELLOW}CLOUD_STABLE_DIFFUSION_AUTH_TOKEN{C_RESET}   Stable Diffusion API authentication token

{C_MAGENTA}{C_BOLD}Usage Examples:{C_RESET}
{'=' * 80}
  {C_CYAN}python run.py{C_RESET}                        Normal setup with prompts
  {C_CYAN}python run.py --easy{C_RESET}                 Easy setup - minimal prompts, only HF_TOKEN required
  {C_CYAN}python run.py --dev{C_RESET}                  Development mode with defaults
  {C_CYAN}python run.py --reconfigure{C_RESET}          Reset preferences and reconfigure
  {C_CYAN}python run.py --cleanup{C_RESET}              Clean up containers only
  {C_CYAN}python run.py --cleanup-all{C_RESET}          Complete cleanup (data + config)
  {C_CYAN}python run.py --skip-fastapi{C_RESET}         Skip FastAPI server setup
  {C_CYAN}python run.py --no-sudo{C_RESET}              Skip sudo usage (may limit functionality)
  {C_CYAN}python run.py --check-headers{C_RESET}        Check for missing SPDX license headers
  {C_CYAN}python run.py --add-headers{C_RESET}          Add missing SPDX license headers

{'=' * 80}
{C_WHITE}For more information, visit: {C_CYAN}https://github.com/tenstorrent/tt-studio{C_RESET}
        """)
            return
        
        if args.cleanup or args.cleanup_all:
            cleanup_resources(args)
            return
        
        if args.check_headers:
            check_spdx_headers()
            return
        
        if args.fix_docker:
            success = fix_docker_issues()
            sys.exit(0 if success else 1)
        
        if args.add_headers:
            add_spdx_headers()
            return
        
        display_welcome_banner()
        check_docker_installation()
        configure_environment_sequentially(dev_mode=args.dev, force_reconfigure=args.reconfigure, easy_mode=args.easy)

        # Save easy mode configuration to JSON if --easy flag was used
        if args.easy:
            easy_config = {
                "mode": "easy",
                "setup_timestamp": datetime.now().isoformat(),
                "jwt_secret_default": "test-secret-456",
                "django_secret_key_default": "django-insecure-default",
                "hf_token_provided": True,
                "tt_studio_mode": True,
                "ai_playground_mode": False,
                "vite_app_title": "Tenstorrent | TT Studio",
                "vite_enable_deployed": "false",
                "vite_enable_rag_admin": "false"
            }
            save_easy_config(easy_config)

        # Create persistent storage directory
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        if host_persistent_volume:
            if not os.path.isdir(host_persistent_volume):
                print(f"\n{C_BLUE}📁 Creating persistent storage directory at: {host_persistent_volume}{C_RESET}")
                os.makedirs(host_persistent_volume, exist_ok=True)
                # Only set permissions on newly created directory (we own it)
                # Existing subdirectories will be handled by Docker containers via docker-entrypoint.sh
                try:
                    os.chmod(host_persistent_volume, 0o777)
                except (OSError, PermissionError) as e:
                    print(f"{C_YELLOW}⚠️  Could not set permissions on persistent volume: {e}{C_RESET}")
                    print(f"{C_YELLOW}   Docker containers will handle permissions via docker-entrypoint.sh{C_RESET}")

        # Create Docker network
        print(f"\n{C_BLUE}Checking for Docker network 'tt_studio_network'...{C_RESET}")
        has_docker_access = check_docker_access()
        if not has_docker_access:
            print(f"{C_YELLOW}⚠️  Docker permission issue detected - will use sudo for Docker commands (password may be required){C_RESET}")

        try:
            # For network ls, we need to capture output to check if network exists
            # First try without sudo to check if we can access Docker
            result = subprocess.run(["docker", "network", "ls"], capture_output=True, text=True, check=False)

            if result.returncode != 0 and "permission denied" in result.stderr.lower():
                # Permission denied, try with sudo (without capturing output for password prompt)
                print(f"{C_YELLOW}⚠️  Permission denied, using sudo (you may be prompted for password)...{C_RESET}")
                # First authenticate with a simple sudo command
                subprocess.run(["sudo", "-v"], check=False)
                # Now run the network ls command with sudo and capture output
                result = subprocess.run(["sudo", "docker", "network", "ls"], capture_output=True, text=True, check=True)
            elif result.returncode != 0:
                raise subprocess.CalledProcessError(result.returncode, ["docker", "network", "ls"], result.stdout, result.stderr)

            if "tt_studio_network" not in result.stdout:
                try:
                    print(f"{C_BLUE}Creating Docker network 'tt_studio_network'...{C_RESET}")
                    if has_docker_access:
                        result = subprocess.run(["docker", "network", "create", "tt_studio_network"],
                                              capture_output=True, text=True, check=True)
                    else:
                        result = subprocess.run(["sudo", "docker", "network", "create", "tt_studio_network"],
                                              capture_output=True, text=True, check=True)
                    print(f"{C_GREEN}Network 'tt_studio_network' created.{C_RESET}")
                except subprocess.CalledProcessError as e:
                    error_output = e.stderr.lower() if e.stderr else ""
                    print(f"{C_RED}⛔ Error: Failed to create Docker network.{C_RESET}")

                    if "cannot connect" in error_output or "connection refused" in error_output:
                        print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
                        print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                        print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
                        print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
                        print()
                        print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
                        print(f"   {C_CYAN}sudo service docker start{C_RESET}")
                        print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
                        print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                    else:
                        print(f"{C_YELLOW}Docker network creation failed: {e.stderr if e.stderr else 'Unknown error'}{C_RESET}")
                        print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")

                    sys.exit(1)
            else:
                print(f"{C_GREEN}Network 'tt_studio_network' already exists.{C_RESET}")
        except subprocess.CalledProcessError as e:
            error_output = e.stderr.lower() if e.stderr else ""
            print(f"{C_RED}⛔ Error: Failed to list Docker networks.{C_RESET}")

            if "cannot connect" in error_output or "connection refused" in error_output:
                print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
                print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
                print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
                print()
                print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
                print(f"   {C_CYAN}sudo service docker start{C_RESET}")
                print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
                print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
            else:
                print(f"{C_YELLOW}Docker network listing failed: {e.stderr if e.stderr else 'Unknown error'}{C_RESET}")
                print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")

            sys.exit(1)

        # Ensure frontend dependencies are installed
        ensure_frontend_dependencies(force_prompt=args.reconfigure, easy_mode=args.easy)

        # Check if all required ports are available
        print(f"\n{C_BOLD}{C_BLUE}🔍 Checking port availability for all services...{C_RESET}")
        print(f"{C_CYAN}The following ports will be checked and freed if needed:{C_RESET}")
        print(f"  • Port 3000 - Frontend (Vite dev server)")
        print(f"  • Port 8000 - Backend API (Django/Gunicorn)")
        print(f"  • Port 8080 - Agent Service")
        print(f"  • Port 8111 - ChromaDB (Vector Database)")
        print(f"{C_YELLOW}⚠️  If any of these ports are in use, we will attempt to free them.{C_RESET}\n")

        # Define ports based on mode
        required_ports = [
            (3000, "Frontend"),
            (8000, "Backend API"),
            (8080, "Agent Service"),
            (8111, "ChromaDB"),
        ]

        ports_ok, failed_ports = check_and_free_ports(required_ports, no_sudo=args.no_sudo)

        if not ports_ok:
            print(f"\n{C_RED}{C_BOLD}❌ ERROR: The following ports are not available:{C_RESET}")
            print()
            for port, service_name in failed_ports:
                print(f"  {C_RED}• Port {port} - {service_name}{C_RESET}")
            print()
            print(f"{C_YELLOW}These ports are required for TT Studio to run.{C_RESET}")
            print()
            print(f"{C_CYAN}{C_BOLD}To resolve this issue:{C_RESET}")
            print(f"  1. Find processes using these ports:")
            for port, _ in failed_ports:
                print(f"     {C_WHITE}lsof -i :{port}{C_RESET}")
            print()
            print(f"  2. Stop the processes manually:")
            print(f"     {C_WHITE}kill -9 <PID>{C_RESET}")
            print()
            print(f"  3. Or run with sudo to automatically free ports:")
            print(f"     {C_WHITE}python run.py{C_RESET} (without --no-sudo)")
            print()
            sys.exit(1)

        print(f"{C_GREEN}✅ All required ports are available{C_RESET}\n")

        # Ensure workflow_logs directory exists with correct permissions before Docker mounts it
        # This prevents Docker from creating it as root (which causes permission issues)
        workflow_logs_dir = os.path.join(TT_STUDIO_ROOT, "tt-inference-server", "workflow_logs")
        if not os.path.exists(workflow_logs_dir):
            print(f"{C_BLUE}📁 Creating workflow_logs directory with correct permissions...{C_RESET}")
            try:
                os.makedirs(workflow_logs_dir, mode=0o755, exist_ok=True)
                print(f"{C_GREEN}✅ Created workflow_logs directory{C_RESET}")
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not create workflow_logs directory: {e}{C_RESET}")
                print(f"   Docker will create it, but it may have incorrect permissions")
        else:
            # Ensure existing directory has correct permissions (Unix/Linux only)
            if OS_NAME != "Windows":
                try:
                    current_stat = os.stat(workflow_logs_dir)
                    current_uid = current_stat.st_uid
                    current_user_uid = os.getuid()
                    if current_uid != current_user_uid and current_uid == 0:  # Owned by root
                        print(f"{C_YELLOW}⚠️  workflow_logs directory is owned by root, fixing permissions...{C_RESET}")
                        os.chown(workflow_logs_dir, current_user_uid, os.getgid())
                        print(f"{C_GREEN}✅ Fixed workflow_logs directory ownership{C_RESET}")
                except (OSError, PermissionError, AttributeError) as e:
                    # If we don't have permission or chown is not available, warn user
                    print(f"{C_YELLOW}⚠️  Warning: Could not fix workflow_logs permissions: {e}{C_RESET}")
                    print(f"   You may need to run: sudo chown -R $USER:$USER {workflow_logs_dir}")

        # Start Docker Control Service BEFORE starting Docker containers
        # This ensures the backend can connect to it when it starts
        if not args.skip_docker_control:
            print(f"\n{C_BLUE}{'='*60}{C_RESET}")
            print(f"{C_BLUE}Step 7: Starting Docker Control Service{C_RESET}")
            print(f"{C_BLUE}{'='*60}{C_RESET}")

            if not start_docker_control_service(no_sudo=args.no_sudo):
                print(f"{C_RED}⛔ Failed to start Docker Control Service. Continuing without it.{C_RESET}")
                print(f"{C_YELLOW}Note: Backend will not be able to manage Docker containers.{C_RESET}")
        else:
            print(f"\n{C_YELLOW}⚠️  Skipping Docker Control Service setup (--skip-docker-control flag used){C_RESET}")

        # Start Docker services
        print(f"\n{C_BOLD}{C_BLUE}🚀 Starting Docker services...{C_RESET}")

        # Check Docker access to determine if sudo is needed
        has_docker_access = check_docker_access()
        if not has_docker_access:
            print(f"{C_YELLOW}⚠️  Using sudo for docker-compose (you may be prompted for password)...{C_RESET}")

        # Set up the Docker Compose command
        docker_compose_cmd = build_docker_compose_command(dev_mode=args.dev)

        # Add the up command and flags
        docker_compose_cmd.extend(["up", "--build", "-d"])

        # Run the Docker Compose command with sudo if needed
        if has_docker_access:
            run_command(docker_compose_cmd, cwd=os.path.join(TT_STUDIO_ROOT, "app"))
        else:
            # Need sudo for docker-compose
            sudo_cmd = ["sudo"] + docker_compose_cmd
            subprocess.run(sudo_cmd, cwd=os.path.join(TT_STUDIO_ROOT, "app"), check=True)
        
        # Check if AI Playground mode is enabled
        is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))
        
        # Setup TT Inference Server FastAPI (unless skipped or AI Playground mode is enabled)
        if not args.skip_fastapi and not is_deployed_mode:
            print(f"\n{C_TT_PURPLE}{C_BOLD}🔧 Setting up TT Inference Server FastAPI (Local Mode){C_RESET}")
            print(f"{C_CYAN}   Note: FastAPI server is only needed for local model inference{C_RESET}")
            
            # Store original directory to return to later
            original_dir = os.getcwd()
            
            # Note: sudo is no longer required by default for FastAPI (port 8001 is non-privileged)
            # The --no-sudo flag is kept for backward compatibility
            try:
                # Setup TT Inference Server
                if not setup_tt_inference_server():
                    print(f"{C_RED}⛔ Failed to setup TT Inference Server. Continuing without FastAPI server.{C_RESET}")
                else:
                    # Setup FastAPI environment
                    if not setup_fastapi_environment():
                        print(f"{C_RED}⛔ Failed to setup FastAPI environment. Continuing without FastAPI server.{C_RESET}")
                    else:
                        # Start FastAPI server
                        if not start_fastapi_server(no_sudo=args.no_sudo):
                            print(f"{C_RED}⛔ Failed to start FastAPI server. Continuing without FastAPI server.{C_RESET}")
            finally:
                # Return to original directory
                os.chdir(original_dir)
        elif args.skip_fastapi:
            print(f"\n{C_YELLOW}⚠️  Skipping TT Inference Server FastAPI setup (--skip-fastapi flag used){C_RESET}")
        elif is_deployed_mode:
            print(f"\n{C_GREEN}✅ Skipping TT Inference Server FastAPI setup (AI Playground mode enabled){C_RESET}")
            print(f"{C_CYAN}   Note: AI Playground mode uses cloud models, so local FastAPI server is not needed{C_RESET}")

        print(f"\n{C_GREEN}✔ Setup Complete!{C_RESET}")
        print()
        
        # Simple, clean output without complex formatting
        print("=" * 60)
        print("🚀 Tenstorrent TT Studio is ready!")
        print("=" * 60)
        print(f"Access it at: {C_CYAN}http://localhost:3000{C_RESET}")
        
        if not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_PID_FILE):
            print(f"FastAPI server: {C_CYAN}http://localhost:8001{C_RESET}")
            print(f"Health check: curl http://localhost:8001/")

        if not args.skip_docker_control and os.path.exists(DOCKER_CONTROL_PID_FILE):
            print(f"Docker Control Service: {C_CYAN}http://localhost:8002{C_RESET}")
            print(f"API docs: http://localhost:8002/api/v1/docs")

        if OS_NAME == "Darwin":
            print("(Cmd+Click the link to open in browser)")
        else:
            print("(Ctrl+Click the link to open in browser)")
        
        print("=" * 60)
        print()
        
        # Display info about special modes if they are enabled
        active_modes = []
        if args.dev:
            active_modes.append("💻 Development Mode: ENABLED")
        if detect_tt_hardware():
            active_modes.append("🔧 Tenstorrent Device: MOUNTED")
        if is_deployed_mode:
            active_modes.append("☁️ AI Playground Mode: ENABLED")
        
        if active_modes:
            print(f"{C_YELLOW}Active Modes:{C_RESET}")
            for mode in active_modes:
                print(f"  {mode}")
            print()
        
        print(f"{C_YELLOW}🧹 To stop all services, run:{C_RESET}")
        print(f"  {C_MAGENTA}python run.py --cleanup{C_RESET}")
        print()
        print()
        
        # Display final summary
        is_rag_admin_enabled = parse_boolean_env(get_env_var("VITE_ENABLE_RAG_ADMIN"))
        
        print(f"{C_BOLD}📋 Configuration Summary:{C_RESET}")
        if is_deployed_mode:
            print(f"  • {C_GREEN}☁️ AI Playground Mode: ✅ ENABLED{C_RESET}")
            print(f"    {C_CYAN}   → Using cloud models for inference{C_RESET}")
        else:
            print(f"  • {C_YELLOW}🏠 Local Mode: ✅ ENABLED{C_RESET}")
            print(f"    {C_CYAN}   → Using local FastAPI server for inference{C_RESET}")
        print(f"  • RAG Admin Interface: {'✅ Enabled' if is_rag_admin_enabled else '❌ Disabled'}")
        print(f"  • Persistent Storage: {host_persistent_volume}")
        print(f"  • Development Mode: {'✅ Enabled' if args.dev else '❌ Disabled'}")
        print(f"  • TT Hardware Support: {'✅ Enabled' if detect_tt_hardware() else '❌ Disabled'}")
        print(f"  • FastAPI Server: {'✅ Enabled' if not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_PID_FILE) else '❌ Disabled'}")
        
        if is_deployed_mode:
            print(f"\n{C_BLUE}🌐 Your TT Studio is running in AI Playground mode with cloud model integrations.{C_RESET}")
            print(f"{C_CYAN}   You can access cloud models through the AI Playground interface.{C_RESET}")
        else:
            print(f"\n{C_BLUE}🏠 Your TT Studio is running in Local Mode with local model inference.{C_RESET}")
            print(f"{C_CYAN}   You can deploy and manage local models through the interface.{C_RESET}")
        
        # Wait for services if requested
        if args.wait_for_services:
            wait_for_all_services(skip_fastapi=args.skip_fastapi, is_deployed_mode=is_deployed_mode)
        
        
        # Control browser open only if service is healthy
        if not args.no_browser:
            # Get configurable frontend settings
            host, port, timeout = get_frontend_config()
            
            # Use the new function that reuses existing infrastructure
            if not wait_for_frontend_and_open_browser(host, port, timeout, args.auto_deploy):
                auto_deploy_param = f"?auto-deploy={args.auto_deploy}" if args.auto_deploy else ""
                print(f"{C_YELLOW}⚠️  Browser opening failed. Please manually navigate to http://{host}:{port}{auto_deploy_param}{C_RESET}")
        else:
            host, port, _ = get_frontend_config()
            auto_deploy_param = f"?auto-deploy={args.auto_deploy}" if args.auto_deploy else ""
            print(f"{C_BLUE}🌐 Automatic browser opening disabled. Access TT-Studio at: {C_CYAN}http://{host}:{port}{auto_deploy_param}{C_RESET}")
        
        # If in dev mode, show logs similar to startup.sh
        if args.dev:
            print(f"\n{C_YELLOW}📜 Tailing logs in development mode. Press Ctrl+C to stop.{C_RESET}")
            
            # Build the same Docker Compose command for logs
            docker_logs_cmd = build_docker_compose_command(dev_mode=args.dev)
            docker_logs_cmd.extend(["logs", "-f"])
            
            # Start Docker Compose logs in background
            docker_logs_process = subprocess.Popen(
                docker_logs_cmd,
                cwd=os.path.join(TT_STUDIO_ROOT, "app")
            )
            
            # Also check for FastAPI server logs
            fastapi_logs_process = None
            if not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_LOG_FILE):
                fastapi_logs_process = subprocess.Popen(["tail", "-f", FASTAPI_LOG_FILE])
            
            try:
                # Wait for Ctrl+C
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}📜 Stopping log tailing...{C_RESET}")
            finally:
                # Clean up processes
                if docker_logs_process:
                    docker_logs_process.terminate()
                if fastapi_logs_process:
                    fastapi_logs_process.terminate()

    except KeyboardInterrupt:
        print(f"\n\n{C_YELLOW}🛑 Setup interrupted by user (Ctrl+C){C_RESET}")
        
        # Build the original command with flags for resume suggestion
        original_cmd = "python run.py"
        if 'args' in locals():
            if args.dev:
                original_cmd += " --dev"
            if args.skip_fastapi:
                original_cmd += " --skip-fastapi"
            if args.no_sudo:
                original_cmd += " --no-sudo"
        
        print(f"{C_CYAN}🔄 To resume setup later, run: {C_WHITE}{original_cmd}{C_RESET}")
        print(f"{C_CYAN}🧹 To clean up any partial setup: {C_WHITE}python run.py --cleanup{C_RESET}")
        print(f"{C_CYAN}❓ For help: {C_WHITE}python run.py --help{C_RESET}")
        sys.exit(0)
    except Exception as e:
        print(f"\n{C_RED}❌ An unexpected error occurred: {e}{C_RESET}")
        print(f"{C_CYAN}💡 For help: {C_WHITE}python run.py --help{C_RESET}")
        print(f"{C_CYAN}💡 To clean up: {C_WHITE}python run.py --cleanup{C_RESET}")
        sys.exit(1)

if __name__ == "__main__":
    main()
