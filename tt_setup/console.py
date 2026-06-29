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
import shutil
import sys
import time

from rich import box
from rich.console import Console, Group
from rich.panel import Panel
from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn
from rich.prompt import Confirm, Prompt
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


_IN_PHASE = False        # True while a phase spinner is active
_active_phase = None     # the running phase handle (so error paths can stop it)


def _fmt_duration(seconds):
    """Compact human duration for collapsed phase/step lines: '4.2s', '1m 03s'."""
    seconds = max(0.0, float(seconds))
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, secs = divmod(int(round(seconds)), 60)
    return f"{minutes}m {secs:02d}s"


def in_phase():
    """True while a phase() spinner is active. Lets routine success output stay
    quiet (the single collapsed phase line covers it); warnings/errors/prompts
    should still print regardless."""
    return _IN_PHASE


def show_detail():
    """Whether to print routine 'done' status (service-ready lines, freed-port
    breakdown, cached notes, …). Hidden when folded inside a phase on a normal
    run; shown when --verbose un-hides it, or when not inside a phase. Failures,
    prompts, and actionable warnings should print unconditionally (not via this)."""
    return VERBOSE or not _IN_PHASE


# The startup roadmap — single source of truth for the steps panel, the sticky
# header stepper, and register_setup_phases(). (title, one-line description).
SETUP_PHASES = [
    ("Checks",    "system, hardware, Docker & update freshness"),
    ("Configure", "environment, secrets, network & ports"),
    ("Services",  "Docker-control & the inference-server artifact"),
    ("Build",     "build & start the containers"),
    ("Launch",    "inference-server env & process start"),
]


def steps_panel(phases=None, context=None):
    """A compact upfront overview of the run's steps (shown once, may scroll away):
    a numbered title + one-line description per step, plus optional context lines."""
    phases = phases or SETUP_PHASES
    grid = Table.grid(padding=(0, 2))
    grid.add_column(justify="right")   # number
    grid.add_column()                  # title
    grid.add_column()                  # description
    for i, (title, desc) in enumerate(phases, 1):
        grid.add_row(f"[bold accent]{i}[/bold accent]", f"[bold]{title}[/bold]", f"[muted]{desc}[/muted]")
    body = [grid]
    for line in (context or []):
        body.append(f"[muted]{line}[/muted]")
    return Panel(
        Group(*body),
        title=f"[bold accent]This run · {len(phases)} steps[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
        expand=False,
    )


class _PhaseState:
    """Per-phase row state in the persistent checklist."""
    __slots__ = ("index", "total", "title", "status", "activity", "start", "end", "build")

    def __init__(self, index, total, title):
        self.index = index
        self.total = total
        self.title = title
        self.status = "pending"   # pending | active | done | failed
        self.activity = ""
        self.start = None
        self.end = None
        self.build = None         # svc -> {x,y,label,cached,start,end} for the Build phase


