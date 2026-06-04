# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Shared virtualenv helpers for run.py."""

import os
import shutil
import platform

OS_NAME = platform.system()


def is_venv_valid(venv_dir):
    """
    Return (valid: bool, reason: str|None).
    Detects stale shebangs from repo moves without spawning a subprocess.
    """
    pip = os.path.join(venv_dir, "Scripts" if OS_NAME == "Windows" else "bin", "pip")
    if not os.path.exists(pip):
        return False, f"pip not found at {pip}"
    try:
        with open(pip) as f:
            shebang = f.readline().strip()
        if shebang.startswith("#!"):
            interp = shebang[2:].strip()
            if not os.path.exists(interp):
                return False, f"shebang interpreter missing: {interp}"
    except Exception:
        pass  # unreadable script; let execution fail naturally
    return True, None


def recreate_venv_if_stale(venv_dir, color_yellow="", color_reset=""):
    """
    If the venv at venv_dir is missing or has a stale shebang, delete it and
    return True (signals the caller to recreate it). Returns False if healthy.
    """
    valid, reason = is_venv_valid(venv_dir)
    if not valid:
        if os.path.exists(venv_dir):
            print(f"{color_yellow}⚠️  Virtualenv is stale ({reason}). Recreating...{color_reset}")
            shutil.rmtree(venv_dir)
        return True  # needs creation
    return False  # valid, no action needed


def print_manual_fix_steps(service_dir, req_file, color_yellow="", color_reset=""):
    """Print copy-pasteable fix steps when auto-recreation fails."""
    print(f"{color_yellow}   To fix manually, run:{color_reset}")
    print(f"     cd {service_dir}")
    print(f"     rm -rf .venv")
    print(f"     python3 -m venv .venv")
    print(f"     .venv/bin/python -m pip install -r {req_file}")
