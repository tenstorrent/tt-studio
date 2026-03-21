# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import sys
import re
import json
import shutil
import getpass

from _runner.constants import (
    C_RESET, C_RED, C_GREEN, C_YELLOW, C_BLUE, C_CYAN, C_WHITE,
    C_BOLD, C_ORANGE, C_TT_PURPLE, C_MAGENTA,
    TT_STUDIO_ROOT, OS_NAME, TENSTORRENT_ASCII_ART,
    ENV_FILE_PATH, ENV_FILE_DEFAULT, PREFS_FILE_PATH, EASY_CONFIG_FILE_PATH,
)
from _runner.utils import is_placeholder, parse_boolean_env

try:
    import requests as _requests
    _HAS_REQUESTS = True
except ImportError:
    import urllib.request as _urllib_request
    _HAS_REQUESTS = False


class EnvManager:
    def __init__(self, ctx):
        self.ctx = ctx
        self._force_overwrite = False  # replaces global FORCE_OVERWRITE

    # ------------------------------------------------------------------ #
    #  Low-level .env file access                                         #
    # ------------------------------------------------------------------ #

    def write_env_var(self, var_name, var_value, quote_value=True):
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

    def get_env_var(self, var_name, default=""):
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

    def get_existing_env_vars(self):
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

    # ------------------------------------------------------------------ #
    #  Preferences                                                        #
    # ------------------------------------------------------------------ #

    def load_preferences(self):
        """Load user preferences from JSON file."""
        if os.path.exists(PREFS_FILE_PATH):
            try:
                with open(PREFS_FILE_PATH, 'r') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

    def save_preferences(self, prefs):
        """Save user preferences to JSON file."""
        try:
            with open(PREFS_FILE_PATH, 'w') as f:
                json.dump(prefs, f, indent=2)
        except IOError as e:
            print(f"{C_YELLOW}Warning: Could not save preferences: {e}{C_RESET}")

    def save_preference(self, key, value):
        """Save a single preference key-value pair."""
        prefs = self.load_preferences()
        prefs[key] = value
        self.save_preferences(prefs)

    def get_preference(self, key, default=None):
        """Get a preference value by key, returning default if not found."""
        prefs = self.load_preferences()
        return prefs.get(key, default)

    def clear_preferences(self):
        """Clear all user preferences by deleting the preferences file."""
        if os.path.exists(PREFS_FILE_PATH):
            try:
                os.remove(PREFS_FILE_PATH)
                return True
            except IOError:
                return False
        return True

    def is_first_time_setup(self):
        """Check if this is the first time setup by checking if preferences exist."""
        return not os.path.exists(PREFS_FILE_PATH)

    def display_first_time_welcome(self):
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

    # ------------------------------------------------------------------ #
    #  Easy config                                                        #
    # ------------------------------------------------------------------ #

    def save_easy_config(self, config_dict):
        """Save easy mode configuration to JSON file"""
        try:
            with open(EASY_CONFIG_FILE_PATH, 'w') as f:
                json.dump(config_dict, f, indent=2)
            print(f"{C_GREEN}✅ Easy mode configuration saved to {EASY_CONFIG_FILE_PATH}{C_RESET}")
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not save easy mode configuration: {e}{C_RESET}")

    def load_easy_config(self):
        """Load easy mode configuration from JSON file"""
        if os.path.exists(EASY_CONFIG_FILE_PATH):
            try:
                with open(EASY_CONFIG_FILE_PATH, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not load easy mode configuration: {e}{C_RESET}")
                return None
        return None

    # ------------------------------------------------------------------ #
    #  Overwrite preference                                               #
    # ------------------------------------------------------------------ #

    def should_configure_var(self, var_name, current_value):
        """
        Determine if we should configure a variable based on whether it's a placeholder
        and the _force_overwrite flag.
        """
        # If we're forcing overwrite, always configure
        if self._force_overwrite:
            return True

        # If it's a placeholder, we should configure it (placeholders should always be replaced)
        if is_placeholder(current_value):
            return True

        # Otherwise, skip configuration (keep existing non-placeholder value)
        return False

    def ask_overwrite_preference(self, existing_vars, force_prompt=False):
        """
        Ask user if they want to overwrite existing environment variables.
        Returns True if user wants to overwrite, False otherwise.

        Args:
            existing_vars: Dictionary of existing environment variables
            force_prompt: If True, always prompt user even if preference exists
        """
        # Check for saved preference (unless forcing prompt)
        if not force_prompt:
            config_mode = self.get_preference("configuration_mode")
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
                args = self.ctx.args
                original_cmd = "python run.py"
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
                self.save_preference("configuration_mode", "keep_existing")
                return False
            elif choice == "2":
                print(f"\n{C_ORANGE}🔄 Will reconfigure all environment variables.{C_RESET}")
                self.save_preference("configuration_mode", "reconfigure_everything")
                return True
            else:
                print(f"{C_RED}❌ Please enter 1 to keep existing config or 2 to reconfigure everything.{C_RESET}")
                print()

    # ------------------------------------------------------------------ #
    #  HuggingFace helpers                                                #
    # ------------------------------------------------------------------ #

    def _hf_check_repo(self, token, repo_id):
        """Check if a HuggingFace repo is accessible with the given token."""
        url = f"https://huggingface.co/api/models/{repo_id}"
        headers = {"Authorization": f"Bearer {token}"}
        try:
            if _HAS_REQUESTS:
                resp = _requests.get(url, headers=headers, timeout=10)
                return resp.status_code == 200
            else:
                req = _urllib_request.Request(url, headers=headers)
                resp = _urllib_request.urlopen(req, timeout=10)
                return resp.getcode() == 200
        except Exception:
            return False

    def check_hf_access(self, token):
        """
        Check if HuggingFace token has access to required models.

        Returns:
            bool: True if access is confirmed or check is skipped
        """
        if not token or is_placeholder(token):
            return False
        # Just verify token is non-empty (detailed check can be added later)
        return True

    # ------------------------------------------------------------------ #
    #  Main configuration flow                                            #
    # ------------------------------------------------------------------ #

    def configure_environment_sequentially(self, dev_mode=False, force_reconfigure=False, easy_mode=False):
        """
        Handles all environment configuration in a sequential, top-to-bottom flow.
        Reads existing .env file and prompts for missing or placeholder values.

        Args:
            dev_mode (bool): If True, show dev mode banner but still prompt for all values
            force_reconfigure (bool): If True, force reconfiguration and clear preferences
            easy_mode (bool): If True, use minimal prompts and defaults for quick setup
        """
        # Show first-time welcome if this is the first time
        if self.is_first_time_setup():
            self.display_first_time_welcome()

        # Clear preferences if reconfiguring
        if force_reconfigure:
            self.clear_preferences()

        env_file_exists = os.path.exists(ENV_FILE_PATH)

        if not env_file_exists:
            if os.path.exists(ENV_FILE_DEFAULT):
                print(f"{C_BLUE}📄 No .env file found. Creating one from the default template...{C_RESET}")
                shutil.copy(ENV_FILE_DEFAULT, ENV_FILE_PATH)
            else:
                print(f"{C_YELLOW}⚠️  Warning: .env.default not found. Creating an empty .env file.{C_RESET}")
                open(ENV_FILE_PATH, 'w').close()
            # When no .env file exists, we should configure everything without asking
            self._force_overwrite = True

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
        existing_vars = self.get_existing_env_vars()

        # Only ask about overwrite preference if .env file existed before (skip for easy mode)
        if not easy_mode and env_file_exists and existing_vars:
            self._force_overwrite = self.ask_overwrite_preference(existing_vars, force_prompt=force_reconfigure)
        else:
            # No need to ask, we're configuring everything
            if not env_file_exists:
                print(f"\n{C_CYAN}📝 Setting up TT Studio for the first time...{C_RESET}")
                self._force_overwrite = True
            elif easy_mode:
                # In easy mode with existing .env, don't force overwrite - let individual checks handle it
                print(f"\n{C_CYAN}📝 Using easy mode configuration...{C_RESET}")
                if env_file_exists and existing_vars:
                    self._force_overwrite = False
                else:
                    self._force_overwrite = True
            else:
                print(f"\n{C_CYAN}📝 No existing configuration found. Will configure all environment variables.{C_RESET}")
                self._force_overwrite = True

        print(f"\n{C_CYAN}📁 Setting core application paths...{C_RESET}")
        self.write_env_var("TT_STUDIO_ROOT", TT_STUDIO_ROOT, quote_value=False)
        self.write_env_var("HOST_PERSISTENT_STORAGE_VOLUME", os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume"), quote_value=False)
        self.write_env_var("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume", quote_value=False)
        self.write_env_var("BACKEND_API_HOSTNAME", "tt-studio-backend-api")

        print(f"\n{C_TT_PURPLE}{C_BOLD}--- 🔑  Security Credentials  ---{C_RESET}")

        # JWT_SECRET
        current_jwt = self.get_env_var("JWT_SECRET")
        if easy_mode:
            # In easy mode, use default value only if not already configured
            if self.should_configure_var("JWT_SECRET", current_jwt):
                self.write_env_var("JWT_SECRET", "test-secret-456")
                print("✅ JWT_SECRET set to default value (test-secret-456).")
            else:
                print("✅ JWT_SECRET already configured (keeping existing value).")
        elif self.should_configure_var("JWT_SECRET", current_jwt):
            if is_placeholder(current_jwt):
                print(f"🔄 JWT_SECRET has placeholder value '{current_jwt}' - configuring...")
            dev_default = "dev-jwt-secret-12345-not-for-production" if dev_mode else ""
            prompt_text = f"🔐 Enter JWT_SECRET (for authentication to model endpoints){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

            while True:
                val = getpass.getpass(prompt_text)
                if not val and dev_mode:
                    val = dev_default
                if val and val.strip():
                    self.write_env_var("JWT_SECRET", val)
                    print("✅ JWT_SECRET saved.")
                    break
                print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
        else:
            print(f"✅ JWT_SECRET already configured (keeping existing value).")

        # DJANGO_SECRET_KEY
        current_django = self.get_env_var("DJANGO_SECRET_KEY")
        if easy_mode:
            # In easy mode, use default value only if not already configured
            if self.should_configure_var("DJANGO_SECRET_KEY", current_django):
                self.write_env_var("DJANGO_SECRET_KEY", "django-insecure-default")
                print("✅ DJANGO_SECRET_KEY set to default value.")
            else:
                print("✅ DJANGO_SECRET_KEY already configured (keeping existing value).")
        elif self.should_configure_var("DJANGO_SECRET_KEY", current_django):
            if is_placeholder(current_django):
                print(f"🔄 DJANGO_SECRET_KEY has placeholder value '{current_django}' - configuring...")
            dev_default = "django-dev-secret-key-not-for-production-12345" if dev_mode else ""
            prompt_text = f"🔑 Enter DJANGO_SECRET_KEY (for Django backend security){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

            while True:
                val = getpass.getpass(prompt_text)
                if not val and dev_mode:
                    val = dev_default
                if val and val.strip():
                    self.write_env_var("DJANGO_SECRET_KEY", val)
                    print("✅ DJANGO_SECRET_KEY saved.")
                    break
                print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
        else:
            print(f"✅ DJANGO_SECRET_KEY already configured (keeping existing value).")

        # DOCKER_CONTROL_SERVICE_URL
        current_docker_url = self.get_env_var("DOCKER_CONTROL_SERVICE_URL")
        if easy_mode:
            # In easy mode, use default value only if not already configured
            if self.should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
                self.write_env_var("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
                print("✅ DOCKER_CONTROL_SERVICE_URL set to default value.")
            else:
                print("✅ DOCKER_CONTROL_SERVICE_URL already configured (keeping existing value).")
        elif self.should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
            if is_placeholder(current_docker_url):
                print(f"🔄 DOCKER_CONTROL_SERVICE_URL has placeholder value '{current_docker_url}' - configuring...")
            dev_default = "http://host.docker.internal:8002"
            prompt_text = f"🐳 Enter DOCKER_CONTROL_SERVICE_URL{' [default: ' + dev_default + ']' if dev_mode else ' (default: http://host.docker.internal:8002)'}: "
            val = input(prompt_text)
            if not val:
                val = dev_default
            self.write_env_var("DOCKER_CONTROL_SERVICE_URL", val)
            print("✅ DOCKER_CONTROL_SERVICE_URL saved.")
        else:
            print(f"✅ DOCKER_CONTROL_SERVICE_URL already configured (keeping existing value).")

        # DOCKER_CONTROL_JWT_SECRET
        current_docker_jwt = self.get_env_var("DOCKER_CONTROL_JWT_SECRET")
        if easy_mode:
            # In easy mode, use default value only if not already configured
            if self.should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
                self.write_env_var("DOCKER_CONTROL_JWT_SECRET", "test-secret-456")
                print("✅ DOCKER_CONTROL_JWT_SECRET set to default value (test-secret-456).")
            else:
                print("✅ DOCKER_CONTROL_JWT_SECRET already configured (keeping existing value).")
        elif self.should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
            if is_placeholder(current_docker_jwt):
                print(f"🔄 DOCKER_CONTROL_JWT_SECRET has placeholder value '{current_docker_jwt}' - configuring...")
            dev_default = "dev-docker-jwt-secret-12345-not-for-production" if dev_mode else ""
            prompt_text = f"🔐 Enter DOCKER_CONTROL_JWT_SECRET (for Docker Control Service authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

            while True:
                val = getpass.getpass(prompt_text)
                if not val and dev_mode:
                    val = dev_default
                if val and val.strip():
                    self.write_env_var("DOCKER_CONTROL_JWT_SECRET", val)
                    print("✅ DOCKER_CONTROL_JWT_SECRET saved.")
                    break
                print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
        else:
            print(f"✅ DOCKER_CONTROL_JWT_SECRET already configured (keeping existing value).")

        # TAVILY_API_KEY (optional)
        current_tavily = self.get_env_var("TAVILY_API_KEY")
        if easy_mode:
            # In easy mode, skip TAVILY_API_KEY only if not already configured
            if self.should_configure_var("TAVILY_API_KEY", current_tavily):
                self.write_env_var("TAVILY_API_KEY", "tavily-api-key-not-configured")
                print("✅ TAVILY_API_KEY skipped (easy mode).")
            else:
                print("✅ TAVILY_API_KEY already configured (keeping existing value).")
        elif self.should_configure_var("TAVILY_API_KEY", current_tavily):
            prompt_text = "🔍 Enter TAVILY_API_KEY for search agent (optional; press Enter to skip): "
            val = getpass.getpass(prompt_text)
            self.write_env_var("TAVILY_API_KEY", val or "")
            print("✅ TAVILY_API_KEY saved.")
        else:
            print(f"✅ TAVILY_API_KEY already configured (keeping existing value).")

        # HF_TOKEN
        current_hf = self.get_env_var("HF_TOKEN")
        if easy_mode:
            # In easy mode, only prompt if not already configured
            if self.should_configure_var("HF_TOKEN", current_hf):
                while True:
                    val = getpass.getpass("🤗 Enter HF_TOKEN (Hugging Face token): ")
                    if val and val.strip():
                        self.write_env_var("HF_TOKEN", val)
                        print("✅ HF_TOKEN saved.")
                        break
                    print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
            else:
                print(f"✅ HF_TOKEN already configured (keeping existing value).")
        elif self.should_configure_var("HF_TOKEN", current_hf):
            while True:
                val = getpass.getpass("🤗 Enter HF_TOKEN (Hugging Face token): ")
                if val and val.strip():
                    self.write_env_var("HF_TOKEN", val)
                    print("✅ HF_TOKEN saved.")
                    break
                print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
        else:
            print(f"✅ HF_TOKEN already configured (keeping existing value).")

        print(f"\n{C_TT_PURPLE}{C_BOLD}--- ⚙️  Application Configuration  ---{C_RESET}")

        # VITE_APP_TITLE
        current_title = self.get_env_var("VITE_APP_TITLE")
        if easy_mode:
            # In easy mode, use default value only if not already configured
            if self.should_configure_var("VITE_APP_TITLE", current_title):
                self.write_env_var("VITE_APP_TITLE", "Tenstorrent | TT Studio")
                print("✅ VITE_APP_TITLE set to default: Tenstorrent | TT Studio")
            else:
                print(f"✅ VITE_APP_TITLE already configured: {current_title}")
        elif self.should_configure_var("VITE_APP_TITLE", current_title):
            dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
            val = input(f"📝 Enter application title (default: {dev_default}): ") or dev_default
            self.write_env_var("VITE_APP_TITLE", val)
            print("✅ VITE_APP_TITLE saved.")
        else:
            print(f"✅ VITE_APP_TITLE already configured: {current_title}")

        print(f"\n{C_CYAN}{C_BOLD}------------------ Mode Selection ------------------{C_RESET}")

        # VITE_ENABLE_DEPLOYED
        current_deployed = self.get_env_var("VITE_ENABLE_DEPLOYED")
        if easy_mode:
            # In easy mode, disable AI Playground (use TT Studio mode) only if not already configured
            if self.should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
                self.write_env_var("VITE_ENABLE_DEPLOYED", "false", quote_value=False)
                print("✅ VITE_ENABLE_DEPLOYED set to false (TT Studio mode).")
            else:
                print(f"✅ VITE_ENABLE_DEPLOYED already configured: {current_deployed}")
        elif self.should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
            print("Enable AI Playground Mode? (Connects to external cloud models)")
            dev_default = "false" if dev_mode else "false"

            while True:
                val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
                if val in ["true", "false"]:
                    self.write_env_var("VITE_ENABLE_DEPLOYED", val, quote_value=False)
                    print("✅ VITE_ENABLE_DEPLOYED saved.")
                    break
                print(f"{C_RED}⛔ Invalid input. Please enter 'true' or 'false'.{C_RESET}")
        else:
            print(f"✅ VITE_ENABLE_DEPLOYED already configured: {current_deployed}")

        is_deployed_mode = parse_boolean_env(self.get_env_var("VITE_ENABLE_DEPLOYED"))
        print(f"🔹 AI Playground Mode is {'ENABLED' if is_deployed_mode else 'DISABLED'}")

        # VITE_ENABLE_RAG_ADMIN
        current_rag = self.get_env_var("VITE_ENABLE_RAG_ADMIN")
        if easy_mode:
            # In easy mode, disable RAG admin only if not already configured
            if self.should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
                self.write_env_var("VITE_ENABLE_RAG_ADMIN", "false", quote_value=False)
                print("✅ VITE_ENABLE_RAG_ADMIN set to false (easy mode).")
            else:
                print(f"✅ VITE_ENABLE_RAG_ADMIN already configured: {current_rag}")
        elif self.should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
            print("\nEnable RAG document management admin page?")
            dev_default = "false" if dev_mode else "false"

            while True:
                val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
                if val in ["true", "false"]:
                    self.write_env_var("VITE_ENABLE_RAG_ADMIN", val, quote_value=False)
                    print("✅ VITE_ENABLE_RAG_ADMIN saved.")
                    break
                print(f"{C_RED}⛔ Invalid input. Please enter 'true' or 'false'.{C_RESET}")
        else:
            print(f"✅ VITE_ENABLE_RAG_ADMIN already configured: {current_rag}")

        is_rag_admin_enabled = parse_boolean_env(self.get_env_var("VITE_ENABLE_RAG_ADMIN"))
        print(f"🔹 RAG Admin Page is {'ENABLED' if is_rag_admin_enabled else 'DISABLED'}")

        # RAG_ADMIN_PASSWORD (only if RAG is enabled, or set default in easy mode)
        current_rag_pass = self.get_env_var("RAG_ADMIN_PASSWORD")
        if easy_mode:
            # In easy mode, set a default value even if RAG is disabled, but only if not already configured
            if self.should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
                self.write_env_var("RAG_ADMIN_PASSWORD", "tt-studio-rag-admin-password")
                print("✅ RAG_ADMIN_PASSWORD set to default (easy mode).")
            else:
                print("✅ RAG_ADMIN_PASSWORD already configured (keeping existing value).")
        elif is_rag_admin_enabled:
            if self.should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
                dev_default = "dev-admin-123" if dev_mode else ""
                prompt_text = f"Enter RAG_ADMIN_PASSWORD{' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

                print("🔒 RAG admin is enabled. You must set a password.")
                while True:
                    val = getpass.getpass(prompt_text)
                    if not val and dev_mode:
                        val = dev_default
                    if val and val.strip():
                        self.write_env_var("RAG_ADMIN_PASSWORD", val)
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
                current_val = self.get_env_var(var_name)
                if self.should_configure_var(var_name, current_val):
                    self.write_env_var(var_name, "")
            print("✅ Cloud model variables set to empty defaults (easy mode).")
        elif is_deployed_mode:
            print(f"\n{C_TT_PURPLE}{C_BOLD}--- ☁️  AI Playground Model Configuration  ---{C_RESET}")
            print(f"{C_YELLOW}Note: These are optional. Press Enter to skip any field.{C_RESET}")

            for var_name, prompt, is_secret in cloud_vars:
                current_val = self.get_env_var(var_name)
                if self.should_configure_var(var_name, current_val):
                    if is_secret:
                        val = getpass.getpass(f"{prompt} (optional): ")
                    else:
                        val = input(f"{prompt} (optional): ")
                    self.write_env_var(var_name, val or "")
                    status = "saved" if val else "skipped (empty)"
                    print(f"✅ {var_name} {status}.")
                else:
                    print(f"✅ {var_name} already configured (keeping existing value).")
        else:
            print(f"\n{C_YELLOW}Skipping cloud model configuration (AI Playground mode is disabled).{C_RESET}")

        # Frontend configuration (always set in easy mode, optional otherwise)
        if easy_mode:
            current_frontend_host = self.get_env_var("FRONTEND_HOST")
            current_frontend_port = self.get_env_var("FRONTEND_PORT")
            current_frontend_timeout = self.get_env_var("FRONTEND_TIMEOUT")

            if self.should_configure_var("FRONTEND_HOST", current_frontend_host):
                self.write_env_var("FRONTEND_HOST", "localhost")
            if self.should_configure_var("FRONTEND_PORT", current_frontend_port):
                self.write_env_var("FRONTEND_PORT", "3000", quote_value=False)
            if self.should_configure_var("FRONTEND_TIMEOUT", current_frontend_timeout):
                self.write_env_var("FRONTEND_TIMEOUT", "60", quote_value=False)
            print("✅ Frontend configuration set to defaults (easy mode).")

        print(f"\n{C_GREEN}✅ Environment configuration complete.{C_RESET}")

    # ------------------------------------------------------------------ #
    #  Welcome banner                                                     #
    # ------------------------------------------------------------------ #

    def display_welcome_banner(self):
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