class _ChecklistController:
    """Pins the phase stepper (✓ done ── ◉ current ── ○ pending) to the TOP line of
    the terminal via a DECSTBM scroll region installed BEFORE any other output:
    row 1 holds the stepper, rows 2.. scroll everything else (banner, prompts,
    build) beneath it. Installing first (when the screen is empty) is what keeps
    it from corrupting — there's no pre-existing content for the region to fight.
    Build progress prints as readable scrolling milestones. Non-TTY / --verbose /
    too-short terminals fall back to plain per-phase lines (no region). The region
    is reset on every exit path via the idempotent _teardown()."""

    _RESERVE = 1   # top lines held fixed for the sticky stepper

    def __init__(self):
        self.phases = []          # list[_PhaseState]
        self._by_index = {}       # index -> _PhaseState
        self._suspend_depth = 0
        self._sticky_on = False   # True while the scroll region is installed
        self._torn_down = False   # cleanup-once guard
        self._cols = 0
        self._rows = 0
        self._build_last = {}     # svc -> last friendly label printed (dedupe)

    def _enabled(self):
        return console.is_terminal and not VERBOSE

    def _capable(self):
        if not self._enabled():
            return False
        return shutil.get_terminal_size(fallback=(80, 24)).lines > self._RESERVE + 3

    def sticky_active(self):
        return self._sticky_on

    # ── scroll-region plumbing ───────────────────────────────────────────────────
    def _render_ansi(self, text):
        """A Rich renderable → a single cropped ANSI line for the fixed top row."""
        text.no_wrap = True
        text.overflow = "crop"
        with _real_console.capture() as cap:
            _real_console.print(text, end="", crop=True)
        return cap.get()

    def _install(self):
        """Install the sticky region on a CLEARED screen (cursor at home), before
        any other output — the key to not corrupting the display."""
        if not self._capable():
            self._sticky_on = False
            return
        size = shutil.get_terminal_size(fallback=(80, 24))
        self._cols, self._rows = size.columns, size.lines
        f = _real_console.file
        f.write("\033[2J\033[H")                          # clear screen, cursor home
        f.write(f"\033[{self._RESERVE + 1};{self._rows}r")  # scroll region below row 1
        f.write(f"\033[{self._RESERVE + 1};1H")            # cursor into the scroll region
        f.flush()
        self._sticky_on = True
        self._torn_down = False
        self._paint()

    def _paint(self):
        if not self._sticky_on:
            return
        size = shutil.get_terminal_size(fallback=(80, 24))
        f = _real_console.file
        if (size.columns, size.lines) != (self._cols, self._rows):
            # Resize: recompute the region (or drop to plain if it got too short).
            self._cols, self._rows = size.columns, size.lines
            if self._rows <= self._RESERVE + 3:
                self._teardown(final=False)
                return
            f.write(f"\033[{self._RESERVE + 1};{self._rows}r")
        line = self._render_ansi(self._stepper_line())
        f.write("\0337")                          # save cursor (relative to region)
        f.write("\033[1;1H" + line + "\033[K")     # repaint the fixed top row
        f.write("\0338")                          # restore cursor (back into region)
        f.flush()

    def _teardown(self, final=False):
        """Reset the scroll region — idempotent, safe from every exit path."""
        if self._torn_down:
            return
        self._torn_down = True
        if self._sticky_on:
            f = _real_console.file
            f.write("\033[r")                      # reset scroll region to full screen
            f.write(f"\033[{self._rows};1H\n")     # drop below everything, clean line
            f.flush()
            self._sticky_on = False
        if final:
            console.print(self._stepper_line())    # permanent final record

    # ── lifecycle ──────────────────────────────────────────────────────────────
    def register(self, specs):
        """specs: list of (index, total, title). Installs the sticky top stepper.
        Call this BEFORE the banner so the region is set on an empty screen."""
        self.phases = [_PhaseState(i, t, title) for (i, t, title) in specs]
        self._by_index = {p.index: p for p in self.phases}
        self._torn_down = False
        self._install()

    def set_mode(self, text):
        """Kept for API compatibility (mode is shown in the steps panel now)."""
        return

    def start_phase(self, index):
        p = self._by_index.get(index)
        if p is None:
            p = _PhaseState(index, index, str(index))
            self.phases.append(p)
            self._by_index[index] = p
        p.status = "active"
        p.start = time.monotonic()
        self._suspend_depth = 0
        if self._sticky_on:
            self._paint()
        else:
            # Fallback (non-TTY / --verbose): print the stepper inline.
            console.print(self._stepper_line())

    def set_activity(self, index, text):
        p = self._by_index.get(index)
        if p is not None and p.status == "active":
            p.activity = text   # not shown in the compact stepper; no repaint needed

    def finish_phase(self, index, failed=False):
        p = self._by_index.get(index)
        if p is None:
            return
        p.status = "failed" if failed else "done"
        p.end = time.monotonic()
        if self._sticky_on:
            self._paint()
        else:
            dur = self._phase_dur(p)
            marker = "[error]✗[/error]" if failed else "[success]✓[/success]"
            console.print(f"{marker} [muted]Phase {p.index}/{p.total} ·[/muted] "
                          f"[bold accent]{p.title}[/bold accent]  [muted]{dur}[/muted]")

    def suspend(self):
        # No Live to stop — prompts/sudo/output scroll inside the region. Kept as
        # API; resume() repaints to heal any cursor moves.
        self._suspend_depth += 1

    def resume(self):
        if self._suspend_depth > 0:
            self._suspend_depth -= 1
        if self._suspend_depth == 0:
            self._paint()

    def stop(self):
        """Error/interrupt path: reset the region (no final stepper)."""
        self._suspend_depth = 0
        self._teardown(final=False)

    def end_run(self):
        """Normal completion: reset the region, leave a final all-done stepper."""
        self._teardown(final=True)

    # ── build progress (scrolling milestones beneath the sticky stepper) ─────────
    def build_event(self, kind, svc=None, x=None, y=None, label=None):
        if kind == "step" and svc and label:
            if self._build_last.get(svc) != label:
                self._build_last[svc] = label
                console.print(f"  [dim]{svc}[/dim] · [info]{label}…[/info]")
        elif kind == "built" and svc:
            console.print(f"  [success]✓ {svc} built[/success]")

    def build_log(self, line):
        """Show compose status lines (Container/Network …) as they scroll; skip the
        raw BuildKit '#NN …' step chatter (the friendly milestones cover that)."""
        line = line.strip()
        if not line or line.startswith("#"):
            return
        if any(k in line for k in ("Container ", "Network ", "Volume ", "Pulling", "Pulled")):
            console.print(f"  [dim]{line}[/dim]", highlight=False)

    # ── rendering helpers ────────────────────────────────────────────────────────
    def _phase_dur(self, p):
        if p.start is None or p.end is None:
            return "0.0s"
        return _fmt_duration(p.end - p.start)

    def _stepper_line(self):
        """A horizontal stepper: ✓ done ── ◉ current ── ○ pending ── ✗ failed, with
        the current phase emphasized so 'where am I' reads at a glance."""
        segs = []
        for p in self.phases:
            if p.status == "done":
                segs.append(f"[success]✓[/success] [muted]{p.title}[/muted]")
            elif p.status == "active":
                segs.append(f"[bold accent]◉ {p.title}[/bold accent]")
            elif p.status == "failed":
                segs.append(f"[bold error]✗ {p.title}[/bold error]")
            else:
                segs.append(f"[dim]○ {p.title}[/dim]")
        line = Text.from_markup("[dim] ── [/dim]".join(segs))
        line.no_wrap = True
        line.overflow = "crop"
        return line


