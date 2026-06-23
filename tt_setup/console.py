# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared Rich console + calm phase output for tt-studio.

`console` is the single Rich console all modules render through. `step()` gives
the apt-style startup UX: a muted `label…` while a phase runs (its chatter
captured to startup.log), collapsing to `✓ label` — or `✗ label` plus the
captured detail on failure. `--verbose` (via set_verbose) streams everything.

The legacy ANSI `C_*` constants in tt_setup.constants still work; this module is
for structured output (progress, status, tables, tracebacks) and new code.
"""

import contextlib
import io
import sys

from rich.console import Console
from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn
from rich.theme import Theme

TT_THEME = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "bold red",
    "muted": "dim",
    "tt": "magenta",
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


def download_with_progress(url, dest, label="Downloading"):
    """urlretrieve `url` -> `dest` showing a Rich download bar on the real terminal.

    Renders via the real-terminal console so the bar is visible even inside a
    captured step(). Use step(..., spinner=False) around callers so the spinner's
    Live display doesn't collide with this bar's Live display.
    """
    import urllib.request

    progress = Progress(
        TextColumn(f"  [info]{label}[/info]"),
        BarColumn(bar_width=24),
        DownloadColumn(),
        TimeRemainingColumn(),
        console=_real_console,
        transient=True,
    )
    with progress:
        task = progress.add_task("", total=None)

        def _hook(block_num, block_size, total_size):
            if total_size and total_size > 0:
                progress.update(task, total=total_size)
            progress.update(task, completed=block_num * block_size)

        urllib.request.urlretrieve(url, dest, reporthook=_hook)


class _StepHandle:
    """Yielded by step(); call .fail() for phases that signal failure via return value."""
    def __init__(self):
        self.failed = False

    def fail(self):
        self.failed = True


def _log_detail(label, text):
    text = (text or "").strip()
    if not text:
        return
    try:
        from tt_setup.logging import startup_log
        startup_log.step(label, "DETAIL", text[:4000])
    except Exception:
        pass


@contextlib.contextmanager
def step(label, spinner=True):
    """Run a phase as a single calm line.

    Default: print a muted `label…` (with a live spinner on a TTY), capture the
    phase's stdout/stderr to startup.log, and collapse to `✓ label` on success.
    On an exception or an explicit handle.fail(), print `✗ label` and surface the
    captured detail. Set spinner=False for phases that may prompt for a sudo
    password (a live spinner would clash with the prompt).

    With VERBOSE, nothing is captured — output streams live and we still mark ✓/✗.
    """
    handle = _StepHandle()

    if VERBOSE:
        _real_console.print(f"[muted]{label}…[/muted]")
        try:
            yield handle
        except BaseException:
            _real_console.print(f"[error]✗ {label}[/error]")
            raise
        _real_console.print(
            f"[error]✗ {label}[/error]" if handle.failed else f"[success]✓[/success] {label}"
        )
        return

    use_spinner = spinner and _real_console.is_terminal
    buf = io.StringIO()
    status = _real_console.status(f"[muted]{label}…[/muted]", spinner="dots") if use_spinner else None
    if status is not None:
        status.start()
    else:
        # static line (overwritten in place on a TTY by _finish)
        _real_console.print(f"[muted]{label}…[/muted]")

    def _finish(ok):
        if status is not None:
            status.stop()
        elif _real_console.is_terminal:
            # overwrite the static "label…" line in place
            _real_console.file.write("\033[A\033[2K")
            _real_console.file.flush()
        if ok:
            _real_console.print(f"[success]✓[/success] {label}")
        else:
            _real_console.print(f"[error]✗ {label}[/error]")

    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            yield handle
    except BaseException:
        _finish(False)
        sys.__stdout__.write(buf.getvalue())
        sys.__stdout__.flush()
        raise
    if handle.failed:
        _finish(False)
        sys.__stdout__.write(buf.getvalue())
        sys.__stdout__.flush()
    else:
        _finish(True)
        _log_detail(label, buf.getvalue())
