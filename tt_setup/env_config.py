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
from rich.markup import escape as escape_markup
from tt_setup.constants import *
from tt_setup.console import console, is_verbose


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

    # Low-priority provenance: show a muted one-liner for official releases;
    # the unofficial-branch note is detail, shown only with --verbose.
    if version:
        console.print(f"[muted]Build {version} · official release[/muted]")
    elif branch and is_verbose():
        console.print(f"[muted]Build {branch} · unofficial build[/muted]")


def save_setup_config(config_dict):
    """Save the quick-setup configuration snapshot to JSON file"""
    try:
        with open(SETUP_CONFIG_FILE_PATH, 'w') as f:
            json.dump(config_dict, f, indent=2)
        # Silent — no need to show config file path to user
    except Exception as e:
        console.print(f"[warning]⚠️  Warning: Could not save setup configuration: {e}[/warning]")


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
        console.print(f"[warning]Warning: Could not save preferences: {e}[/warning]")


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
    terms_url = "https://docs.tenstorrent.com/os-model-terms.html"
    terms_link = f"[link={terms_url}]OS Model Terms[/link]"
    console.print()
    console.print("[bold accent]📝 First-Time Setup[/bold accent]")
    console.print()
    console.print("[info]Welcome to TT Studio![/info]")
    console.print()
    console.print("[bold]📄 Terms & Conditions[/bold]")
    console.print(f"By proceeding, you agree to our {terms_link}")
    console.print(f"  [muted]↳ {terms_url}[/muted]")
    console.print()
    console.print("[bold]TL;DR:[/bold]")
    console.print("  • [success]AS-IS:[/success] These models are for demonstration; we don't guarantee their output.")
    console.print("  • [success]Liability:[/success] Tenstorrent isn't responsible for damages or AI-generated content.")
    console.print("  • [success]Compliance:[/success] You agree to follow the original creators' licenses.")
    console.print()

    # Terms acceptance confirmation
    while True:
        response = input("Do you agree to these terms? [yes/no]: ").strip().lower()
        if response in ['n', 'no', '']:
            console.print("[error]Terms not accepted. Exiting TT-Studio.[/error]")
            sys.exit(0)
        elif response in ['y', 'yes']:
            console.print("[success]Terms accepted. Continuing with setup...[/success]")
            save_preference("terms_accepted", True)
            break
        else:
            console.print("[warning]Please enter 'yes' (or 'y') or 'no' (or 'n').[/warning]")

    console.print()
    console.print("[info]ℹ️  What to expect:[/info]")
    console.print("  • [muted]We'll guide you through the initial setup[/muted]")
    console.print("  • [muted]Your responses will be saved for future runs[/muted]")
    console.print("  • [muted]Subsequent runs will be much faster and non-interactive[/muted]")
    console.print("  • [muted]You can reset your preferences anytime with[/muted] [bold]--reconfigure[/bold]")
    console.print()
    console.print("[warning]Note: You won't be asked these questions again unless you explicitly reset your preference(s) and .env file.[/warning]")
    console.print()


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
        console.print(f"[muted]📋 Found placeholder values that will be configured: {list(placeholder_vars.keys())}[/muted]")

    if not real_vars:
        console.print("[muted]All existing variables appear to be placeholders. Will configure all values.[/muted]")
        return True

    console.print("\n[bold info]🔍 Configuration Status Check[/bold info]")
    console.print(f"[success]✅ Found an existing TT Studio configuration with {len(real_vars)} configured variables:[/success]")
    console.print()
    
    # Group variables by category for better display
    core_vars = ["TT_STUDIO_ROOT", "HOST_PERSISTENT_STORAGE_VOLUME", "INTERNAL_PERSISTENT_STORAGE_VOLUME", "BACKEND_API_HOSTNAME"]
    security_vars = ["JWT_SECRET", "DJANGO_SECRET_KEY", "HF_TOKEN", "TAVILY_API_KEY", "RAG_ADMIN_PASSWORD"]
    app_vars = ["VITE_APP_TITLE", "VITE_ENABLE_DEPLOYED", "VITE_ENABLE_RAG_ADMIN"]
    cloud_vars = [k for k in real_vars.keys() if k.startswith("CLOUD_")]
    
    def display_vars(category_name, var_list, emoji):
        category_vars = {k: v for k, v in real_vars.items() if k in var_list}
        if category_vars:
            console.print(f"[bold]{emoji} {category_name}:[/bold]")
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
                # display_value may contain literal brackets (e.g. [PLACEHOLDER: …]);
                # escape it so Rich renders it as data, not markup.
                safe_value = escape_markup(display_value)
                console.print(f"    • {var_name}: [info]{safe_value}[/info]", highlight=False)
            console.print()
    
    display_vars("Core Configuration", core_vars, "📁")
    display_vars("Security Credentials", security_vars, "🔐")
    display_vars("Application Settings", app_vars, "⚙️")
    display_vars("Cloud Model APIs", cloud_vars, "☁️")

    # Add visual separator
    console.print("[muted]" + "=" * 80 + "[/muted]")

    console.print("[bold info]What would you like to do?[/bold info]")
    console.print()
    console.print("  [bold success]1 - Keep Existing Configuration (Recommended)[/bold success]")
    console.print("    [muted]• Keep all current values as they are[/muted]")
    console.print("    [muted]• Only configure any missing or placeholder values[/muted]")
    console.print("    [muted]• Recommended for normal startup[/muted]")
    console.print()
    console.print("  [bold accent]2 - Reconfigure Everything[/bold accent]")
    console.print("    [muted]• Go through setup prompts for ALL variables[/muted]")
    console.print("    [muted]• Replace existing values with new ones[/muted]")
    console.print("    [muted]• Use this if you want to change your configuration[/muted]")
    console.print()

    # Add another visual separator before input
    console.print("[muted]" + "=" * 80 + "[/muted]")

    while True:
        console.print("[bold]Choose an option:[/bold]")
        console.print("  [success]1[/success] - Keep existing configuration (recommended)")
        console.print("  [accent]2[/accent] - Reconfigure everything")
        console.print()
        try:
            choice = input("Enter your choice (1/2): ").strip()
        except KeyboardInterrupt:
            console.print("\n\n[warning]🛑 Setup interrupted by user (Ctrl+C)[/warning]")

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

            console.print(f"[info]🔄 To resume setup later, run:[/info] [bold]{original_cmd}[/bold]")
            console.print("[info]🧹 To clean up any partial setup:[/info] [bold]python run.py --stop[/bold]")
            console.print("[info]❓ For help:[/info] [bold]python run.py --help or alternatively: python3 run.py --help[/bold]")
            sys.exit(0)

        if choice == "1":
            console.print("\n[success]✅ Keeping existing configuration. Only missing values will be configured.[/success]")
            # Show which placeholder values will still need to be configured
            placeholder_vars = {k: v for k, v in existing_vars.items() if is_placeholder(v)}
            if placeholder_vars:
                console.print("[info]📝 Note: Placeholder values will still be prompted for configuration:[/info]")
                for var_name in placeholder_vars.keys():
                    console.print(f"    [muted]• {var_name}[/muted]")
                console.print()
            save_preference("configuration_mode", "keep_existing")
            return False
        elif choice == "2":
            console.print("\n[accent]🔄 Will reconfigure all environment variables.[/accent]")
            save_preference("configuration_mode", "reconfigure_everything")
            return True
        else:
            console.print("[error]❌ Please enter 1 to keep existing config or 2 to reconfigure everything.[/error]")
            console.print()


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
    """Check if the HF token can access the gated model repos.

    Returns (status, results):
      - status: True if any repo is accessible, False if the token is
        invalid/denied, None if HuggingFace was unreachable for every repo.
      - results: list of (label, repo_id, http_code) per repo (code None =
        unreachable). The caller renders this — one calm line by default, the
        full per-repo breakdown on failure or with --verbose.
    """
    repos = [
        ("meta-llama/Llama-3.1-8B-Instruct", "Llama 3.1"),
        ("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3"),
        ("Qwen/Qwen3-32B", "Qwen3-32B"),
    ]
    results = [(label, repo_id, _hf_check_repo(token, repo_id)) for repo_id, label in repos]

    codes = [code for _, _, code in results]
    if all(c is None for c in codes):
        return (None, results)
    if any(c == 401 for c in codes) or any(c == 403 for c in codes):
        return (False, results)
    if any(c == 200 for c in codes):
        return (True, results)
    return (None, results)