_checklist = _ChecklistController()


class _PhaseHandle:
    """Thin handle over the checklist controller for one phase. Update the active
    step with .set(activity) and mark failure with .fail(). suspend()/resume()/
    pause() are kept for callers but no longer stop a Live (there is none) — the
    sticky header is fixed by the scroll region; resume() just repaints it to heal
    any stray cursor moves from a prompt."""

    def __init__(self, index):
        self.index = index
        self.failed = False

    def set(self, activity):
        _checklist.set_activity(self.index, activity)

    def fail(self):
        self.failed = True

    def suspend(self):
        """No-op for the sticky header (kept as API); paired with resume()."""
        _checklist.suspend()

    def resume(self):
        """Repaint the sticky header to heal any cursor moves from a prompt."""
        _checklist.resume()

    @contextlib.contextmanager
    def pause(self):
        """Bracket a prompting / sudo / raw-output block; repaints on exit."""
        self.suspend()
        try:
            yield
        finally:
            self.resume()


def register_phases(specs):
    """Register the full phase roadmap (list of (index, total, title)) and install
    the sticky-top header so the roadmap is visible from the start."""
    _checklist.register(specs)


def register_setup_phases():
    """Register the standard SETUP_PHASES roadmap (titles only) for the header."""
    total = len(SETUP_PHASES)
    _checklist.register([(i, total, title) for i, (title, _) in enumerate(SETUP_PHASES, 1)])


def set_mode(text):
    """Set the sticky header's context/mode line (e.g. 'Local + Dev · TT Hardware')."""
    _checklist.set_mode(text)


def ensure_region_reset():
    """Idempotent safety net: reset the terminal scroll region if still installed.
    Wired into main()'s finally + atexit so no exit path can leave the terminal's
    scroll region (sticky top) stuck."""
    _checklist._teardown(final=False)


def sticky_active():
    """True while the sticky top stepper region is installed (so the banner skips
    its own screen-clear, which would reset the region)."""
    return _checklist.sticky_active()


