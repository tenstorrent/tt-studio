# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared Rich consoles + verbose flag + duration formatting."""

import sys
from rich.console import Console
from rich.theme import Theme


TT_THEME = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "bold red",
    "muted": "dim",
    "tt": "magenta",
    # Brand accent — matches the legacy C_TT_PURPLE (\033[38;5;99m). Used for
    # panel borders/titles so the launcher reads as one cohesive theme.
    "accent": "color(99)",
    # Bold accent as a single theme style. Rich can't resolve the markup combo
    # "[bold accent]" (a bold modifier + a *theme* style name), so use this named
    # style where a bold-accent span is needed (e.g. the active stepper node).
    "accent.bold": "bold color(99)",
})


console = Console(theme=TT_THEME)


# A console bound to the REAL terminal, unaffected by stdout redirection. Used so
# spinners / download bars still animate while a phase's stdout is captured.
_real_console = Console(theme=TT_THEME, file=sys.__stdout__)


VERBOSE = False


def set_verbose(value):
    """Enable/disable verbose mode (verbose streams all phase output, no capture)."""
    global VERBOSE
    VERBOSE = bool(value)


def real_console():
    """Console bound to the real terminal (survives step()'s stdout capture)."""
    return _real_console


def progress_status(label):
    """A transient live spinner bound to the real terminal — a Rich-native
    replacement for hand-rolled `\\r`/escape-code progress loops.

    Use as a context manager and update the message as work proceeds:

        with progress_status("Waiting for backend…") as status:
            ...
            status.update("Waiting for backend… (12s)")

    Renders via the real terminal so it survives step()'s stdout capture, and
    auto-disables (no spinner, no escape codes) on a non-TTY / piped log.
    """
    return _real_console.status(f"[muted]{label}[/muted]", spinner="dots")


def is_verbose():
    """True when --verbose/-v is active. Lets legacy modules gate extra detail."""
    return VERBOSE


def _fmt_duration(seconds):
    """Compact human duration for collapsed phase/step lines: '4.2s', '1m 03s'."""
    seconds = max(0.0, float(seconds))
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, secs = divmod(int(round(seconds)), 60)
    return f"{minutes}m {secs:02d}s"