def render_hf_access(status, results):
    """Render check_hf_access() output through the theme: one ✓ line when all
    good (unless --verbose), otherwise the full per-repo breakdown."""
    ok_labels = [label for label, _, code in results if code == 200]
    if all(code is None for _, _, code in results):
        console.print("[muted]🤗 HuggingFace: couldn't reach to verify access — continuing[/muted]")
        return
    if status and not is_verbose():
        console.print(f"[success]✓[/success] HuggingFace access [muted]· {', '.join(ok_labels)}[/muted]")
        return
    console.print("[info]🤗 HuggingFace access:[/info]")
    for label, repo_id, code in results:
        if code == 200:
            console.print(f"  [success]✓[/success] {label}: confirmed")
        elif code == 401:
            console.print(f"  [error]✗[/error] {label}: token invalid or expired (401)")
        elif code == 403:
            console.print(f"  [error]✗[/error] {label}: access not granted yet (403) — https://huggingface.co/{repo_id}")
        elif code is None:
            console.print(f"  [warning]…[/warning] {label}: couldn't reach HuggingFace")
        else:
            console.print(f"  [warning]…[/warning] {label}: unexpected HTTP {code}")


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
            console.print("[info]📄 No .env file found. Creating one from the default template...[/info]")
            shutil.copy(ENV_FILE_DEFAULT, ENV_FILE_PATH)
        else:
            console.print("[warning]⚠️  Warning: .env.default not found. Creating an empty .env file.[/warning]")
            open(ENV_FILE_PATH, 'w').close()
        # When no .env file exists, we should configure everything without asking
        FORCE_OVERWRITE = True

    if not quick_setup:
        console.print("\n[bold accent]TT Studio Environment Configuration[/bold accent]")
        console.print("[success]⚙️  Configure Env Mode: Full interactive setup for all variables[/success]")
        if dev_mode:
            console.print("[warning]   Development Mode: suggested defaults shown (NOT secure for production)[/warning]")
        else:
            console.print("[info]   Production Mode: prompting for secure, production-ready values[/info]")
    
    # Get existing variables
    existing_vars = get_existing_env_vars()
    
    # Only ask about overwrite preference if .env file existed before (skip for quick setup)
    if not quick_setup and env_file_exists and existing_vars:
        FORCE_OVERWRITE = ask_overwrite_preference(existing_vars, force_prompt=force_reconfigure)
    else:
        # No need to ask, we're configuring everything
        if not env_file_exists:
            if not quick_setup:
                console.print("\n[info]📝 Setting up TT Studio for the first time...[/info]")
            FORCE_OVERWRITE = True
        elif quick_setup:
            # In quick setup with existing .env, don't force overwrite - let individual checks handle it
            if env_file_exists and existing_vars:
                FORCE_OVERWRITE = False
            else:
                FORCE_OVERWRITE = True
        else:
            console.print("\n[info]📝 No existing configuration found. Will configure all environment variables.[/info]")
            FORCE_OVERWRITE = True

    if not quick_setup:
        console.print("\n[info]📁 Setting core application paths...[/info]")
    write_env_var("TT_STUDIO_ROOT", TT_STUDIO_ROOT, quote_value=False)
    write_env_var("HOST_PERSISTENT_STORAGE_VOLUME", os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume"), quote_value=False)
    write_env_var("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume", quote_value=False)
    write_env_var("BACKEND_API_HOSTNAME", "tt-studio-backend-api")

    if not quick_setup:
        console.print("\n[bold accent]--- 🔑  Security Credentials  ---[/bold accent]")

    # JWT_SECRET
    current_jwt = get_env_var("JWT_SECRET")
    if quick_setup:
        if should_configure_var("JWT_SECRET", current_jwt):
            write_env_var("JWT_SECRET", "test-secret-456", quote_value=False)
    elif should_configure_var("JWT_SECRET", current_jwt):
        if is_placeholder(current_jwt):
            console.print(f"[info]🔄 JWT_SECRET has placeholder value '{current_jwt}' - configuring...[/info]")
        dev_default = "dev-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter JWT_SECRET (for authentication to model endpoints){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("JWT_SECRET", val.strip().strip('"\''), quote_value=False)
                console.print("[success]✅ JWT_SECRET saved.[/success]")
                break
            console.print("[error]⛔ This value cannot be empty.[/error]")
    else:
        if not quick_setup:
            console.print("[success]✅ JWT_SECRET already configured (keeping existing value).[/success]")

    # DJANGO_SECRET_KEY
    current_django = get_env_var("DJANGO_SECRET_KEY")
    if quick_setup:
        if should_configure_var("DJANGO_SECRET_KEY", current_django):
            write_env_var("DJANGO_SECRET_KEY", "django-insecure-default", quote_value=False)
    elif should_configure_var("DJANGO_SECRET_KEY", current_django):
        if is_placeholder(current_django):
            console.print(f"[info]🔄 DJANGO_SECRET_KEY has placeholder value '{current_django}' - configuring...[/info]")
        dev_default = "django-dev-secret-key-not-for-production-12345" if dev_mode else ""
        prompt_text = f"🔑 Enter DJANGO_SECRET_KEY (for Django backend security){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DJANGO_SECRET_KEY", val.strip().strip('"\''), quote_value=False)
                console.print("[success]✅ DJANGO_SECRET_KEY saved.[/success]")
                break
            console.print("[error]⛔ This value cannot be empty.[/error]")
    else:
        console.print("[success]✅ DJANGO_SECRET_KEY already configured (keeping existing value).[/success]")

    # TTS_API_KEY
    current_tts_api_key = get_env_var("TTS_API_KEY")
    if quick_setup:
        if should_configure_var("TTS_API_KEY", current_tts_api_key):
            write_env_var("TTS_API_KEY", "your-secret-key")
    elif should_configure_var("TTS_API_KEY", current_tts_api_key):
        if is_placeholder(current_tts_api_key):
            console.print(f"[info]🔄 TTS_API_KEY has placeholder value '{current_tts_api_key}' - configuring...[/info]")
        dev_default = "your-secret-key" if dev_mode else ""
        prompt_text = f"🔑 Enter TTS_API_KEY (for TTS inference server authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("TTS_API_KEY", val)
                console.print("[success]✅ TTS_API_KEY saved.[/success]")
                break
            console.print("[error]⛔ This value cannot be empty.[/error]")
    else:
        if not quick_setup:
            console.print("[success]✅ TTS_API_KEY already configured (keeping existing value).[/success]")

    # DOCKER_CONTROL_SERVICE_URL
    current_docker_url = get_env_var("DOCKER_CONTROL_SERVICE_URL")
    if quick_setup:
        if should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
            write_env_var("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
    elif should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
        if is_placeholder(current_docker_url):
            console.print(f"[info]🔄 DOCKER_CONTROL_SERVICE_URL has placeholder value '{current_docker_url}' - configuring...[/info]")
        dev_default = "http://host.docker.internal:8002"
        prompt_text = f"🐳 Enter DOCKER_CONTROL_SERVICE_URL{' [default: ' + dev_default + ']' if dev_mode else ' (default: http://host.docker.internal:8002)'}: "
        val = input(prompt_text)
        if not val:
            val = dev_default
        write_env_var("DOCKER_CONTROL_SERVICE_URL", val)
        console.print("[success]✅ DOCKER_CONTROL_SERVICE_URL saved.[/success]")
    else:
        if not quick_setup:
            console.print("[success]✅ DOCKER_CONTROL_SERVICE_URL already configured (keeping existing value).[/success]")

    # DOCKER_CONTROL_JWT_SECRET
    current_docker_jwt = get_env_var("DOCKER_CONTROL_JWT_SECRET")
    if quick_setup:
        if should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
            write_env_var("DOCKER_CONTROL_JWT_SECRET", "test-secret-456", quote_value=False)
    elif should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
        if is_placeholder(current_docker_jwt):
            console.print(f"[info]🔄 DOCKER_CONTROL_JWT_SECRET has placeholder value '{current_docker_jwt}' - configuring...[/info]")
        dev_default = "dev-docker-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter DOCKER_CONTROL_JWT_SECRET (for Docker Control Service authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DOCKER_CONTROL_JWT_SECRET", val.strip().strip('"\''), quote_value=False)
                console.print("[success]✅ DOCKER_CONTROL_JWT_SECRET saved.[/success]")
                break
            console.print("[error]⛔ This value cannot be empty.[/error]")
    else:
        if not quick_setup:
            console.print("[success]✅ DOCKER_CONTROL_JWT_SECRET already configured (keeping existing value).[/success]")

    # TAVILY_API_KEY (optional)
    current_tavily = get_env_var("TAVILY_API_KEY")
    if quick_setup:
        if should_configure_var("TAVILY_API_KEY", current_tavily):
            write_env_var("TAVILY_API_KEY", "tavily-api-key-not-configured", quote_value=False)
    elif should_configure_var("TAVILY_API_KEY", current_tavily):
        prompt_text = "🔍 Enter TAVILY_API_KEY for search agent (optional; press Enter to skip): "
        val = getpass.getpass(prompt_text)
        write_env_var("TAVILY_API_KEY", (val or "").strip().strip('"\''), quote_value=False)
        console.print("[success]✅ TAVILY_API_KEY saved.[/success]")
    else:
        if not quick_setup:
            console.print("[success]✅ TAVILY_API_KEY already configured (keeping existing value).[/success]")

    # HF_TOKEN
    current_hf = get_env_var("HF_TOKEN")
    needs_token = should_configure_var("HF_TOKEN", current_hf)

    if quick_setup and needs_token:
        console.print("\n[info]A Hugging Face token is required to download models like Llama.[/info]")
        console.print("[info]Get yours at: https://huggingface.co/settings/tokens[/info]\n")

    retrying = False
    while True:
        if needs_token:
            if retrying:
                prompt = "🤗 Enter a new HF_TOKEN (or press Enter to keep the current one and continue later): "
                val = getpass.getpass(prompt)
                if not val or not val.strip():
                    # Keep existing token, continue without access
                    console.print("[warning]⚠️  Continuing with existing token. Re-run once you have access.[/warning]")
                    break
            else:
                prompt = "🤗 Enter HF_TOKEN: " if quick_setup else "🤗 Enter HF_TOKEN (Hugging Face token): "
                val = getpass.getpass(prompt)
                if not val or not val.strip():
                    console.print("[error]⛔ This value cannot be empty.[/error]")
                    continue
            val = val.strip().strip('"\'')
            write_env_var("HF_TOKEN", val, quote_value=False)
            console.print("[success]✅ HF_TOKEN saved.[/success]")
        else:
            val = current_hf
            if not quick_setup:
                console.print("[success]✅ HF_TOKEN already configured (keeping existing value).[/success]")

        status, hf_results = check_hf_access(val)
        render_hf_access(status, hf_results)
        if status is False:
            console.print()
            console.print("   [muted]1. Enter a different token now[/muted]")
            console.print("   [muted]2. Continue with this token once access is granted, then re-run: python run.py[/muted]")
            while True:
                choice = input("Choose (1 or 2): ").strip()
                if choice in ("1", "2"):
                    break
                console.print("[error]⛔ Enter 1 or 2.[/error]")
            if choice == "1":
                needs_token = True
                retrying = True
                continue
            # choice == "2": continue with current token
        break

    if not quick_setup:
        console.print("\n[bold accent]--- ⚙️  Application Configuration  ---[/bold accent]")

    # VITE_APP_TITLE
    current_title = get_env_var("VITE_APP_TITLE")
    if quick_setup:
        if should_configure_var("VITE_APP_TITLE", current_title):
            write_env_var("VITE_APP_TITLE", "Tenstorrent | TT Studio")
    elif should_configure_var("VITE_APP_TITLE", current_title):
        dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
        val = input(f"📝 Enter application title (default: {dev_default}): ") or dev_default
        write_env_var("VITE_APP_TITLE", val)
        console.print("[success]✅ VITE_APP_TITLE saved.[/success]")
    else:
        if not quick_setup:
            console.print(f"[success]✅ VITE_APP_TITLE already configured:[/success] [muted]{escape_markup(current_title)}[/muted]")

    if not quick_setup:
        console.print("\n[bold info]------------------ Mode Selection ------------------[/bold info]")

    # VITE_ENABLE_DEPLOYED
    current_deployed = get_env_var("VITE_ENABLE_DEPLOYED")
    if quick_setup:
        if should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
            write_env_var("VITE_ENABLE_DEPLOYED", "false", quote_value=False)
    elif should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
        console.print("[info]Enable AI Playground Mode? (Connects to external cloud models)[/info]")
        dev_default = "false" if dev_mode else "false"

        while True:
            val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
            if val in ["true", "false"]:
                write_env_var("VITE_ENABLE_DEPLOYED", val, quote_value=False)
                console.print("[success]✅ VITE_ENABLE_DEPLOYED saved.[/success]")
                break
            console.print("[error]⛔ Invalid input. Please enter 'true' or 'false'.[/error]")
    else:
        if not quick_setup:
            console.print(f"[success]✅ VITE_ENABLE_DEPLOYED already configured:[/success] [muted]{current_deployed}[/muted]")

    is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))
    if not quick_setup:
        console.print(f"[info]🔹 AI Playground Mode is {'ENABLED' if is_deployed_mode else 'DISABLED'}[/info]")

    # VITE_ENABLE_RAG_ADMIN
    current_rag = get_env_var("VITE_ENABLE_RAG_ADMIN")
    if quick_setup:
        if should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
            write_env_var("VITE_ENABLE_RAG_ADMIN", "false", quote_value=False)
    elif should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
        console.print("\n[info]Enable RAG document management admin page?[/info]")
        dev_default = "false" if dev_mode else "false"

        while True:
            val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
            if val in ["true", "false"]:
                write_env_var("VITE_ENABLE_RAG_ADMIN", val, quote_value=False)
                console.print("[success]✅ VITE_ENABLE_RAG_ADMIN saved.[/success]")
                break
            console.print("[error]⛔ Invalid input. Please enter 'true' or 'false'.[/error]")
    else:
        if not quick_setup:
            console.print(f"[success]✅ VITE_ENABLE_RAG_ADMIN already configured:[/success] [muted]{current_rag}[/muted]")

    is_rag_admin_enabled = parse_boolean_env(get_env_var("VITE_ENABLE_RAG_ADMIN"))
    if not quick_setup:
        console.print(f"[info]🔹 RAG Admin Page is {'ENABLED' if is_rag_admin_enabled else 'DISABLED'}[/info]")

    # RAG_ADMIN_PASSWORD (only if RAG is enabled, or set default in quick setup)
    current_rag_pass = get_env_var("RAG_ADMIN_PASSWORD")
    if quick_setup:
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            write_env_var("RAG_ADMIN_PASSWORD", "tt-studio-rag-admin-password", quote_value=False)
    elif is_rag_admin_enabled:
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            dev_default = "dev-admin-123" if dev_mode else ""
            prompt_text = f"Enter RAG_ADMIN_PASSWORD{' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
            
            console.print("[info]🔒 RAG admin is enabled. You must set a password.[/info]")
            while True:
                val = getpass.getpass(prompt_text)
                if not val and dev_mode:
                    val = dev_default
                if val and val.strip():
                    write_env_var("RAG_ADMIN_PASSWORD", val.strip().strip('"\''), quote_value=False)
                    console.print("[success]✅ RAG_ADMIN_PASSWORD saved.[/success]")
                    break
                console.print("[error]⛔ Password cannot be empty.[/error]")
        else:
            console.print("[success]✅ RAG_ADMIN_PASSWORD already configured (keeping existing value).[/success]")

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
        console.print("\n[bold accent]--- ☁️  AI Playground Model Configuration  ---[/bold accent]")
        console.print("[warning]Note: These are optional. Press Enter to skip any field.[/warning]")

        for var_name, prompt, is_secret in cloud_vars:
            current_val = get_env_var(var_name)
            if should_configure_var(var_name, current_val):
                if is_secret:
                    val = getpass.getpass(f"{prompt} (optional): ")
                else:
                    val = input(f"{prompt} (optional): ")
                write_env_var(var_name, val or "")
                status = "saved" if val else "skipped (empty)"
                console.print(f"[success]✅ {var_name} {status}.[/success]")
            else:
                console.print(f"[success]✅ {var_name} already configured (keeping existing value).[/success]")
    else:
        if not quick_setup:
            console.print("\n[warning]Skipping cloud model configuration (AI Playground mode is disabled).[/warning]")

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
        console.print("\n[bold accent]--- 🔧 TT Inference Server Configuration  ---[/bold accent]")
    configure_inference_server_artifact(dev_mode, quick_setup, force_reconfigure, reconfigure_inference)

    console.print("[success]✓[/success] Environment configured")