def begin_phase(index, total, title):
    """Mark a phase active in the checklist. (register_phases() should have been
    called first; falls back to a single-phase skeleton otherwise.)"""
    global _IN_PHASE, _active_phase
    if not _checklist.phases:
        _checklist.register([(index, total, title)])
    _checklist.start_phase(index)
    handle = _PhaseHandle(index)
    _IN_PHASE = True
    _active_phase = handle
    return handle


def end_phase(handle=None):
    """Finalize a phase: mark it ✓ (or ✗ if .fail() was called) in the checklist."""
    global _IN_PHASE, _active_phase
    handle = handle or _active_phase
    if handle is None:
        return
    _checklist.finish_phase(handle.index, handle.failed)
    _IN_PHASE = False
    _active_phase = None


def end_run():
    """Clear the pinned checklist at the end of a normal run (ready panel follows)."""
    _checklist.end_run()


def build_event(kind, svc=None, x=None, y=None, label=None):
    """Feed a Docker build event into the active phase's folded build row."""
    _checklist.build_event(kind, svc=svc, x=x, y=y, label=label)


def build_log(line):
    """Feed a raw build-output line into the Build row's rolling tail."""
    _checklist.build_log(line)


def stop_active_phase():
    """Reset the scroll region WITHOUT marking the phase — for error/interrupt
    paths, so the sticky header doesn't corrupt a following panel."""
    global _IN_PHASE, _active_phase
    _checklist.stop()
    _IN_PHASE = False
    _active_phase = None


def _vdivider(height):
    """A full-height vertical divider for a two-column grid row (accent-colored)."""
    return "\n".join("[accent]│[/accent]" for _ in range(max(height, 1)))


# Fixed panel width: a stretched (terminal-width) panel re-wraps and garbles the
# ASCII logos when the user resizes the window, so we pin it. Capped to the
# current width so it still fits narrow terminals.
_PANEL_WIDTH = 78


def _panel_width():
    return min(_PANEL_WIDTH, console.width)


def _logo_text(art):
    """Centered accent logo that crops (never word-wraps) on narrow terminals,
    so a resize clips it cleanly instead of garbling the art."""
    return Text(art, style="accent", justify="center", no_wrap=True, overflow="crop")


def welcome_panel(title, left_lines, sections, logos=None, tagline=None):
    """Build the Claude-Code-style launch panel: title in the top border, an
    optional stack of centered logo bands, an optional centered tagline, then a
    two-column body (left context | divider | headed right sections).

    - title: text shown in the top border (e.g. "TT Studio · main").
    - left_lines: list of Rich-markup strings stacked in the left column.
    - sections: list of (heading, [item, ...]) rendered in the right column,
      each heading bold-accent, items muted, separated by a thin rule.
    - logos: optional list of multi-line ASCII strings, each centered in accent
      above the body (rendered as plain Text — backslashes/brackets are safe).
    - tagline: optional list of Rich-markup strings, centered under the logo
      (e.g. the product name + one-line description).

    Markup-bearing content (left_lines/sections/tagline) must be markup-safe.
    """
    right_lines = []
    for i, (heading, items) in enumerate(sections):
        if i:
            right_lines.append("")  # spacing between sections
        right_lines.append(f"[bold accent]{heading}[/bold accent]")
        right_lines.append("")  # spacing under the heading
        right_lines.extend(f"[muted]{item}[/muted]" for item in items)

    height = max(len(left_lines), len(right_lines), 1)
    left = list(left_lines) + [""] * (height - len(left_lines))
    right = right_lines + [""] * (height - len(right_lines))

    # expand=True + a ratio on the right column makes the body fill the panel
    # width (right column reaches the border) instead of leaving a hollow gap.
    grid = Table.grid(padding=(0, 2), expand=True)
    grid.add_column()           # left — sized to its content
    grid.add_column()           # vertical divider
    grid.add_column(ratio=1)    # right — absorbs the remaining width
    grid.add_row("\n".join(left), _vdivider(height), "\n".join(right))

    parts = []
    for art in (logos or []):
        if parts:
            parts.append("")  # blank line between stacked logos so they don't collide
        parts.append(_logo_text(art))
    if tagline and parts:
        parts.append("")  # breathing room between the logo and the tagline
    for line in (tagline or []):
        parts.append(Text.from_markup(line, justify="center"))  # centered under the logo
    if parts:
        parts.append("")  # blank line between the header and the body
    parts.append(grid)
    body = Group(*parts) if len(parts) > 1 else grid

    return Panel(
        body,
        title=f"[bold accent]{title}[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
        width=_panel_width(),
    )


