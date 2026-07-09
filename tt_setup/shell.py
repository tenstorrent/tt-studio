# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Low-level shell/output helpers: command execution, preflight checks, banners."""

import json
import os
import signal
import sys
import subprocess
import socket
from tt_setup.constants import *
from tt_setup.console import console, notice_panel, sticky_active, welcome_panel


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


# QB2 (Blackhole QuietBox) is the P300x2 board (2× P300 cards = 4 chips); the
# 4-card variant reports P300Cx4. Kept as a set so callers can verify a
# configured "QB2 mode" against what tt-smi actually reports.
QB2_BOARD_TYPES = {"P300x2", "P300Cx4"}

# Internal board type -> friendly system name for the ready panel. Mirrors the
# board strings produced by _classify_boards (which mirrors
# board_control.services.get_board_type). Types not listed fall back to the
# board string itself.
_BOARD_DISPLAY_NAMES = {
    "P300x2": "QuietBox (QB2)",
    "P300Cx4": "QuietBox (QB2)",
    "T3K": "T3K",
    "N150X4": "N150 ×4",
    "N150": "N150",
    "N300": "N300",
    "P150X8": "P150 ×8",
    "P150X4": "P150 ×4",
    "P150": "P150",
    "P300": "P300",
    "P100": "P100",
    "E150": "E150",
    "GALAXY_T3K": "Galaxy (T3K)",
    "GALAXY": "Galaxy",
}


def _classify_boards(device_info):
    """Map a tt-smi `device_info` list to an internal board-type string.

    Mirrors board_control.services.get_board_type (which runs in-container and
    can't be imported host-side): strip the trailing " local"/" remote"
    qualifier, require a single homogeneous board type, then substring-match the
    raw type + device count. Returns "" when the type is unknown or the devices
    aren't a single board family (so callers fall back to a plain count).
    """
    try:
        raw_types = [str((d or {}).get("board_info", {}).get("board_type", "") or "")
                     for d in (device_info or [])]
    except Exception:
        return ""
    # Strip the " local"/" remote" suffix tt-smi appends to each board_type.
    filtered = {t.rsplit(" ", 1)[0] for t in raw_types if t}
    if len(filtered) != 1:
        return ""  # no devices, or a mix of board types → can't classify
    raw = filtered.pop().lower()
    n = len(device_info or [])
    if "n150" in raw:
        return "N150X4" if n >= 4 else "N150"
    if "n300" in raw:
        return "T3K" if n >= 4 else "N300"
    if "p300" in raw:
        return "P300Cx4" if n >= 8 else "P300x2" if n >= 4 else "P300"
    if "p150" in raw:
        return "P150X8" if n >= 8 else "P150X4" if n >= 4 else "P150"
    if "p100" in raw:
        return "P100"
    if "e150" in raw:
        return "E150"
    if "galaxy" in raw:
        return "GALAXY_T3K" if "t3k" in raw else "GALAXY"
    return ""


def describe_board(board_type):
    """Friendly system name for an internal board type (e.g. "QuietBox (QB2)"),
    or None when there's nothing to classify (caller falls back to the count)."""
    if not board_type:
        return None
    return _BOARD_DISPLAY_NAMES.get(board_type, board_type)


def resolve_hardware_label(tt_status, detail, board_type, qb2_configured, hw_present=False):
    """Build the ready-panel "Hardware" label + an optional problem warning.

    Pure/testable (no I/O). Inputs are the check_tt_smi() result plus whether QB2
    is configured (qb2_configured, from IS_QB2) and whether /dev/tenstorrent
    exists (hw_present).

    Returns (label, warning): `warning` is None normally, or a short problem
    string when QB2 is configured but the hardware doesn't confirm it — the
    caller surfaces that as a notice + a "Needs attention" recap note. QB2 is a
    *claim* we verify against tt-smi, not a label we trust blindly.
    """
    # Base label from what tt-smi actually reports.
    if tt_status == "ok":
        system = describe_board(board_type)
        base = f"{system} · {detail}" if system else (detail or "Tenstorrent device detected")
    elif tt_status == "bad":
        base = "tt-smi couldn't read the device"
    elif hw_present:
        base = "Tenstorrent device detected"
    else:
        base = "No accelerator (remote/cloud mode)"

    if not qb2_configured:
        return (base, None)

    # QB2 is configured → verify it against tt-smi.
    if tt_status == "ok" and board_type in QB2_BOARD_TYPES:
        return (f"QuietBox (QB2) · {detail}", None)          # confirmed
    if tt_status == "ok" and board_type:
        return (
            f"⚠ Configured as QB2 but found {board_type}",
            f"This machine is set up as a QB2 (IS_QB2=true), but tt-smi reports a "
            f"{board_type} board — the system may be misconfigured or not a QB2.",
        )
    # tt-smi unreadable / missing / unclassifiable → can't confirm QB2.
    return (
        "⚠ Configured as QB2 but tt-smi couldn't confirm it",
        "This machine is set up as a QB2 (IS_QB2=true), but tt-smi couldn't confirm "
        "a QB2 (P300x2) board — check your Tenstorrent tooling / hardware.",
    )


def check_tt_smi(timeout=20):
    """Run `tt-smi -s` as a fast preflight health probe for Tenstorrent devices.

    Mirrors board_control.services.get_tt_smi_data: spawns tt-smi in its own
    process group so a hung call can be killed cleanly. Returns a tuple
    (status, detail, board_type) where status is "ok" or "bad". On success,
    detail is a short "N device(s)" summary (or "" if unknown) and board_type is
    the classified internal board string (e.g. "P300x2") or "" if unclassifiable;
    on failure detail is a short reason and board_type is "". NEVER raises —
    callers can treat this as a non-fatal check.
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
            return ("bad", f"timed out after {timeout}s", "")

        if proc.returncode != 0:
            return ("bad", f"exit {proc.returncode}", "")

        try:
            data = json.loads(stdout)
        except (ValueError, TypeError):
            return ("bad", "unreadable output", "")

        try:
            device_info = data.get("device_info", []) or []
            n = len(device_info)
            detail = f"{n} device(s)" if n else ""
            board_type = _classify_boards(device_info)
        except Exception:
            detail = ""
            board_type = ""
        return ("ok", detail, board_type)
    except Exception:
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
        return ("bad", "unreadable output", "")


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
    # Clear screen for a clean splash effect (only when interactive). Skip it when
    # the sticky-top stepper region is installed — it already cleared the screen,
    # and a `clear` here would reset its scroll region.
    if sys.stdout.isatty() and not sticky_active():
        os.system('cls' if OS_NAME == 'Windows' else 'clear')

    branch = _git_value(["rev-parse", "--abbrev-ref", "HEAD"])
    user_name = _git_value(["config", "user.name"])
    name = user_name.split()[0] if user_name else ""
    home = os.path.expanduser("~")
    cwd = TT_STUDIO_ROOT.replace(home, "~", 1) if TT_STUDIO_ROOT.startswith(home) else TT_STUDIO_ROOT

    greeting = f"Welcome back, {name}!" if name else "Welcome to TT Studio!"

    # Keep the banner lean: greeting + repo path only. Mode/context now lives in
    # the sticky progress header, and host OS / artifact version were noise here.
    left = [
        f"[bold accent]{greeting}[/bold accent]",
        "",
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
