# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Interactive environment configuration flow (+ the FORCE_OVERWRITE gate and
the lazy inference-server-artifact wrapper that breaks the import cycle)."""

import os
import secrets
import shutil
import sys
from rich.markup import escape as escape_markup
from tt_setup.constants import *
from tt_setup.console import ask, confirm, console, in_phase, secret
from tt_setup.env_config._values import is_placeholder, parse_boolean_env
from tt_setup.env_config._dotenv import get_env_var, get_existing_env_vars, write_env_var
from tt_setup.env_config._preferences import clear_preferences, get_preference, is_first_time_setup, save_preference


def configure_inference_server_artifact(*args, **kwargs):
    # Lazy import to break the env_config <-> inference_server import cycle.
    from tt_setup.inference_server import configure_inference_server_artifact as _impl
    return _impl(*args, **kwargs)


FORCE_OVERWRITE = False


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


def display_first_time_welcome(accept_terms=False):
    """Display welcome message for first-time setup.
    """
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
    if accept_terms or confirm("Do you agree to these terms?", default=False):
        console.print("[success]Terms accepted. Continuing with setup...[/success]")
        save_preference("terms_accepted", True)
    else:
        console.print("[error]Terms not accepted. Exiting TT-Studio.[/error]")
        sys.exit(0)

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

    console.print()
    console.print("[muted]Keep your existing values (only missing/placeholder ones are prompted), "
                  "or reconfigure everything from scratch.[/muted]")
    try:
        reconfigure = confirm("Reconfigure all environment variables?", default=False)
    except KeyboardInterrupt:
        console.print("\n\n[warning]🛑 Setup interrupted by user (Ctrl+C)[/warning]")
        console.print("[info]🔄 To resume setup later, run:[/info] [bold]python run.py[/bold]")
        console.print("[info]🧹 To clean up any partial setup:[/info] [bold]python run.py --stop[/bold]")
        console.print("[info]❓ For help:[/info] [bold]python run.py --help[/bold]")
        sys.exit(0)

    if reconfigure:
        console.print("\n[accent]🔄 Will reconfigure all environment variables.[/accent]")
        save_preference("configuration_mode", "reconfigure_everything")
        return True

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


def configure_environment_sequentially(dev_mode=False, force_reconfigure=False, quick_setup=True, reconfigure_inference=False, accept_terms=False):
    """
    Handles all environment configuration in a sequential, top-to-bottom flow.
    Reads existing .env file and prompts for missing or placeholder values.

    Args:
        dev_mode (bool): If True, show dev mode banner but still prompt for all values
        force_reconfigure (bool): If True, force reconfiguration and clear preferences
        quick_setup (bool): If True, use minimal prompts and defaults for quick setup
        reconfigure_inference (bool): If True, force reconfiguration of inference server artifact only
        accept_terms (bool): If True, accept the OS Model Terms non-interactively (for CI/automation)
    """
    global FORCE_OVERWRITE

    # Show first-time welcome if this is the first time
    if is_first_time_setup():
        display_first_time_welcome(accept_terms=accept_terms)
    
    # Clear preferences if reconfiguring
    if force_reconfigure:
        clear_preferences()

    # One-time migration: the canonical .env moved from app/.env to the repo root.
    # Preserve any existing secrets by copying the legacy file up and keeping a backup.
    if os.path.exists(LEGACY_ENV_FILE_PATH):
        if not os.path.exists(ENV_FILE_PATH):
            console.print("[info]📦 Migrating legacy app/.env to the repo-root .env...[/info]")
            shutil.copy(LEGACY_ENV_FILE_PATH, ENV_FILE_PATH)
            os.replace(LEGACY_ENV_FILE_PATH, LEGACY_ENV_BACKUP_PATH)
            console.print("[success]   ✅ Copied to repo-root .env; backed up the old file to app/.env-old[/success]")
        else:
            console.print("[warning]⚠️  Both repo-root .env and legacy app/.env exist; keeping the "
                          "repo-root .env and backing up the legacy file to app/.env-old.[/warning]")
            os.replace(LEGACY_ENV_FILE_PATH, LEGACY_ENV_BACKUP_PATH)

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

    # --reconfigure-inference-server is scoped: it only reconfigures the
    # inference-server artifact source. Skip the full env sweep (HF_TOKEN,
    # secrets, ports, …) so the user is asked exactly one thing — the release
    # or branch to fetch. A full --reconfigure (force_reconfigure) still runs
    # the whole flow below.
    if reconfigure_inference and not force_reconfigure:
        configure_inference_server_artifact(dev_mode, quick_setup, force_reconfigure, reconfigure_inference)
        if not in_phase():  # folded into the "Set up" phase line when run inside a phase
            console.print("[success]✓[/success] Inference server configured")
        return

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

    # LiteLLM gateway: generate strong random keys so the network-published port
    # is never protected by a predictable shared secret.
    if should_configure_var("LITELLM_MASTER_KEY", get_env_var("LITELLM_MASTER_KEY")):
        write_env_var("LITELLM_MASTER_KEY", f"sk-tt-studio-{secrets.token_urlsafe(32)}", quote_value=False)
    if should_configure_var("LITELLM_UPSTREAM_KEY", get_env_var("LITELLM_UPSTREAM_KEY")):
        write_env_var("LITELLM_UPSTREAM_KEY", secrets.token_urlsafe(32), quote_value=False)
    if should_configure_var("LITELLM_PORT", get_env_var("LITELLM_PORT")):
        write_env_var("LITELLM_PORT", "4000", quote_value=False)

    if not quick_setup:
        console.print("\n[bold accent]--- 🔑  Security Credentials  ---[/bold accent]")

    # JWT_SECRET (optional; auto-generated by the backend on first run if unset.
    # Configurable later from the TT Studio Settings UI.)
    current_jwt = get_env_var("JWT_SECRET")
    if quick_setup:
        # Skip prompting in quick setup; backend will auto-generate.
        pass
    elif should_configure_var("JWT_SECRET", current_jwt):
        if is_placeholder(current_jwt):
            console.print(f"[info]🔄 JWT_SECRET has placeholder value '{current_jwt}'.[/info]")
        console.print(
            "[info]ℹ️  JWT_SECRET is optional. If left blank, the backend will "
            "auto-generate one on first start. You can change it later from the "
            "TT Studio Settings UI.[/info]"
        )
        prompt_text = "🔐 Enter JWT_SECRET (press Enter to skip and auto-generate): "
        val = secret(prompt_text)
        if val and val.strip():
            write_env_var("JWT_SECRET", val.strip().strip('"\''), quote_value=False)
            console.print("[success]✅ JWT_SECRET saved.[/success]")
        else:
            console.print("[success]✅ Skipped — backend will auto-generate JWT_SECRET on first start.[/success]")
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
            val = secret(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DJANGO_SECRET_KEY", val.strip().strip('"\''), quote_value=False)
                console.print("[success]✅ DJANGO_SECRET_KEY saved.[/success]")
                break
            console.print("[error]⛔ This value cannot be empty.[/error]")
    else:
        console.print("[success]✅ DJANGO_SECRET_KEY already configured (keeping existing value).[/success]")

    # TTS_API_KEY — UI-managed. Set later in the TT Studio Settings dialog.

    # DOCKER_CONTROL_SERVICE_URL
    current_docker_url = get_env_var("DOCKER_CONTROL_SERVICE_URL")
    if quick_setup:
        if should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
            write_env_var("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
    elif should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
        if is_placeholder(current_docker_url):
            console.print(f"[info]🔄 DOCKER_CONTROL_SERVICE_URL has placeholder value '{current_docker_url}' - configuring...[/info]")
        dev_default = "http://host.docker.internal:8002"
        val = ask("🐳 Enter DOCKER_CONTROL_SERVICE_URL", default=dev_default)
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
            val = secret(prompt_text)
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

    # TAVILY_API_KEY and HF_TOKEN are UI-managed. The Welcome screen in the
    # web app captures them on first run; they're editable later in Settings.
    # HF access is verified in the UI (app/backend/api/hf_access.py), not the CLI.

    if not quick_setup:
        console.print("\n[bold accent]--- ⚙️  Application Configuration  ---[/bold accent]")

    # VITE_APP_TITLE
    current_title = get_env_var("VITE_APP_TITLE")
    if quick_setup:
        if should_configure_var("VITE_APP_TITLE", current_title):
            write_env_var("VITE_APP_TITLE", "Tenstorrent | TT Studio")
    elif should_configure_var("VITE_APP_TITLE", current_title):
        dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
        val = ask("📝 Enter application title", default=dev_default)
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
        val = "true" if confirm("Enable AI Playground Mode? (connects to external cloud models)", default=False) else "false"
        write_env_var("VITE_ENABLE_DEPLOYED", val, quote_value=False)
        console.print("[success]✅ VITE_ENABLE_DEPLOYED saved.[/success]")
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
        val = "true" if confirm("Enable RAG document management admin page?", default=False) else "false"
        write_env_var("VITE_ENABLE_RAG_ADMIN", val, quote_value=False)
        console.print("[success]✅ VITE_ENABLE_RAG_ADMIN saved.[/success]")
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
                val = secret(prompt_text)
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
                    val = secret(f"{prompt} (optional): ")
                else:
                    val = ask(f"{prompt} (optional)", default="")
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

    if not in_phase():  # folded into the "Set up" phase line when run inside a phase
        console.print("[success]✓[/success] Environment configured")

