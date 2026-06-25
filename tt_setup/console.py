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

from rich import box
from rich.console import Console, Group
from rich.panel import Panel
from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn
from rich.table import Table
from rich.text import Text
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


def is_verbose():
    """True when --verbose/-v is active. Lets legacy modules gate extra detail."""
    return VERBOSE


def _vdivider(height):
    """A full-height vertical divider for a two-column grid row (accent-colored)."""
    return "\n".join("[accent]│[/accent]" for _ in range(max(height, 1)))


def welcome_panel(title, left_lines, sections, logo=None):
    """Build the Claude-Code-style launch panel: title in the top border, an
    optional centered logo band, then a two-column body (left context | divider
    | headed right sections).

    - title: text shown in the top border (e.g. "TT Studio · main").
    - left_lines: list of Rich-markup strings stacked in the left column.
    - sections: list of (heading, [item, ...]) rendered in the right column,
      each heading bold-accent, items muted, separated by a thin rule.
    - logo: optional multi-line ASCII string, centered in accent above the body
      (rendered as plain Text so backslashes/brackets aren't parsed as markup).

    Markup-bearing content (left_lines/sections) must be markup-safe.
    """
    right_lines = []
    for i, (heading, items) in enumerate(sections):
        if i:
            right_lines.append("[muted]" + "─" * 28 + "[/muted]")
        right_lines.append(f"[bold accent]{heading}[/bold accent]")
        right_lines.extend(f"[muted]{item}[/muted]" for item in items)

    height = max(len(left_lines), len(right_lines), 1)
    left = list(left_lines) + [""] * (height - len(left_lines))
    right = right_lines + [""] * (height - len(right_lines))

    grid = Table.grid(padding=(0, 2))
    grid.add_column()
    grid.add_column()
    grid.add_column()
    grid.add_row("\n".join(left), _vdivider(height), "\n".join(right))

    if logo:
        body = Group(Text(logo, style="accent", justify="center"), "", grid)
    else:
        body = grid

    return Panel(
        body,
        title=f"[bold accent]{title}[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
    )


def ready_panel(title, rows, footer_lines=None):
    """Build the post-startup summary panel: title in the top border, an aligned
    label/value grid (endpoints, mode), plus optional muted footer lines.

    - rows: list of (label, value); labels muted, values in info (cyan).
    - footer_lines: list of Rich-markup strings shown under the grid.
    """
    grid = Table.grid(padding=(0, 3))
    grid.add_column()
    grid.add_column()
    for label, value in rows:
        grid.add_row(f"[muted]{label}[/muted]", f"[info]{value}[/info]")

    body = [grid]
    if footer_lines:
        body.append("")
        body.extend(footer_lines)

    return Panel(
        Group(*body),
        title=f"[bold accent]{title}[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
    )


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
    """Yielded by step(); lets a phase signal its outcome and attach a detail.

    - .fail()       → render ✗ (also implied by raising inside the block)
    - .skip(detail) → render ○ for a benign no-op (not an error)
    - .detail(text) → append a muted suffix to the ✓/○/✗ line (e.g. "3 removed")
    """
    def __init__(self):
        self.failed = False
        self.skipped = False
        self.detail_text = ""

    def fail(self):
        self.failed = True

    def skip(self, detail=""):
        self.skipped = True
        if detail:
            self.detail_text = detail

    def detail(self, text):
        self.detail_text = text or ""


def _render_result(label, handle):
    """Rich markup for a finished step line, reflecting fail/skip/detail state."""
    suffix = f"  [muted]{handle.detail_text}[/muted]" if handle.detail_text else ""
    if handle.failed:
        return f"[error]✗ {label}[/error]{suffix}"
    if handle.skipped:
        return f"[muted]○ {label}[/muted]{suffix}"
    return f"[success]✓[/success] {label}{suffix}"


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
            handle.failed = True
            _real_console.print(_render_result(label, handle))
            raise
        _real_console.print(_render_result(label, handle))
        return

    use_spinner = spinner and _real_console.is_terminal
    buf = io.StringIO()
    status = _real_console.status(f"[muted]{label}…[/muted]", spinner="dots") if use_spinner else None
    if status is not None:
        status.start()
    else:
        # static line (overwritten in place on a TTY by _finish)
        _real_console.print(f"[muted]{label}…[/muted]")

    def _finish():
        if status is not None:
            status.stop()
        elif _real_console.is_terminal:
            # overwrite the static "label…" line in place
            _real_console.file.write("\033[A\033[2K")
            _real_console.file.flush()
        _real_console.print(_render_result(label, handle))

    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            yield handle
    except BaseException:
        handle.failed = True
        _finish()
        sys.__stdout__.write(buf.getvalue())
        sys.__stdout__.flush()
        raise
    _finish()
    if handle.failed:
        sys.__stdout__.write(buf.getvalue())
        sys.__stdout__.flush()
    else:
        _log_detail(label, buf.getvalue())
