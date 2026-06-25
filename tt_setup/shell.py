# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Low-level shell/output helpers: command execution, preflight checks, banners."""

import json
import os
import shutil
import signal
import sys
import subprocess
import socket
from tt_setup.constants import *
from tt_setup.console import console, notice_panel, welcome_panel


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
        console.print(f"[error]⛔ Error: Command not found: {e.filename}[/error]")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        # Don't exit if check=False, just return the result
        if check:
            console.print(f"[error]⛔ Error executing command: {cmd_str}[/error]")
            if capture_output:
                console.print(f"[error]Stderr: {e.stderr}[/error]")
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
        console.print(f"[error]⛔ Python {major}.{minor} detected. TT Studio requires Python 3.8+.[/error]")
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
        console.print(notice_panel(
            "[bold]⚠  Pre-flight warnings[/bold]",
            [f"[warning]• {w}[/warning]" for w in warnings],
            border_style="warning",
        ))

    return True


def check_tt_smi(timeout=20):
    """Run `tt-smi -s` as a fast preflight health probe for Tenstorrent devices.

    Mirrors board_control.services.get_tt_smi_data: spawns tt-smi in its own
    process group so a hung call can be killed cleanly. Returns a tuple
    (status, detail) where status is "ok" or "bad". On success, detail is a
    short "N device(s)" summary (or "" if unknown); on failure it's a short
    reason. NEVER raises — callers can treat this as a non-fatal check.
    """
    proc = None
    try:
        proc = subprocess.Popen(
            ["tt-smi", "-s"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            preexec_fn=os.setsid if hasattr(os, "setsid") else None,
        )
        try:
            stdout, _stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                if hasattr(os, "killpg"):
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                else:
                    proc.kill()
            except Exception:
                pass
            return ("bad", f"timed out after {timeout}s")

        if proc.returncode != 0:
            return ("bad", f"exit {proc.returncode}")

        try:
            data = json.loads(stdout)
        except (ValueError, TypeError):
            return ("bad", "unreadable output")

        try:
            n = len(data.get("device_info", []) or [])
            detail = f"{n} device(s)" if n else ""
        except Exception:
            detail = ""
        return ("ok", detail)
    except Exception:
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
        return ("bad", "unreadable output")


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
    # Keep the right column terse — labels + value, no prose. These aren't
    # clickable links, so there's nothing to explain.
    sections = [
        ("Getting started", [
            f"{'Open':<9}http://localhost:3000",
            f"{'Stop':<9}python run.py --stop",
        ]),
    ]
    title = f"TT Studio · {branch}" if branch else "TT Studio"

    console.print()
    console.print(welcome_panel(
        title, left, sections,
        logos=[TENSTORRENT_ASCII_ART],
        tagline=["[bold accent]TT Studio[/bold accent][muted]  ·  AI model dev & deployment[/muted]"],
    ))
    console.print()
