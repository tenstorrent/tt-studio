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
INFERENCE_SERVER_BRANCH = "anirud/fast-api-container-fetching-fixes"
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
    """Function to check Docker installation."""
    if not shutil.which("docker"):
        print(f"{C_RED}⛔ Error: Docker is not installed.{C_RESET}")
        sys.exit(1)
    try:
        # Check if docker compose is available and working
        subprocess.run(["docker", "compose", "version"], check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print(f"{C_RED}⛔ Error: Docker Compose is not installed or not working correctly.{C_RESET}")
        sys.exit(1)

def is_placeholder(value):
    """Check for common placeholder or empty values."""
    if not value or str(value).strip() == "":
        return True
    
    placeholder_patterns = [
        'django-insecure-default', 'tvly-xxx', 'hf_***',
        'tt-studio-rag-admin-password', 'cloud llama chat ui url',
        'cloud llama chat ui auth token', 'test-456',
        '<PATH_TO_ROOT_OF_REPO>', 'true or flase to enable deployed mode',
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

def ask_overwrite_preference(existing_vars):
    """
    Ask user if they want to overwrite existing environment variables.
    Returns True if user wants to overwrite, False otherwise.
    """
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
    print(f"  {C_GREEN}{C_BOLD}Option 1 - Keep Existing Configuration{C_RESET}")
    print(f"    • Keep all current values as they are")
    print(f"    • Only configure any missing or placeholder values")
    print(f"    • Recommended for normal startup")
    print()
    print(f"  {C_ORANGE}{C_BOLD}Option 2 - Reconfigure Everything{C_RESET}")
    print(f"    • Go through setup prompts for ALL variables")
    print(f"    • Replace existing values with new ones")
    print(f"    • Use this if you want to change your configuration")
    print()
    
    # Add another visual separator before input
    print("=" * 80)
    
    while True:
        print(f"{C_WHITE}{C_BOLD}Choose an option:{C_RESET}")
        print(f"  {C_GREEN}k{C_RESET} - Keep existing configuration (recommended)")
        print(f"  {C_ORANGE}r{C_RESET} - Reconfigure everything")
        print()
        try:
            choice = input(f"Enter your choice (k/r): ").lower().strip()
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
        
        if choice in ['k', 'keep']:
            print(f"\n{C_GREEN}✅ Keeping existing configuration. Only missing values will be configured.{C_RESET}")
            # Show which placeholder values will still need to be configured
            placeholder_vars = {k: v for k, v in existing_vars.items() if is_placeholder(v)}
            if placeholder_vars:
                print(f"{C_CYAN}📝 Note: Placeholder values will still be prompted for configuration:{C_RESET}")
                for var_name in placeholder_vars.keys():
                    print(f"    • {var_name}")
                print()
            return False
        elif choice in ['r', 'reconfigure', 'reconfig']:
            print(f"\n{C_ORANGE}🔄 Will reconfigure all environment variables.{C_RESET}")
            return True
        else:
            print(f"{C_RED}❌ Please enter 'k' to keep existing config or 'r' to reconfigure everything.{C_RESET}")
            print()

def configure_environment_sequentially(dev_mode=False):
    """
    Handles all environment configuration in a sequential, top-to-bottom flow.
    Reads existing .env file and prompts for missing or placeholder values.
    
    Args:
        dev_mode (bool): If True, show dev mode banner but still prompt for all values
    """
    global FORCE_OVERWRITE
    
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
    
    if dev_mode:
        print(f"{C_YELLOW}Development Mode: You can use suggested defaults for quick setup{C_RESET}")
        print(f"{C_CYAN}   Note: Development defaults are NOT secure for production use{C_RESET}")
    else:
        print(f"{C_CYAN}Production Mode: You'll be prompted for secure, production-ready values{C_RESET}")
    
    # Get existing variables
    existing_vars = get_existing_env_vars()
    
    # Only ask about overwrite preference if .env file existed before
    if env_file_exists and existing_vars:
        FORCE_OVERWRITE = ask_overwrite_preference(existing_vars)
    else:
        # No need to ask, we're configuring everything
        if not env_file_exists:
            print(f"\n{C_CYAN}📝 Setting up TT Studio for the first time...{C_RESET}")
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
    if should_configure_var("JWT_SECRET", current_jwt):
        if is_placeholder(current_jwt):
            print(f"🔄 JWT_SECRET has placeholder value '{current_jwt}' - configuring...")
        dev_default = "dev-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter JWT_SECRET (for authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
        
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
    if should_configure_var("DJANGO_SECRET_KEY", current_django):
        if is_placeholder(current_django):
            print(f"🔄 DJANGO_SECRET_KEY has placeholder value '{current_django}' - configuring...")
        dev_default = "django-dev-secret-key-not-for-production-12345" if dev_mode else ""
        prompt_text = f"🔑 Enter DJANGO_SECRET_KEY (for Django security){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
        
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
    if should_configure_var("TAVILY_API_KEY", current_tavily):
        prompt_text = "🔍 Enter TAVILY_API_KEY (for search, optional - press Enter to skip): "
        val = getpass.getpass(prompt_text)
        write_env_var("TAVILY_API_KEY", val or "")
        print("✅ TAVILY_API_KEY saved.")
    else:
        print(f"✅ TAVILY_API_KEY already configured (keeping existing value).")
        
    # HF_TOKEN
    current_hf = get_env_var("HF_TOKEN")
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

    print(f"\n{C_TT_PURPLE}{C_BOLD}--- ⚙️  Application Configuration  ---{C_RESET}")

    # VITE_APP_TITLE
    current_title = get_env_var("VITE_APP_TITLE")
    if should_configure_var("VITE_APP_TITLE", current_title):
        dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
        val = input(f"📝 Enter application title (default: {dev_default}): ") or dev_default
        write_env_var("VITE_APP_TITLE", val)
        print("✅ VITE_APP_TITLE saved.")
    else:
        print(f"✅ VITE_APP_TITLE already configured: {current_title}")

    print(f"\n{C_CYAN}{C_BOLD}------------------ Mode Selection ------------------{C_RESET}")
    
    # VITE_ENABLE_DEPLOYED
    current_deployed = get_env_var("VITE_ENABLE_DEPLOYED")
    if should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
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
    if should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
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

    # RAG_ADMIN_PASSWORD (only if RAG is enabled)
    if is_rag_admin_enabled:
        current_rag_pass = get_env_var("RAG_ADMIN_PASSWORD")
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

    # Cloud/External model configuration (only if deployed mode is enabled)
    if is_deployed_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- ☁️  AI Playground Model Configuration  ---{C_RESET}")
        print(f"{C_YELLOW}Note: These are optional. Press Enter to skip any field.{C_RESET}")
        
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
    
    # Build Docker Compose command for cleanup (use same logic as startup)
    docker_compose_cmd = build_docker_compose_command(dev_mode=args.dev, show_hardware_info=False)
    docker_compose_cmd.extend(["down", "-v"])
    
    # Stop and remove containers
    try:
        print(f"{C_BLUE}🛑 Stopping Docker containers...{C_RESET}")
        run_command(docker_compose_cmd, cwd=os.path.join(TT_STUDIO_ROOT, "app"))
        print(f"{C_GREEN}✅ Docker containers stopped successfully.{C_RESET}")
    except:
        print(f"{C_YELLOW}⚠️  No running containers to stop.{C_RESET}")
    
    # Remove network if it exists
    try:
        print(f"{C_BLUE}🌐 Removing Docker network...{C_RESET}")
        run_command(["docker", "network", "rm", "tt_studio_network"])
        print(f"{C_GREEN}✅ Removed network 'tt_studio_network'.{C_RESET}")
    except:
        print(f"{C_YELLOW}⚠️  Network 'tt_studio_network' doesn't exist or couldn't be removed.{C_RESET}")
    
    # Clean up FastAPI server
    print(f"{C_BLUE}🔧 Cleaning up FastAPI server...{C_RESET}")
    cleanup_fastapi_server(no_sudo=args.no_sudo)
    
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
    
    try:
        # Always update submodules to ensure they're properly initialized and on correct branches
        print(f"📦 Initializing and updating git submodules...")
        run_command(["git", "submodule", "update", "--init", "--recursive"], check=True)
        
        # Additional step: ensure submodules are on the correct branch as specified in .gitmodules
        print(f"🌿 Ensuring submodules are on correct branches...")
        run_command(["git", "submodule", "foreach", "--recursive", "git checkout $(git config -f $toplevel/.gitmodules submodule.$name.branch || echo main)"], check=True)
        
        print(f"✅ Successfully initialized and updated git submodules")
        return True
        
    except (subprocess.CalledProcessError, SystemExit) as e:
        print(f"{C_RED}⛔ Error: Failed to initialize submodules: {e}{C_RESET}")
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
    
    # Create PID and log files with proper permissions (similar to startup.sh)
    print(f"🔧 Setting up log and PID files...")
    for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
        try:
            # Try to create with sudo first (like startup.sh) unless no_sudo is specified
            if not no_sudo:
                subprocess.run(["sudo", "touch", file_path], check=False)
                subprocess.run(["sudo", "chown", f"{os.getenv('USER', 'root')}", file_path], check=False)
                subprocess.run(["sudo", "chmod", "644", file_path], check=False)
            else:
                # Fallback to regular file creation
                with open(file_path, 'w') as f:
                    pass
                os.chmod(file_path, 0o644)
        except Exception as e:
            # Fallback to regular file creation
            try:
                with open(file_path, 'w') as f:
                    pass
                os.chmod(file_path, 0o644)
            except Exception as e2:
                print(f"{C_YELLOW}Warning: Could not create {file_path}: {e2}{C_RESET}")
    
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
        
        # Start the server using the wrapper script with environment variables (exactly like startup.sh)
        if not no_sudo:
            # Use sudo with environment variables exactly like startup.sh
            # The key difference: pass environment variables as separate arguments to sudo
            cmd = ["sudo", f"JWT_SECRET={jwt_secret}", f"HF_TOKEN={hf_token}", temp_script_path, 
                   INFERENCE_SERVER_DIR, FASTAPI_PID_FILE, ".venv", FASTAPI_LOG_FILE]
            process = subprocess.Popen(cmd)
        else:
            # Fallback to running without sudo
            env = os.environ.copy()
            if jwt_secret:
                env["JWT_SECRET"] = jwt_secret
            if hf_token:
                env["HF_TOKEN"] = hf_token
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
    
    # Kill process if PID file exists
    if os.path.exists(FASTAPI_PID_FILE):
        try:
            with open(FASTAPI_PID_FILE, 'r') as f:
                pid = f.read().strip()
            if pid and pid.isdigit():
                try:
                    os.kill(int(pid), signal.SIGTERM)
                    time.sleep(2)
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass  # Process already terminated
                except PermissionError:
                    if not no_sudo:
                        # Try with sudo
                        subprocess.run(["sudo", "kill", "-15", pid], check=False)
                        time.sleep(2)
                        subprocess.run(["sudo", "kill", "-9", pid], check=False)
                    else:
                        print(f"{C_YELLOW}Warning: Could not kill process {pid} without sudo{C_RESET}")
        except Exception as e:
            print(f"{C_YELLOW}Warning: Could not kill FastAPI process: {e}{C_RESET}")
    
    # Kill any process on port 8001
    kill_process_on_port(8001, no_sudo=no_sudo)
    
    # Remove PID and log files
    for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as e:
            print(f"{C_YELLOW}Warning: Could not remove {file_path}: {e}{C_RESET}")
    
    print(f"✅ FastAPI server cleanup completed")

def request_sudo_authentication():
    """Request sudo authentication upfront and cache it for later use."""
    # Check if sudo is available
    if not shutil.which("sudo"):
        print(f"{C_RED}⛔ Error: sudo is not available on this system.{C_RESET}")
        return False
    
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

def ensure_frontend_dependencies():
    """
    Ensures frontend dependencies are available locally for IDE support.
    This is optional for running the app, as dependencies are always installed
    inside the Docker container, but it greatly improves the development experience
    (e.g., for TypeScript autocompletion).
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
            choice = input(f"Do you want to run 'npm install' locally? (Y/n): ").lower().strip()
            if choice in ['n', 'no']:
                print(f"{C_YELLOW}Skipping local dependency installation. IDE features may be limited.{C_RESET}")
                return True # It's not a failure, just a choice.
            
            print(f"\n{C_BLUE}📦 Installing dependencies locally with npm...{C_RESET}")
            run_command(["npm", "install"], check=True, cwd=frontend_dir)
            print(f"{C_GREEN}✅ Frontend dependencies installed successfully.{C_RESET}")

        else: # No local npm found
            print(f"\n{C_YELLOW}⚠️ 'npm' command not found on your local machine.{C_RESET}")
            choice = input(f"Do you want to install dependencies using Docker? (Y/n): ").lower().strip()
            if choice in ['n', 'no']:
                print(f"{C_YELLOW}Skipping local dependency installation. IDE features may be limited.{C_RESET}")
                return True

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

    except (subprocess.CalledProcessError, SystemExit) as e:
        print(f"{C_RED}⛔ Error installing frontend dependencies: {e}{C_RESET}")
        print(f"{C_YELLOW}   Could not install dependencies locally. IDE features may be limited, but the app will still run.{C_RESET}")
        return True # Still return True, as this is not a fatal error for the application itself.
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}🛑 Installation cancelled by user.{C_RESET}")
        return True

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
  {C_CYAN}python run.py --dev{C_RESET}             🛠️  Development mode with suggested defaults
  {C_CYAN}python run.py --cleanup{C_RESET}         🧹 Clean up containers and networks only
  {C_CYAN}python run.py --cleanup-all{C_RESET}     🗑️  Complete cleanup including data and config
  {C_CYAN}python run.py --skip-fastapi{C_RESET}    ⏭️  Skip FastAPI server setup (auto-skipped in AI Playground mode)
  {C_CYAN}python run.py --no-browser{C_RESET}      🚫 Skip automatic browser opening
  {C_CYAN}python run.py --wait-for-services{C_RESET} ⏳ Wait for all services to be healthy before completing
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
        parser.add_argument("--skip-fastapi", action="store_true", 
                           help="⏭️  Skip TT Inference Server FastAPI setup (auto-skipped in AI Playground mode)")
        parser.add_argument("--no-sudo", action="store_true", 
                           help="🚫 Skip sudo usage for FastAPI setup (may limit functionality)")
        parser.add_argument("--no-browser", action="store_true", 
                           help="🚫 Skip automatic browser opening")
        parser.add_argument("--wait-for-services", action="store_true", 
                           help="⏳ Wait for all services to be healthy before completing")
        parser.add_argument("--browser-timeout", type=int, default=60,
                   help="⏳ Timeout in seconds for waiting for frontend before opening browser")
        parser.add_argument("--auto-deploy", type=str, metavar="MODEL_NAME",
                   help="🤖 Automatically deploy the specified model after startup (e.g., 'Llama-3.2-1B-Instruct')")
        
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
  {C_CYAN}python run.py --dev{C_RESET}                  Development mode with defaults
  {C_CYAN}python run.py --cleanup{C_RESET}              Clean up containers only
  {C_CYAN}python run.py --cleanup-all{C_RESET}          Complete cleanup (data + config)
  {C_CYAN}python run.py --skip-fastapi{C_RESET}         Skip FastAPI server setup
  {C_CYAN}python run.py --no-sudo{C_RESET}              Skip sudo usage (may limit functionality)

{'=' * 80}
{C_WHITE}For more information, visit: {C_CYAN}https://github.com/tenstorrent/tt-studio{C_RESET}
        """)
            return
        
        if args.cleanup or args.cleanup_all:
            cleanup_resources(args)
            return
        
        display_welcome_banner()
        check_docker_installation()
        configure_environment_sequentially(dev_mode=args.dev)

        # Create persistent storage directory
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        if host_persistent_volume and not os.path.isdir(host_persistent_volume):
            print(f"\n{C_BLUE}📁 Creating persistent storage directory at: {host_persistent_volume}{C_RESET}")
            os.makedirs(host_persistent_volume, exist_ok=True)

        # Create Docker network
        print(f"\n{C_BLUE}Checking for Docker network 'tt_studio_network'...{C_RESET}")
        result = subprocess.run(["docker", "network", "ls"], capture_output=True, text=True)
        if "tt_studio_network" not in result.stdout:
            run_command(["docker", "network", "create", "tt_studio_network"])
            print(f"{C_GREEN}Network 'tt_studio_network' created.{C_RESET}")
        else:
            print(f"{C_GREEN}Network 'tt_studio_network' already exists.{C_RESET}")

        # Ensure frontend dependencies are installed
        ensure_frontend_dependencies()

        # Start Docker services
        print(f"\n{C_BOLD}{C_BLUE}🚀 Starting Docker services...{C_RESET}")
        
        # Set up the Docker Compose command
        docker_compose_cmd = build_docker_compose_command(dev_mode=args.dev)
        
        # Add the up command and flags
        docker_compose_cmd.extend(["up", "--build", "-d"])
        
        # Run the Docker Compose command
        run_command(docker_compose_cmd, cwd=os.path.join(TT_STUDIO_ROOT, "app"))
        
        # Check if AI Playground mode is enabled
        is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))
        
        # Setup TT Inference Server FastAPI (unless skipped or AI Playground mode is enabled)
        if not args.skip_fastapi and not is_deployed_mode:
            print(f"\n{C_TT_PURPLE}{C_BOLD}🔧 Setting up TT Inference Server FastAPI (Local Mode){C_RESET}")
            print(f"{C_CYAN}   Note: FastAPI server is only needed for local model inference{C_RESET}")
            
            # Store original directory to return to later
            original_dir = os.getcwd()
            
            # Request sudo authentication upfront (unless --no-sudo is specified)
            if not args.no_sudo:
                if not request_sudo_authentication():
                    print(f"{C_RED}⛔ Cannot proceed without sudo access. Use --no-sudo to skip sudo usage.{C_RESET}")
                    return
            else:
                print(f"{C_YELLOW}⚠️  Skipping sudo authentication (--no-sudo flag used){C_RESET}")
                print(f"{C_YELLOW}   Note: Some operations may fail if elevated privileges are required{C_RESET}")
            
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
