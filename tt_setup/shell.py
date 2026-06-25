# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Low-level shell/output helpers: command execution, preflight checks, banners."""

import os
import sys
import subprocess
import socket
from tt_setup.constants import *
from tt_setup.console import console, welcome_panel


def clear_lines(n):
    """Move cursor up n lines and clear them. Used to replace transient progress output."""
    if n <= 0:
        return
    for _ in range(n):
        sys.stdout.write("\033[A\033[2K")  # move up + clear line
    sys.stdout.flush()


def run_command(command, check=False, cwd=None, capture_output=True, shell=False):
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


def run_preflight_checks():
    """
    Run fast system checks before startup. Only prints output on warnings/failures.
    Returns True if checks pass (warnings are OK).
    """
    warnings = []

    # 1. Python version
    major, minor = sys.version_info[:2]
    if (major, minor) < (3, 8):
        print(f"{C_RED}⛔ Python {major}.{minor} detected. TT Studio requires Python 3.8+.{C_RESET}")
        sys.exit(1)

    # 2. Disk space
    try:
        statvfs = os.statvfs(TT_STUDIO_ROOT)
        free_gb = (statvfs.f_bavail * statvfs.f_frsize) / (1024 ** 3)
        if free_gb < 5:
            warnings.append(f"Low disk space: {free_gb:.1f} GB free (5 GB recommended). Run: docker system prune -af")
    except Exception:
        pass

    # 3. Available memory (Linux only)
    try:
        if OS_NAME == "Linux":
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemAvailable:"):
                        free_ram_gb = int(line.split()[1]) / (1024 ** 2)
                        if free_ram_gb < 4:
                            warnings.append(f"Low RAM: {free_ram_gb:.1f} GB available (4 GB recommended)")
                        break
    except Exception:
        pass

    # 4. Docker Hub connectivity
    try:
        with socket.create_connection(("registry.hub.docker.com", 443), timeout=5):
            pass
    except OSError:
        warnings.append("Cannot reach Docker Hub — builds may fail if images need pulling")

    if warnings:
        print(f"\n{C_YELLOW}⚠️  Pre-flight warnings:{C_RESET}")
        for w in warnings:
            print(f"  {C_YELLOW}• {w}{C_RESET}")
        print()

    return True


def copy_to_clipboard(text):
    """Copy text to system clipboard. Returns True if successful."""
    try:
        if OS_NAME == "Darwin":
            process = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
            process.communicate(text.encode('utf-8'))
            return process.returncode == 0
        elif OS_NAME == "Linux":
            for cmd in [['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]:
                try:
                    process = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                    process.communicate(text.encode('utf-8'))
                    if process.returncode == 0:
                        return True
                except FileNotFoundError:
                    continue
            return False
        elif OS_NAME == "Windows":
            process = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=True)
            process.communicate(text.encode('utf-16'))
            return process.returncode == 0
        return False
    except Exception:
        return False


def _git_value(args):
    """Best-effort `git <args>` output (stripped), or '' if unavailable."""
    try:
        result = subprocess.run(["git", "-C", TT_STUDIO_ROOT, *args],
                                capture_output=True, text=True, check=False)
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def display_welcome_banner(dev_mode=False):
    """Show the launch panel — Claude-Code-style: name + version in the top
    border, a two-column body (greeting + logo + context | getting-started)."""
    # Clear screen for a clean splash effect (only when interactive).
    if sys.stdout.isatty():
        os.system('cls' if OS_NAME == 'Windows' else 'clear')

    branch = _git_value(["rev-parse", "--abbrev-ref", "HEAD"])
    user_name = _git_value(["config", "user.name"])
    name = user_name.split()[0] if user_name else ""
    home = os.path.expanduser("~")
    cwd = TT_STUDIO_ROOT.replace(home, "~", 1) if TT_STUDIO_ROOT.startswith(home) else TT_STUDIO_ROOT

    greeting = f"Welcome back, {name}!" if name else "Welcome to TT Studio!"
    mode = "Local + Dev" if dev_mode else "Local"

    left = [
        f"[bold accent]{greeting}[/bold accent]",
        "",
        f"[muted]{mode}[/muted]",
        f"[muted]{cwd}[/muted]",
    ]
    sections = [
        ("Getting started", [
            "Open http://localhost:3000",
            "python run.py --cleanup  to stop",
            "-v  for verbose output",
        ]),
        ("Docs", ["dev-docs/  ·  README.md"]),
    ]
    title = f"TT Studio · {branch}" if branch else "TT Studio"

    console.print()
    console.print(welcome_panel(title, left, sections, logo=TENSTORRENT_ASCII_ART))
    console.print()
