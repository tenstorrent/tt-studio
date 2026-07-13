# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The calm per-step output primitive (step) + download progress bar."""

import contextlib
import io
import sys
import threading
import time
from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn
from rich.text import Text
from tt_setup.console._theme import _fmt_duration, _real_console, is_verbose
from tt_setup.console._stepper import _ChecklistController, _checklist, _stdout_isatty, _terminal_lock


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
        self.start = time.monotonic()

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
    # Append elapsed time only when meaningful, so fast steps stay clean. Skips
    # are benign no-ops, so they never get a duration.
    elapsed = time.monotonic() - handle.start
    if elapsed >= 0.8 and not handle.skipped:
        suffix += f"  [muted]{_fmt_duration(elapsed)}[/muted]"
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

    if is_verbose():
        _real_console.print(f"[muted]{label}…[/muted]")
        try:
            yield handle
        except BaseException:
            handle.failed = True
            _real_console.print(_render_result(label, handle))
            raise
        _real_console.print(_render_result(label, handle))
        return

    # Gate on the REAL stdout being a tty (stricter than Rich's is_terminal), and
    # never spin while the build pulse ticker owns fd 1 (they never overlap in
    # practice — build is Phase 4, steps are Phases 3/5 + --stop — but stay safe).
    use_spinner = spinner and _stdout_isatty() and not _checklist._pulse_active
    buf = io.StringIO()

    def _emit_result():
        # Print the ✓/○/✗ line; surface captured output on failure, else log it.
        _real_console.print(_render_result(label, handle))
        if handle.failed:
            sys.__stdout__.write(buf.getvalue())
            sys.__stdout__.flush()
        else:
            _log_detail(label, buf.getvalue())

    if use_spinner:
        # A deterministic hand-rolled single-line spinner. A background ticker writes
        # `\r\033[2K{frame} label…` (erase-the-whole-row every frame, so any stray
        # foreign write to fd 1 under the spinner self-heals next tick) with NO
        # trailing newline; on exit we erase the row with `\r\033[2K` and print the
        # ✓/○/✗ result. step() captures all stdout/stderr, so the spinner owns its
        # row uncontested. This replaces Rich's Live(transient=True), whose relative
        # cursor-walk transient-clear mis-clears — leaving a stray "⠋ label…" — the
        # moment anything scrolls fd 1 beneath it (the --stop dangling-line bug).
        stop_evt = threading.Event()

        def _spin():
            frame = 0
            f = _real_console.file
            while not stop_evt.is_set():
                glyph = _ChecklistController._PULSE[frame % len(_ChecklistController._PULSE)]
                # .append (not markup): `label` is code-literal, but keep the same
                # crop-safe path as the header so a long label never wraps the row.
                t = Text()
                t.append(f"{glyph} ", style="accent")
                t.append(f"{label}…", style="muted")
                with _terminal_lock():
                    f.write("\r\033[2K" + _checklist._render_ansi(t))
                    f.flush()
                frame += 1
                stop_evt.wait(0.1)

        ticker = threading.Thread(target=_spin, daemon=True)
        ticker.start()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                yield handle
        except BaseException:
            handle.failed = True
            raise
        finally:
            # Stop the ticker and erase its row deterministically BEFORE the result
            # prints — covers normal exit, exception, and Ctrl-C mid-spinner alike.
            stop_evt.set()
            ticker.join(timeout=0.5)
            with _terminal_lock():
                _real_console.file.write("\r\033[2K")
                _real_console.file.flush()
            _emit_result()
        return

    # Non-spinner: static "label…" line, overwritten in place on completion.
    _real_console.print(f"[muted]{label}…[/muted]")

    def _overwrite():
        if _real_console.is_terminal:
            _real_console.file.write("\033[A\033[2K")
            _real_console.file.flush()

    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            yield handle
    except BaseException:
        handle.failed = True
        _overwrite()
        _emit_result()
        raise
    _overwrite()
    _emit_result()

