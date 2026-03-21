# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import sys
import subprocess
import shutil

from _runner.constants import (
    C_RED, C_GREEN, C_YELLOW, C_CYAN, C_RESET,
)


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


def clear_lines(n):
    """Clear n lines above the cursor in the terminal."""
    for _ in range(n):
        sys.stdout.write("\033[F\033[K")
    sys.stdout.flush()


def copy_to_clipboard(text):
    """Copy text to system clipboard if possible."""
    try:
        if shutil.which("xclip"):
            proc = subprocess.Popen(["xclip", "-selection", "clipboard"], stdin=subprocess.PIPE)
            proc.communicate(input=text.encode())
            return True
        elif shutil.which("xsel"):
            proc = subprocess.Popen(["xsel", "--clipboard", "--input"], stdin=subprocess.PIPE)
            proc.communicate(input=text.encode())
            return True
        elif shutil.which("pbcopy"):
            proc = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
            proc.communicate(input=text.encode())
            return True
    except Exception:
        pass
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


def should_configure_var(var_name, current_value, force_overwrite=False):
    """
    Determine if we should configure a variable based on whether it's a placeholder
    and the force_overwrite flag.
    """
    # If we're forcing overwrite, always configure
    if force_overwrite:
        return True

    # If it's a placeholder, we should configure it (placeholders should always be replaced)
    if is_placeholder(current_value):
        return True

    # Otherwise, skip configuration (keep existing non-placeholder value)
    return False


def parse_boolean_env(raw_value):
    """Parse boolean values from .env file"""
    return str(raw_value).lower().strip().strip('"\'') in ['true', '1', 't', 'y', 'yes']


def suggest_pip_fixes():
    """Print common pip-related fix suggestions."""
    print(f"{C_YELLOW}💡 Common pip fixes:{C_RESET}")
    print(f"  • Upgrade pip: {C_CYAN}pip install --upgrade pip{C_RESET}")
    print(f"  • Use virtual env: {C_CYAN}python3 -m venv .venv && source .venv/bin/activate{C_RESET}")
    print(f"  • Check Python version: {C_CYAN}python3 --version{C_RESET}")


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


def remove_artifact_with_sudo(directory_path, description="directory"):
    """
    Remove a directory, using sudo if needed.

    Args:
        directory_path: Path to remove
        description: Human-readable name for messages

    Returns:
        bool: True if removed successfully
    """
    if not os.path.exists(directory_path):
        return True
    try:
        import shutil as _shutil
        _shutil.rmtree(directory_path)
        print(f"{C_GREEN}✅ Removed {description}: {directory_path}{C_RESET}")
        return True
    except PermissionError:
        try:
            result = subprocess.run(["sudo", "rm", "-rf", directory_path],
                                    capture_output=True, text=True, check=False)
            if result.returncode == 0:
                print(f"{C_GREEN}✅ Removed {description} (with sudo): {directory_path}{C_RESET}")
                return True
            else:
                print(f"{C_RED}⛔ Failed to remove {description}: {result.stderr}{C_RESET}")
                return False
        except Exception as e:
            print(f"{C_RED}⛔ Error removing {description}: {e}{C_RESET}")
            return False
    except Exception as e:
        print(f"{C_RED}⛔ Error removing {description}: {e}{C_RESET}")
        return False
