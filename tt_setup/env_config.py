# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Environment-variable, preference, and interactive configuration management."""

import os
import sys
import shutil
import re
import getpass
import json
import subprocess
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False
from dotenv import set_key, dotenv_values
from tt_setup.constants import *


def configure_inference_server_artifact(*args, **kwargs):
    # Lazy import to break the env_config <-> inference_server import cycle.
    from tt_setup.inference_server import configure_inference_server_artifact as _impl
    return _impl(*args, **kwargs)


FORCE_OVERWRITE = False


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


def write_env_var(var_name, var_value, quote_value=None):
    """
    Update or add a variable in app/.env using ONE consistent format.

    Uses python-dotenv (the standard .env library) and writes values unquoted
    (quote_mode="never"), so the file never mixes `KEY="value"` and `KEY=value`
    styles. This matches app/.env.default and avoids docker-compose treating
    surrounding quotes as literal characters. `quote_value` is accepted for
    backwards compatibility but intentionally ignored.
    """
    if not os.path.exists(ENV_FILE_PATH):
        open(ENV_FILE_PATH, 'w').close()
    value = "" if var_value is None else str(var_value)
    set_key(ENV_FILE_PATH, var_name, value, quote_mode="never")


def comment_out_env_var(var_name):
    """Comment out an environment variable in the .env file (VAR=val → # VAR=val)."""
    if not os.path.exists(ENV_FILE_PATH):
        return
    with open(ENV_FILE_PATH, 'r') as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if re.match(f"^{re.escape(var_name)}=", line):
            lines[i] = f"# {line}"
            break
    with open(ENV_FILE_PATH, 'w') as f:
        f.writelines(lines)


def get_env_var(var_name, default=""):
    """Safely get a variable from app/.env (quotes handled by python-dotenv)."""
    if not os.path.exists(ENV_FILE_PATH):
        return default
    value = dotenv_values(ENV_FILE_PATH, interpolate=False).get(var_name)
    return default if value is None else value


def parse_boolean_env(raw_value):
    """Parse boolean values from .env file"""
    return str(raw_value).lower().strip().strip('"\'') in ['true', '1', 't', 'y', 'yes']


def get_existing_env_vars():
    """Read all existing environment variables from app/.env (via python-dotenv)."""
    if not os.path.exists(ENV_FILE_PATH):
        return {}
    return {
        key: value
        for key, value in dotenv_values(ENV_FILE_PATH, interpolate=False).items()
        if value is not None
    }


