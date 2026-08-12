# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Portable CLI output layer — copy this file into a new project.

Everything a setup/launcher CLI needs to stay readable while it drives messy
tools: a theme, a capturing `step()`, a phase stepper, panels, an in-place
activity row, and a subprocess streamer that turns tool chatter into one live
line. Only dependency is `rich`.

    from console import (activity, console, note, notice_panel, phase,
                         ready_panel, run_with_activity, set_verbose,
                         show_detail, step)

    set_verbose("-v" in sys.argv)
    register_phases(["Checks", "Build", "Launch"])
    with phase("Checks"):
        with step("Docker") as s:
            s.detail("28.5.1")
    with phase("Build"):
        rc, out = run_with_activity(["docker", "compose", "pull"], label="Pulling images")

Adapt freely; the shapes matter more than the code. See SKILL.md for the rules
this implements and reference/patterns.md for the failure-handling patterns.
"""

import contextlib
import io
import shutil
import subprocess
import sys
import threading
import time
from rich.box import ROUNDED
from rich.console import Console
from rich.padding import Padding
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text
from rich.theme import Theme

# ── theme ────────────────────────────────────────────────────────────────────
# One palette, used by name. Swap the accent for your brand colour.
THEME = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "bold red",
    "muted": "dim",
    "accent": "color(99)",
    "accent.bold": "bold color(99)",
})

console = Console(theme=THEME, highlight=False, soft_wrap=False)
# A second console bound to the REAL stdout: writes here bypass step()'s capture,
# so spinners and progress bars stay visible inside a captured block.
_real_console = Console(theme=THEME, file=sys.__stdout__, highlight=False)

SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
PANEL_WIDTH = 78          # pin panels so a terminal resize can't reflow art
_lock = threading.RLock()  # serializes every raw escape write to the terminal

_VERBOSE = False
_IN_PHASE = False


def set_verbose(value):
    global _VERBOSE
    _VERBOSE = bool(value)


def is_verbose():
    return _VERBOSE


def in_phase():
    return _IN_PHASE


def show_detail():
    """The single folding predicate: gate every routine 'done' line on this.

    Inside a phase on a normal run the collapsed phase line is the confirmation,
    so routine output is hidden; `-v` un-hides it. Failures, prompts, and
    actionable warnings must NOT be gated on this.
    """
    return _VERBOSE or not _IN_PHASE


def _isatty():
    """True only for a genuine tty — stricter than Rich's is_terminal, which a
    forced-colour CI can flip true on a pipe."""
    try:
        return bool(sys.__stdout__) and sys.__stdout__.isatty()
    except Exception:
        return False


# ── formatting helpers ───────────────────────────────────────────────────────
def fmt_duration(seconds):
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m {int(seconds % 60)}s"


def fmt_bytes(num):
    """Decimal units, matching what Docker/curl report."""
    for unit, size in (("GB", 1e9), ("MB", 1e6), ("kB", 1e3)):
        if num >= size:
            return f"{num / size:.1f} {unit}"
    return f"{int(num)} B"


def progress_bar(done, total, width=14):
    """Determinate bar; empty string when the total is unknown (say so instead
    of faking a percentage)."""
    if total <= 0:
        return ""
    filled = max(0, min(width, round(width * done / total)))
    return "▕" + "█" * filled + "░" * (width - filled) + "▏"


# ── step(): one calm line per operation ──────────────────────────────────────
class _StepHandle:
    def __init__(self):
        self.failed = False
        self.skipped = False
        self.detail_text = ""
        self.start = time.monotonic()

    def fail(self):
        self.failed = True

    def skip(self, detail=""):
        self.skipped = True
        self.detail_text = detail or self.detail_text

    def detail(self, text):
        self.detail_text = text or ""


def _render_result(label, handle):
    suffix = f"  [muted]{handle.detail_text}[/muted]" if handle.detail_text else ""
    elapsed = time.monotonic() - handle.start
    if elapsed >= 0.8 and not handle.skipped:
        suffix += f"  [muted]{fmt_duration(elapsed)}[/muted]"
    if handle.failed:
        return f"[error]✗ {label}[/error]{suffix}"
    if handle.skipped:
        return f"[muted]○ {label}[/muted]{suffix}"
    return f"[success]✓[/success] {label}{suffix}"


@contextlib.contextmanager
def step(label, spinner=True, log_file=None):
    """Run an operation as a single line: `label…` (spinning) → `✓ label  1.2s`.

    The block's stdout/stderr are captured and revealed ONLY if it fails (or
    appended to `log_file` if given). Handle: .detail("28.5.1"), .skip("nothing
    to do"), .fail(). Pass spinner=False when the block may prompt — a spinner
    would fight the prompt for the row.
    """
    handle = _StepHandle()

    if _VERBOSE:                      # verbose: stream everything, still mark ✓/✗
        _real_console.print(f"[muted]{label}…[/muted]")
        try:
            yield handle
        except BaseException:
            handle.failed = True
            _real_console.print(_render_result(label, handle))
            raise
        _real_console.print(_render_result(label, handle))
        return

    buf = io.StringIO()

    def emit():
        _real_console.print(_render_result(label, handle))
        if handle.failed:             # failure: the captured detail is the evidence
            sys.__stdout__.write(buf.getvalue())
            sys.__stdout__.flush()
        elif log_file:
            try:
                with open(log_file, "a") as f:
                    f.write(buf.getvalue())
            except Exception:
                pass

    if spinner and _isatty():
        # A hand-rolled single-line spinner: rewrite the whole row every frame
        # (`\r\033[2K`), so any stray write beneath it self-heals on the next
        # tick, and erase the row before printing the result.
        stop = threading.Event()

        def spin():
            frame = 0
            f = _real_console.file
            while not stop.is_set():
                glyph = SPINNER_FRAMES[frame % len(SPINNER_FRAMES)]
                text = Text()
                text.append(f"{glyph} ", style="accent")
                text.append(f"{label}…", style="muted")
                text.no_wrap, text.overflow = True, "crop"
                with _lock:
                    with _real_console.capture() as cap:
                        _real_console.print(text, end="", crop=True)
                    f.write("\r\033[2K" + cap.get())
                    f.flush()
                frame += 1
                stop.wait(0.1)

        ticker = threading.Thread(target=spin, daemon=True)
        ticker.start()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                yield handle
        except BaseException:
            handle.failed = True
            raise
        finally:
            stop.set()
            ticker.join(timeout=0.5)
            with _lock:
                _real_console.file.write("\r\033[2K")
                _real_console.file.flush()
            emit()
        return

    _real_console.print(f"[muted]{label}…[/muted]")
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            yield handle
    except BaseException:
        handle.failed = True
        raise
    finally:
        if _real_console.is_terminal:
            _real_console.file.write("\033[A\033[2K")   # overwrite the "label…" row
            _real_console.file.flush()
        emit()


# ── phases: the run's spine ──────────────────────────────────────────────────
_phases = []        # [{"title": str, "status": "pending|active|done|failed"}]


def register_phases(titles):
    """Declare the run's phases once. A FIXED count, so `k/N` never drifts with
    flags — the user can trust the denominator."""
    global _phases
    _phases = [{"title": t, "status": "pending"} for t in titles]


def stepper_line():
    """`✓ Checks ── ◉ Build ── ○ Launch` — done / current / pending, where colour
    carries the progress (green fills in left to right)."""
    parts = []
    for i, p in enumerate(_phases):
        if p["status"] == "done":
            parts.append(f"[success]✓ {p['title']}[/success]")
        elif p["status"] == "active":
            parts.append(f"[accent.bold]◉ {p['title']}[/accent.bold]")
        elif p["status"] == "failed":
            parts.append(f"[error]✗ {p['title']}[/error]")
        else:
            parts.append(f"[dim]○ {p['title']}[/dim]")
        if i < len(_phases) - 1:
            parts.append("[success] ── [/success]" if p["status"] == "done" else "[dim] ── [/dim]")
    line = Text.from_markup("".join(parts))
    line.no_wrap, line.overflow = True, "crop"
    return line


@contextlib.contextmanager
def phase(title):
    """Bracket one phase: print the stepper, label the body with a rule, and
    collapse to `✓ Phase k/N · Title  1.2s` (or ✗ on an exception).

    Upgrade path: TT-Studio pins the stepper to row 1 with a DECSTBM scroll
    region (`\\033[3;{rows-1}r`) so it stays visible while the body scrolls
    underneath. Start with this simpler inline version; add the region only once
    the flow is settled, and always reset it (`\\033[r`) on every exit path.
    """
    global _IN_PHASE
    entry = next((p for p in _phases if p["title"] == title), None)
    if entry is None:
        _phases.append({"title": title, "status": "pending"})
        entry = _phases[-1]
    entry["status"] = "active"
    index, total = _phases.index(entry) + 1, len(_phases)
    start = time.monotonic()

    console.print(stepper_line())
    console.print(Rule(f"[bold accent]{title}[/bold accent]", align="left",
                       style="muted", characters="─"))
    _IN_PHASE = True
    try:
        yield entry
    except BaseException:
        entry["status"] = "failed"
        raise
    else:
        entry["status"] = "done"
    finally:
        _IN_PHASE = False
        marker = "[error]✗[/error]" if entry["status"] == "failed" else "[success]✓[/success]"
        console.print(f"{marker} [muted]Phase {index}/{total} ·[/muted] "
                      f"[bold accent]{title}[/bold accent]  "
                      f"[muted]{fmt_duration(time.monotonic() - start)}[/muted]")


def _body_print(renderable):
    """Print into the phase body without landing on the live activity row.

    The activity ticker leaves the cursor mid-row (no trailing newline), so any
    body print must erase that row first; the ticker repaints it on its next
    tick. Everything shares `_lock`, so the two writers can't interleave
    mid-escape-sequence.
    """
    with _lock:
        if activity.running() and _isatty():
            _real_console.file.write("\r\033[2K")
            _real_console.file.flush()
        console.print(renderable)


def note(text, marker="○", style="muted"):
    """A short note in the phase body's gutter — why something was skipped, what
    happens instead. Padded (not string-indented) so a wrapped line keeps the
    indent, and rendered as Text so tool-derived content can't trip markup."""
    prefix = f"{marker} " if marker else "  "
    _body_print(Padding(Text(f"{prefix}{text}", style=style), (0, 0, 0, 2)))


def milestone(text, style="success", marker="✓"):
    """One real milestone inside a phase body (`  ✓ chroma pulled`)."""
    _body_print(Padding(Text(f"{marker} {text}", style=style), (0, 0, 0, 2)))


# ── the pinned activity row ──────────────────────────────────────────────────
class _Activity:
    """One in-place line at the bottom: `⠹ <label>`. Proof of life during a long
    silent step, updated by a background ticker so it spins even when the tool
    prints nothing for minutes. TTY only; a no-op when piped."""

    def __init__(self):
        self.label = ""
        self._stop = None
        self._ticker = None
        self._frame = 0

    def start(self, label=""):
        self.label = label
        if not _isatty() or _VERBOSE or self._ticker is not None:
            return
        self._stop = threading.Event()
        self._ticker = threading.Thread(target=self._loop, daemon=True)
        self._ticker.start()

    def set(self, label):
        self.label = label or ""

    def running(self):
        return self._ticker is not None

    def _loop(self):
        f = _real_console.file
        while not self._stop.is_set():
            glyph = SPINNER_FRAMES[self._frame % len(SPINNER_FRAMES)]
            text = Text()
            text.append(f"{glyph} ", style="accent")
            text.append(self.label, style="muted")
            text.no_wrap, text.overflow = True, "crop"
            with _lock:
                with _real_console.capture() as cap:
                    _real_console.print(text, end="", crop=True)
                f.write("\r\033[2K" + cap.get())
                f.flush()
            self._frame += 1
            self._stop.wait(0.1)

    def stop(self):
        if self._stop is not None:
            self._stop.set()
        if self._ticker is not None and self._ticker is not threading.current_thread():
            self._ticker.join(timeout=0.5)
        self._ticker = self._stop = None
        if _isatty():
            with _lock:
                _real_console.file.write("\r\033[2K")
                _real_console.file.flush()


activity = _Activity()


def run_with_activity(cmd, cwd=None, env=None, label="Working", parse=None):
    """Stream a subprocess, keeping ONE live line instead of its output.

    `parse(line)` is your pure aggregator: return a string to update the activity
    label, a ("milestone", text) tuple to emit a ✓ line, or None to ignore. Every
    line is still collected and returned, so a failure can be diagnosed from the
    full output. Raw lines reach the terminal only under --verbose.

    Returns (returncode, full_output).
    """
    process = subprocess.Popen(
        cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, universal_newlines=True,
    )
    lines = []
    activity.start(label)
    try:
        for line in process.stdout:
            lines.append(line)
            if _VERBOSE:
                _body_print(Text(f"  {line.rstrip()}", style="dim"))
            result = parse(line) if parse else None
            if isinstance(result, tuple) and result and result[0] == "milestone":
                milestone(result[1])
            elif isinstance(result, str) and result:
                activity.set(result)
    finally:
        activity.stop()
    process.wait()
    return process.returncode, "".join(lines)


# ── cards ────────────────────────────────────────────────────────────────────
def notice_panel(title, lines, border_style="warning"):
    """Content-sized callout for warnings, errors, and diagnosis cards."""
    body = Text()
    for i, line in enumerate(lines):
        if i:
            body.append("\n")
        body.append_text(Text.from_markup(line) if isinstance(line, str) else line)
    return Panel(body, title=title, title_align="left", box=ROUNDED,
                 border_style=border_style, padding=(1, 2), expand=False)


def ready_panel(title, rows, footer_lines=()):
    """The end-of-run summary: endpoints, mode, and the hints that make the next
    action discoverable (stop / logs / info). Make it re-viewable behind a flag
    (`--info`) by extracting the renderer and probing live state — never by
    duplicating the assembly."""
    table = Table(box=None, show_header=False, pad_edge=False)
    table.add_column(style="muted", no_wrap=True)
    table.add_column()
    for row in rows:
        label, value = row[0], row[1]
        status = f"  [muted]{row[2]}[/muted]" if len(row) > 2 else ""
        table.add_row(label, f"{value}{status}")
    body = [table]
    if footer_lines:
        body.append(Text())
        for line in footer_lines:
            body.append(Text.from_markup(line))
    group = Table.grid()
    group.add_column()
    for item in body:
        group.add_row(item)
    return Panel(group, title=f"[bold accent]{title}[/bold accent]", title_align="left",
                 box=ROUNDED, border_style="accent", padding=(1, 2), width=PANEL_WIDTH)


def failure_card(name, diagnosis, log_file=None, consequence=None):
    """Render a diagnosis dict — {cause, detail, evidence, actions} — as the
    standard failure card. Build the dict in a pure function so the classification
    is unit-testable; see reference/patterns.md."""
    lines = [f"[error]{diagnosis['detail']}[/error]"]
    if diagnosis.get("evidence"):
        lines.append(f"[muted]Log · {diagnosis['evidence'][:120]}[/muted]")
    if consequence:
        lines += ["", f"[warning]{consequence}[/warning]"]
    lines += ["", "[info]Try:[/info]"]
    lines += [f"[muted]  {action}[/muted]" for action in diagnosis.get("actions", ())]
    if log_file and not any(log_file in a for a in diagnosis.get("actions", ())):
        lines.append(f"[muted]  tail -50 {log_file}[/muted]")
    return notice_panel(f"[error]{name} — {diagnosis['cause']}[/error]", lines,
                        border_style="error")


def terminal_width():
    return shutil.get_terminal_size(fallback=(80, 24)).columns
