# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sudo authentication + privileged artifact removal helpers."""

import os
import subprocess
import shutil
from tt_setup.constants import *
from tt_setup.console import console
from tt_setup.cleanup._resource_ops import _remove_path_with_docker


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
    """Remove a directory whose files were left with restricted permissions by a
    container, using an ephemeral cleanup container (no host sudo). Name retained
    for existing call sites. Returns True if removed (or already absent).
    """
    if not os.path.exists(directory_path):
        return True
    console.print(f"[muted]   Removing {description} via cleanup container...[/muted]")
    return _remove_path_with_docker(directory_path)