def set_app_version_env():
    """
    Compute the running build's version from git and persist it to app/.env so
    docker compose can inject it into the frontend as VITE_APP_VERSION /
    VITE_APP_GIT_BRANCH.

    Releases are plain git tags (e.g. v2.6.0) with no package.json bump, so git is
    the source of truth for "what build is this":
      - If HEAD sits exactly on a release tag, that tag is the official version and
        VITE_APP_VERSION is set to it.
      - Otherwise this is an unofficial build; VITE_APP_VERSION is cleared and the
        frontend falls back to showing the branch name (VITE_APP_GIT_BRANCH).
    """
    def _git(git_args):
        try:
            result = subprocess.run(
                ["git", "-C", TT_STUDIO_ROOT] + git_args,
                capture_output=True, text=True, check=False,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return ""

    # An exact tag match on the current commit => official release build.
    version = _git(["describe", "--tags", "--exact-match"])
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"])
    if branch == "HEAD":
        # Detached checkout (e.g. CI / `git checkout <tag>`): use short sha as label.
        branch = _git(["rev-parse", "--short", "HEAD"])

    write_env_var("VITE_APP_VERSION", version)
    write_env_var("VITE_APP_GIT_BRANCH", branch)

    if version:
        print(f"{C_GREEN}✅ Build version: {version} (official release){C_RESET}")
    elif branch:
        print(f"{C_CYAN}ℹ️  Build version: {branch} branch (unofficial build){C_RESET}")


def save_setup_config(config_dict):
    """Save the quick-setup configuration snapshot to JSON file"""
    try:
        with open(SETUP_CONFIG_FILE_PATH, 'w') as f:
            json.dump(config_dict, f, indent=2)
        # Silent — no need to show config file path to user
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Warning: Could not save setup configuration: {e}{C_RESET}")


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
    print(f"{C_CYAN}Welcome to TT Studio!{C_RESET}")
    print()
    terms_url = "https://docs.tenstorrent.com/os-model-terms.html"
    terms_link = f"\033]8;;{terms_url}\033\\{C_BLUE}\033[4mOS Model Terms{C_RESET}\033]8;;\033\\"
    print(f"{C_BOLD}📄 Terms & Conditions{C_RESET}")
    print(f"By proceeding, you agree to our {terms_link}")
    print(f"  {C_WHITE}↳ {terms_url}{C_RESET}")
    print()
    print(f"{C_BOLD}TL;DR:{C_RESET}")
    print(f"  • {C_GREEN}AS-IS:{C_RESET} These models are for demonstration; we don't guarantee their output.")
    print(f"  • {C_GREEN}Liability:{C_RESET} Tenstorrent isn't responsible for damages or AI-generated content.")
    print(f"  • {C_GREEN}Compliance:{C_RESET} You agree to follow the original creators' licenses.")
    print()

    # Terms acceptance confirmation
    while True:
        response = input(f"{C_CYAN}Do you agree to these terms? [yes/no]: {C_RESET}").strip().lower()
        if response in ['n', 'no', '']:
            print(f"{C_RED}Terms not accepted. Exiting TT-Studio.{C_RESET}")
            sys.exit(0)
        elif response in ['y', 'yes']:
            print(f"{C_GREEN}Terms accepted. Continuing with setup...{C_RESET}")
            save_preference("terms_accepted", True)
            break
        else:
            print(f"{C_YELLOW}Please enter 'yes' (or 'y') or 'no' (or 'n').{C_RESET}")

    print()
    print(f"{C_TT_PURPLE}{C_BOLD}-----------------------------------------------------{C_RESET}")
    print()
    print(f"{C_GREEN}ℹ️  What to expect:{C_RESET}")
    print(f"  • We'll guide you through the initial setup")
    print(f"  • Your responses will be saved for future runs")
    print(f"  • Subsequent runs will be much faster and non-interactive")
    print(f"  • You can reset your preferences anytime with {C_WHITE}--reconfigure{C_RESET}")
    print()
    print(f"{C_YELLOW}Note: You won't be asked these questions again unless you explicitly reset your preference(s) and .env file.{C_RESET}")
    print()
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
                if args.resync:
                    original_cmd += " --resync"
            
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


def _hf_check_repo(token, repo_id):
    """Return HTTP status code for a HuggingFace repo config.json. Returns None on network error."""
    url = f"https://huggingface.co/{repo_id}/resolve/main/config.json"
    headers = {"User-Agent": "tt-studio"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        if HAS_REQUESTS:
            return requests.get(url, headers=headers, timeout=10, allow_redirects=True).status_code
        else:
            req = urllib.request.Request(url, headers=headers)
            try:
                urllib.request.urlopen(req, timeout=10)
                return 200
            except urllib.error.HTTPError as e:
                return e.code
    except Exception:
        return None


def check_hf_access(token):
    """Check if HF token can access meta-llama and Qwen repos. Returns (ok, message)."""
    repos = [
        ("meta-llama/Llama-3.1-8B-Instruct", "Llama 3.1"),
        ("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3"),
        ("Qwen/Qwen3-32B", "Qwen3-32B"),
    ]
    results = []
    for repo_id, label in repos:
        code = _hf_check_repo(token, repo_id)
        results.append((label, repo_id, code))

    if all(c is None for _, _, c in results):
        return (None, "⚠️  Could not reach HuggingFace — skipping access check.")

    lines = []
    any_ok = False
    any_denied = False
    invalid = False
    for label, repo_id, code in results:
        if code is None:
            lines.append(f"   ⚠️  {label}: could not reach HuggingFace")
        elif code == 200:
            lines.append(f"   ✅ {label}: access confirmed")
            any_ok = True
        elif code == 401:
            lines.append(f"   ✖  {label}: token invalid or expired (401)")
            invalid = True
        elif code == 403:
            lines.append(f"   ✖  {label}: access not granted yet (403) — https://huggingface.co/{repo_id}")
            any_denied = True
        else:
            lines.append(f"   ⚠️  {label}: unexpected HTTP {code}")

    summary = "\n".join(lines)
    if invalid:
        return (False, f"HF token access check:\n{summary}")
    elif any_denied:
        return (False, f"HF token access check:\n{summary}")
    elif any_ok:
        return (True, f"HF token access check:\n{summary}")
    else:
        return (None, f"HF token access check:\n{summary}")


def configure_environment_sequentially(dev_mode=False, force_reconfigure=False, quick_setup=True, reconfigure_inference=False):
    """
    Handles all environment configuration in a sequential, top-to-bottom flow.
    Reads existing .env file and prompts for missing or placeholder values.

    Args:
        dev_mode (bool): If True, show dev mode banner but still prompt for all values
        force_reconfigure (bool): If True, force reconfiguration and clear preferences
        quick_setup (bool): If True, use minimal prompts and defaults for quick setup
        reconfigure_inference (bool): If True, force reconfiguration of inference server artifact only
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

    if not quick_setup:
        print(f"\n{C_TT_PURPLE}{C_BOLD}TT Studio Environment Configuration{C_RESET}")
        print(f"{C_GREEN}⚙️  Configure Env Mode: Full interactive setup for all variables{C_RESET}")
        if dev_mode:
            print(f"{C_YELLOW}   Development Mode: suggested defaults shown (NOT secure for production){C_RESET}")
        else:
            print(f"{C_CYAN}   Production Mode: prompting for secure, production-ready values{C_RESET}")
    
    # Get existing variables
    existing_vars = get_existing_env_vars()
    
    # Only ask about overwrite preference if .env file existed before (skip for quick setup)
    if not quick_setup and env_file_exists and existing_vars:
        FORCE_OVERWRITE = ask_overwrite_preference(existing_vars, force_prompt=force_reconfigure)
    else:
        # No need to ask, we're configuring everything
        if not env_file_exists:
            if not quick_setup:
                print(f"\n{C_CYAN}📝 Setting up TT Studio for the first time...{C_RESET}")
            FORCE_OVERWRITE = True
        elif quick_setup:
            # In quick setup with existing .env, don't force overwrite - let individual checks handle it
            if env_file_exists and existing_vars:
                FORCE_OVERWRITE = False
            else:
                FORCE_OVERWRITE = True
        else:
            print(f"\n{C_CYAN}📝 No existing configuration found. Will configure all environment variables.{C_RESET}")
            FORCE_OVERWRITE = True

    if not quick_setup:
        print(f"\n{C_CYAN}📁 Setting core application paths...{C_RESET}")
    write_env_var("TT_STUDIO_ROOT", TT_STUDIO_ROOT, quote_value=False)
    write_env_var("HOST_PERSISTENT_STORAGE_VOLUME", os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume"), quote_value=False)
    write_env_var("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume", quote_value=False)
    write_env_var("BACKEND_API_HOSTNAME", "tt-studio-backend-api")

    if not quick_setup:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- 🔑  Security Credentials  ---{C_RESET}")

    # JWT_SECRET
    current_jwt = get_env_var("JWT_SECRET")
    if quick_setup:
        if should_configure_var("JWT_SECRET", current_jwt):
            write_env_var("JWT_SECRET", "test-secret-456", quote_value=False)
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
                write_env_var("JWT_SECRET", val.strip().strip('"\''), quote_value=False)
                print("✅ JWT_SECRET saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        if not quick_setup:
            print(f"✅ JWT_SECRET already configured (keeping existing value).")

    # DJANGO_SECRET_KEY
    current_django = get_env_var("DJANGO_SECRET_KEY")
    if quick_setup:
        if should_configure_var("DJANGO_SECRET_KEY", current_django):
            write_env_var("DJANGO_SECRET_KEY", "django-insecure-default", quote_value=False)
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
                write_env_var("DJANGO_SECRET_KEY", val.strip().strip('"\''), quote_value=False)
                print("✅ DJANGO_SECRET_KEY saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        print(f"✅ DJANGO_SECRET_KEY already configured (keeping existing value).")

    # TTS_API_KEY
    current_tts_api_key = get_env_var("TTS_API_KEY")
    if quick_setup:
        if should_configure_var("TTS_API_KEY", current_tts_api_key):
            write_env_var("TTS_API_KEY", "your-secret-key")
    elif should_configure_var("TTS_API_KEY", current_tts_api_key):
        if is_placeholder(current_tts_api_key):
            print(f"🔄 TTS_API_KEY has placeholder value '{current_tts_api_key}' - configuring...")
        dev_default = "your-secret-key" if dev_mode else ""
        prompt_text = f"🔑 Enter TTS_API_KEY (for TTS inference server authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("TTS_API_KEY", val)
                print("✅ TTS_API_KEY saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        if not quick_setup:
            print(f"✅ TTS_API_KEY already configured (keeping existing value).")

    # DOCKER_CONTROL_SERVICE_URL
    current_docker_url = get_env_var("DOCKER_CONTROL_SERVICE_URL")
    if quick_setup:
        if should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
            write_env_var("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
    elif should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
        if is_placeholder(current_docker_url):
            print(f"🔄 DOCKER_CONTROL_SERVICE_URL has placeholder value '{current_docker_url}' - configuring...")
        dev_default = "http://host.docker.internal:8002"
        prompt_text = f"🐳 Enter DOCKER_CONTROL_SERVICE_URL{' [default: ' + dev_default + ']' if dev_mode else ' (default: http://host.docker.internal:8002)'}: "
        val = input(prompt_text)
        if not val:
            val = dev_default
        write_env_var("DOCKER_CONTROL_SERVICE_URL", val)
        print("✅ DOCKER_CONTROL_SERVICE_URL saved.")
    else:
        if not quick_setup:
            print(f"✅ DOCKER_CONTROL_SERVICE_URL already configured (keeping existing value).")

    # DOCKER_CONTROL_JWT_SECRET
    current_docker_jwt = get_env_var("DOCKER_CONTROL_JWT_SECRET")
    if quick_setup:
        if should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
            write_env_var("DOCKER_CONTROL_JWT_SECRET", "test-secret-456", quote_value=False)
    elif should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
        if is_placeholder(current_docker_jwt):
            print(f"🔄 DOCKER_CONTROL_JWT_SECRET has placeholder value '{current_docker_jwt}' - configuring...")
        dev_default = "dev-docker-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter DOCKER_CONTROL_JWT_SECRET (for Docker Control Service authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DOCKER_CONTROL_JWT_SECRET", val.strip().strip('"\''), quote_value=False)
                print("✅ DOCKER_CONTROL_JWT_SECRET saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        if not quick_setup:
            print(f"✅ DOCKER_CONTROL_JWT_SECRET already configured (keeping existing value).")

    # TAVILY_API_KEY (optional)
    current_tavily = get_env_var("TAVILY_API_KEY")
    if quick_setup:
        if should_configure_var("TAVILY_API_KEY", current_tavily):
            write_env_var("TAVILY_API_KEY", "tavily-api-key-not-configured", quote_value=False)
    elif should_configure_var("TAVILY_API_KEY", current_tavily):
        prompt_text = "🔍 Enter TAVILY_API_KEY for search agent (optional; press Enter to skip): "
        val = getpass.getpass(prompt_text)
        write_env_var("TAVILY_API_KEY", (val or "").strip().strip('"\''), quote_value=False)
        print("✅ TAVILY_API_KEY saved.")
    else:
        if not quick_setup:
            print(f"✅ TAVILY_API_KEY already configured (keeping existing value).")

    # HF_TOKEN
    current_hf = get_env_var("HF_TOKEN")
    needs_token = should_configure_var("HF_TOKEN", current_hf)

    if quick_setup and needs_token:
        print(f"\n{C_CYAN}A Hugging Face token is required to download models like Llama.{C_RESET}")
        print(f"{C_CYAN}Get yours at: https://huggingface.co/settings/tokens{C_RESET}\n")

    retrying = False
    while True:
        if needs_token:
            if retrying:
                prompt = "🤗 Enter a new HF_TOKEN (or press Enter to keep the current one and continue later): "
                val = getpass.getpass(prompt)
                if not val or not val.strip():
                    # Keep existing token, continue without access
                    print(f"{C_YELLOW}⚠️  Continuing with existing token. Re-run once you have access.{C_RESET}")
                    break
            else:
                prompt = "🤗 Enter HF_TOKEN: " if quick_setup else "🤗 Enter HF_TOKEN (Hugging Face token): "
                val = getpass.getpass(prompt)
                if not val or not val.strip():
                    print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
                    continue
            val = val.strip().strip('"\'')
            write_env_var("HF_TOKEN", val, quote_value=False)
            print("✅ HF_TOKEN saved.")
        else:
            val = current_hf
            if not quick_setup:
                print(f"✅ HF_TOKEN already configured (keeping existing value).")

        ok, msg = check_hf_access(val)
        print(msg)
        if ok is False:
            print()
            print(f"   1. Enter a different token now")
            print(f"   2. Continue with this token once access is granted, then re-run: python run.py")
            while True:
                choice = input("Choose (1 or 2): ").strip()
                if choice in ("1", "2"):
                    break
                print(f"{C_RED}⛔ Enter 1 or 2.{C_RESET}")
            if choice == "1":
                needs_token = True
                retrying = True
                continue
            # choice == "2": continue with current token
        break

    if not quick_setup:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- ⚙️  Application Configuration  ---{C_RESET}")

    # VITE_APP_TITLE
    current_title = get_env_var("VITE_APP_TITLE")
    if quick_setup:
        if should_configure_var("VITE_APP_TITLE", current_title):
            write_env_var("VITE_APP_TITLE", "Tenstorrent | TT Studio")
    elif should_configure_var("VITE_APP_TITLE", current_title):
        dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
        val = input(f"📝 Enter application title (default: {dev_default}): ") or dev_default
        write_env_var("VITE_APP_TITLE", val)
        print("✅ VITE_APP_TITLE saved.")
    else:
        if not quick_setup:
            print(f"✅ VITE_APP_TITLE already configured: {current_title}")

    if not quick_setup:
        print(f"\n{C_CYAN}{C_BOLD}------------------ Mode Selection ------------------{C_RESET}")

    # VITE_ENABLE_DEPLOYED
    current_deployed = get_env_var("VITE_ENABLE_DEPLOYED")
    if quick_setup:
        if should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
            write_env_var("VITE_ENABLE_DEPLOYED", "false", quote_value=False)
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
        if not quick_setup:
            print(f"✅ VITE_ENABLE_DEPLOYED already configured: {current_deployed}")

    is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))
    if not quick_setup:
        print(f"🔹 AI Playground Mode is {'ENABLED' if is_deployed_mode else 'DISABLED'}")

    # VITE_ENABLE_RAG_ADMIN
    current_rag = get_env_var("VITE_ENABLE_RAG_ADMIN")
    if quick_setup:
        if should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
            write_env_var("VITE_ENABLE_RAG_ADMIN", "false", quote_value=False)
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
        if not quick_setup:
            print(f"✅ VITE_ENABLE_RAG_ADMIN already configured: {current_rag}")

    is_rag_admin_enabled = parse_boolean_env(get_env_var("VITE_ENABLE_RAG_ADMIN"))
    if not quick_setup:
        print(f"🔹 RAG Admin Page is {'ENABLED' if is_rag_admin_enabled else 'DISABLED'}")

    # RAG_ADMIN_PASSWORD (only if RAG is enabled, or set default in quick setup)
    current_rag_pass = get_env_var("RAG_ADMIN_PASSWORD")
    if quick_setup:
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            write_env_var("RAG_ADMIN_PASSWORD", "tt-studio-rag-admin-password", quote_value=False)
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
                    write_env_var("RAG_ADMIN_PASSWORD", val.strip().strip('"\''), quote_value=False)
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
    
    if quick_setup:
        for var_name, _, _ in cloud_vars:
            current_val = get_env_var(var_name)
            if should_configure_var(var_name, current_val):
                write_env_var(var_name, "")
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
        if not quick_setup:
            print(f"\n{C_YELLOW}Skipping cloud model configuration (AI Playground mode is disabled).{C_RESET}")

    # Frontend configuration (always set in quick setup, optional otherwise)
    if quick_setup:
        current_frontend_host = get_env_var("FRONTEND_HOST")
        current_frontend_port = get_env_var("FRONTEND_PORT")
        current_frontend_timeout = get_env_var("FRONTEND_TIMEOUT")

        if should_configure_var("FRONTEND_HOST", current_frontend_host):
            write_env_var("FRONTEND_HOST", "localhost")
        if should_configure_var("FRONTEND_PORT", current_frontend_port):
            write_env_var("FRONTEND_PORT", "3000", quote_value=False)
        if should_configure_var("FRONTEND_TIMEOUT", current_frontend_timeout):
            write_env_var("FRONTEND_TIMEOUT", "60", quote_value=False)

    # TT Inference Server Artifact Configuration
    if not quick_setup:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- 🔧 TT Inference Server Configuration  ---{C_RESET}")
    configure_inference_server_artifact(dev_mode, quick_setup, force_reconfigure, reconfigure_inference)

    print(f"\n{C_GREEN}✅ Environment configuration complete.{C_RESET}")