def ready_panel(title, rows, footer_lines=None):
    """Build the post-startup summary panel: title in the top border, an aligned
    label/value grid (endpoints, mode), plus optional muted footer lines.

    - rows: list of (label, value) or (label, value, status). Labels are muted;
      values render in info (cyan). A value that looks like a URL becomes an
      OSC-8 hyperlink (cmd-clickable in modern terminals). The optional `status`
      ("up" / "starting" / "down") prefixes the value with a live health glyph.
    - footer_lines: list of Rich-markup strings shown under the grid.
    """
    glyphs = {
        "up": "[success]●[/success] ",
        "starting": "[warning]…[/warning] ",
        "down": "[error]✗[/error] ",
    }
    grid = Table.grid(padding=(0, 3))
    grid.add_column()
    grid.add_column()
    for row in rows:
        label, value = row[0], row[1]
        status = row[2] if len(row) > 2 else None
        glyph = glyphs.get(status, "")
        if isinstance(value, str) and value.startswith("http"):
            rendered = f"[info][link={value}]{value}[/link][/info]"
        else:
            rendered = f"[info]{value}[/info]"
        grid.add_row(f"[muted]{label}[/muted]", f"{glyph}{rendered}")

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
        width=_panel_width(),
    )


def kept_panel(title, rows, footer_lines=None):
    """A content-sized panel for 'what was preserved' summaries (e.g. after
    --stop). Muted border (distinct from the accent ready card) signals
    secondary state; `expand=False` keeps it compact, not hollow.

    - title: Rich-markup string shown in the top border (caller styles it).
    - rows: list of (label, value), both Rich-markup strings the caller styles
      (labels readable, values can grey out secondary bits / accent a live count).
    - footer_lines: optional Rich-markup strings under the grid.
    """
    grid = Table.grid(padding=(0, 3))
    grid.add_column()
    grid.add_column()
    for label, value in rows:
        grid.add_row(label, value)

    body = [grid]
    if footer_lines:
        body.append("")
        body.extend(footer_lines)

    return Panel(
        Group(*body),
        title=title,
        title_align="left",
        border_style="muted",
        box=box.ROUNDED,
        padding=(1, 2),
        expand=False,
    )


def notice_panel(title, lines, border_style="accent"):
    """A compact, content-sized panel with a styled border and body lines —
    used for headers/callouts (e.g. the red --purge-all danger header).

    - title: Rich-markup string shown in the top border.
    - lines: list of Rich-markup strings stacked in the body.
    - border_style: theme style for the border (e.g. "error", "accent").
    """
    return Panel(
        Group(*lines),
        title=title,
        title_align="left",
        border_style=border_style,
        box=box.ROUNDED,
        padding=(1, 2),
        expand=False,
    )


@contextlib.contextmanager
def _prompt_guard():
    """Suspend any active phase spinner for the duration of a prompt so the live
    display doesn't fight the input line, then resume it."""
    ph = _active_phase
    if ph is not None:
        ph.suspend()
    try:
        yield
    finally:
        if ph is not None:
            ph.resume()


def ask(prompt, default=None, choices=None, password=False):
    """Themed text prompt (rich.prompt.Prompt) — consistent styling, validated
    `choices`, and a shown default. Pass password=True to mask input. Suspends
    any active phase spinner; lets KeyboardInterrupt propagate so callers can
    print their resume hint."""
    with _prompt_guard():
        return Prompt.ask(prompt, console=console, default=default,
                          choices=choices, password=password)


def confirm(prompt, default=True):
    """Themed yes/no prompt (rich.prompt.Confirm). Suspends any active phase
    spinner; lets KeyboardInterrupt propagate."""
    with _prompt_guard():
        return Confirm.ask(prompt, console=console, default=default)


def secret(prompt):
    """Masked input via getpass, with the pinned stepper suspended for the
    duration so it doesn't clash with the (non-Rich) prompt. Returns the raw string."""
    import getpass
    with _prompt_guard():
        return getpass.getpass(prompt)


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
