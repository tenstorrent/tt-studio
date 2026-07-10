# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sudo authentication + privileged artifact removal helpers."""

import os
import subprocess
import shutil
from tt_setup.constants import *
from tt_setup.console import confirm, console


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
        console.print("[error]⛔ Error: sudo is not available on this system.[/error]")
        return False

    # First, check if sudo is already authenticated (non-interactive mode)
    if not force_prompt:
        check_result = subprocess.run(["sudo", "-n", "-v"], capture_output=True, text=True)
        if check_result.returncode == 0:
            return True

    console.print("[info]🔐 TT Inference Server setup requires sudo privileges. Please enter your password:[/info]")
    try:
        # Test sudo access - this will prompt for password if needed
        result = subprocess.run(["sudo", "-v"], check=True, capture_output=True, text=True)
        console.print("[success]✅ Sudo authentication successful.[/success]")
        return True
    except subprocess.CalledProcessError as e:
        console.print("[error]⛔ Error: Failed to authenticate with sudo[/error]")
        if e.returncode == 1:
            console.print("[warning]   This usually means the password was incorrect or sudo access was denied.[/warning]")
        return False
    except FileNotFoundError:
        console.print("[error]⛔ Error: sudo command not found[/error]")
        return False


def remove_artifact_with_sudo(directory_path, description="artifact directory"):
    """
    Attempt to remove a directory using sudo after user confirmation.

    Args:
        directory_path (str): Absolute path to directory to remove
        description (str): Human-readable description for user prompt

    Returns:
        bool: True if successfully removed, False if user declined or removal failed
    """
    # Check if directory exists
    if not os.path.exists(directory_path):
        return True

    # Check if sudo is available
    if not shutil.which("sudo"):
        console.print("[error]⛔ Error: sudo is not available on this system.[/error]")
        return False

    # Explain to user why sudo is needed
    console.print("")
    console.print(f"[warning]🔐 Permission issues prevent normal removal of {description}[/warning]")
    console.print(f"[muted]   Directory: {directory_path}[/muted]")
    console.print("[muted]   Sudo access is required to remove files with restricted permissions.[/muted]")

    # Prompt for confirmation
    try:
        if not confirm(f"Use sudo to remove {description}?", default=False):
            console.print("[warning]   Sudo removal declined by user.[/warning]")
            return False
    except KeyboardInterrupt:
        console.print("\n[warning]   Sudo removal cancelled by user.[/warning]")
        return False

    # Request sudo authentication first
    console.print("[muted]   Requesting sudo authentication...[/muted]")
    if not request_sudo_authentication():
        return False

    # Attempt sudo removal
    console.print(f"[muted]   Removing {description} with sudo...[/muted]")
    try:
        result = subprocess.run(
            ["sudo", "rm", "-rf", directory_path],
            capture_output=True,
            text=True,
            check=True
        )

        # Verify directory was removed
        if not os.path.exists(directory_path):
            return True
        else:
            console.print("[error]⛔ Directory still exists after sudo removal[/error]")
            return False

    except subprocess.CalledProcessError as e:
        console.print(f"[error]⛔ Error: Sudo removal failed: {e}[/error]")
        if e.stderr:
            console.print(f"[muted]   {e.stderr}[/muted]")
        return False
    except FileNotFoundError:
        console.print("[error]⛔ Error: sudo or rm command not found[/error]")
        return False
    except KeyboardInterrupt:
        console.print("\n[warning]   Sudo removal cancelled by user.[/warning]")
        return False
