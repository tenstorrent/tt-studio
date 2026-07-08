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
import threading
import time

from rich import box
from rich.console import Console, Group
from rich.panel import Panel
from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn
from rich.prompt import Confirm, Prompt
from rich.rule import Rule
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

    _RESERVE = 2   # fixed top rows: row 1 = stepper, row 2 = separator rule

    def __init__(self):
        self.phases = []          # list[_PhaseState]
        self._by_index = {}       # index -> _PhaseState
        self._suspend_depth = 0
        self._sticky_on = False   # True while the scroll region is installed
        self._torn_down = False   # cleanup-once guard
        self._cols = 0
        self._rows = 0
        self._build_last = {}     # svc -> last friendly label printed (dedupe)
        self._cleared_once = False  # collapse: clear the body on every phase after the first
        self._pulse_frame = 0       # rotating-spinner frame for the active node
        self._pulse_active = False  # animate the active node (during the build)
        self._build_active = False  # paint the apt-style bottom activity row (build only)
        self._build_activity = ""   # bottom-row label (e.g. "frontend · installing JS deps")
        self._awaiting_input = False  # active node turns red while blocked on a prompt
        # Serializes every terminal write to the fixed header with build-time body
        # prints, so the background pulse ticker never interleaves with them.
        self._paint_lock = threading.RLock()
        self._ticker = None         # daemon thread animating the active node
        self._ticker_stop = None    # threading.Event to stop the ticker

    _PULSE = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"  # active-node spinner frames (the phase "pulse")

    def _enabled(self):
        return console.is_terminal and not VERBOSE

    def _capable(self):
        if not self._enabled():
            return False
        # +4 (not +3): row 1 stepper, row 2 rule, the bottom activity row, and at
        # least a couple of body rows for the scrolling output in between.
        return shutil.get_terminal_size(fallback=(80, 24)).lines > self._RESERVE + 4

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
        with self._paint_lock:
            f = _real_console.file
            f.write("\033[2J\033[H")                          # clear screen, cursor home
            # Scroll region sits BELOW the header (rows 1-2) and ABOVE the bottom
            # activity row (row N), so neither the header nor the pinned bottom
            # spinner ever scrolls with the body.
            f.write(f"\033[{self._RESERVE + 1};{self._rows - 1}r")
            f.write(f"\033[{self._RESERVE + 1};1H")            # cursor into the scroll region
            f.flush()
        self._sticky_on = True
        self._torn_down = False
        self._paint()

    def _paint(self):
        if not self._sticky_on:
            return
        with self._paint_lock:
            size = shutil.get_terminal_size(fallback=(80, 24))
            f = _real_console.file
            if (size.columns, size.lines) != (self._cols, self._rows):
                # Resize: recompute the region (or drop to plain if too short).
                self._cols, self._rows = size.columns, size.lines
                if self._rows <= self._RESERVE + 4:
                    self._teardown(final=False)
                    return
                f.write(f"\033[{self._RESERVE + 1};{self._rows - 1}r")
            stepper = self._render_ansi(self._stepper_line())
            rule = self._render_ansi(Text("─" * self._cols, style="muted"))
            f.write("\0337")                          # save cursor (relative to region)
            f.write("\033[1;1H" + stepper + "\033[K")  # row 1: the stepper
            f.write("\033[2;1H" + rule + "\033[K")     # row 2: separator from the body
            # Row N: apt-style bottom activity spinner during the build, else blank.
            # Cropped (no_wrap) so a long label never wraps and breaks the row.
            # Built via .append (not markup) since _build_activity comes from Docker
            # output and could contain literal [brackets] that markup would mis-parse.
            if self._build_active:
                glyph = self._PULSE[self._pulse_frame % len(self._PULSE)]
                t = Text()
                t.append(f"{glyph} ", style="accent")
                t.append(self._build_activity, style="muted")
                f.write(f"\033[{self._rows};1H" + self._render_ansi(t) + "\033[K")
            else:
                f.write(f"\033[{self._rows};1H\033[2K")
            f.write("\0338")                          # restore cursor (back into region)
            f.flush()

    def set_awaiting(self, waiting):
        """Mark the run blocked on user input → the active node renders red until
        the prompt is answered."""
        self._awaiting_input = bool(waiting)
        self._paint()

    def start_pulse(self):
        """Begin animating the active phase node via a background ticker, so it
        spins continuously (even while a long build step produces no output).
        No-op unless the sticky header is installed / already ticking."""
        if not self._sticky_on or self._ticker is not None:
            return
        self._pulse_active = True
        self._build_active = True   # also show the apt-style bottom activity row
        self._ticker_stop = threading.Event()
        self._ticker = threading.Thread(target=self._pulse_loop, daemon=True)
        self._ticker.start()

    def _pulse_loop(self):
        stop = self._ticker_stop
        while stop is not None and not stop.is_set():
            with self._paint_lock:
                self._pulse_frame += 1
                self._paint()
            stop.wait(0.1)   # ~10 fps

    def stop_pulse(self):
        """Stop the ticker, settle the active node to a static marker, and blank the
        bottom activity row (via the trailing _paint, which clears row N when the
        build is no longer active)."""
        if self._ticker_stop is not None:
            self._ticker_stop.set()
        # Don't join from within the ticker thread itself (e.g. a resize-triggered
        # teardown fired from _pulse_loop) — that would raise. The stop event
        # already tells the loop to exit.
        if self._ticker is not None and self._ticker is not threading.current_thread():
            self._ticker.join(timeout=0.5)
            self._ticker = None
            self._ticker_stop = None
        self._pulse_active = False
        self._build_active = False
        self._paint()

    def _clear_body(self):
        """Wipe the scrolling body (everything below the fixed stepper), so a
        finished phase's detail is dismissed and the next phase starts on a clean
        screen. The fixed header rows are untouched."""
        if not self._sticky_on:
            return
        with self._paint_lock:
            f = _real_console.file
            f.write(f"\033[{self._RESERVE + 1};1H")  # top of the scroll region
            f.write("\033[J")                          # clear from cursor to end of screen
            f.flush()

    def _teardown(self, final=False):
        """Reset the scroll region — idempotent, safe from every exit path."""
        self.stop_pulse()   # never leave the ticker writing to a torn-down region
        if self._torn_down:
            return
        self._torn_down = True
        with self._paint_lock:
            if self._sticky_on:
                f = _real_console.file
                f.write(f"\033[{self._rows};1H\033[2K")  # wipe the bottom activity row
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
            # Collapse: dismiss the previous phase's detail (but keep the banner +
            # steps panel visible during the very first phase).
            if self._cleared_once:
                self._clear_body()
            self._cleared_once = True
            # Delineate this phase's output in the scrolling body with a labelled
            # rule, then repaint the fixed stepper at the top.
            console.print(Rule(f"[bold accent]{p.title}[/bold accent]",
                               align="left", style="muted", characters="─"))
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
        self._pulse_active = False   # stop pulsing once the phase resolves
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
    # These print to the body while the pulse ticker repaints the header; the
    # shared _paint_lock keeps their escape sequences from interleaving.
    def build_event(self, kind, svc=None, x=None, y=None, label=None):
        if kind == "step" and svc and label:
            if self._build_last.get(svc) != label:
                self._build_last[svc] = label
                with self._paint_lock:
                    console.print(f"  [dim]{svc}[/dim] · [info]{label}…[/info]")
        elif kind == "built" and svc:
            with self._paint_lock:
                console.print(f"  [success]✓ {svc} built[/success]")

    def build_log(self, line):
        """Show only meaningful compose status transitions (Started/Healthy/errors)
        as they scroll; skip the Creating/Created/Starting/Waiting wall and the raw
        BuildKit '#NN …' chatter (the friendly milestones cover the rest)."""
        line = line.strip()
        if not line or line.startswith("#"):
            return
        if any(k in line for k in (" Started", " Healthy", " Error", " Failed", "error", "failed")):
            with self._paint_lock:
                console.print(f"  [dim]{line}[/dim]", highlight=False)

    # ── rendering helpers ────────────────────────────────────────────────────────
    def _phase_dur(self, p):
        if p.start is None or p.end is None:
            return "0.0s"
        return _fmt_duration(p.end - p.start)

    def _stepper_line(self):
        """A horizontal stepper that reads as a progress bar via color:
        green = done (node + trailing connector fill in), accent = current
        (pulsing), red = waiting-on-input / failed, dim = pending."""
        n = len(self.phases)
        parts = []
        for i, p in enumerate(self.phases):
            if p.status == "done":
                parts.append(f"[success]✓ {p.title}[/success]")
            elif p.status == "active":
                if self._awaiting_input:
                    parts.append(f"[error]◉ {p.title}[/error]")   # red (bold): needs you
                elif self._pulse_active:
                    frame = self._PULSE[self._pulse_frame % len(self._PULSE)]
                    parts.append(f"[accent.bold]{frame} {p.title}[/accent.bold]")
                else:
                    parts.append(f"[accent.bold]◉ {p.title}[/accent.bold]")
            elif p.status == "failed":
                parts.append(f"[error]✗ {p.title}[/error]")
            else:
                parts.append(f"[dim]○ {p.title}[/dim]")
            if i < n - 1:
                # Connector fills green once the phase it follows is done → the
                # bar visibly "completes" left-to-right as progress is made.
                parts.append("[success] ── [/success]" if p.status == "done" else "[dim] ── [/dim]")
        line = Text.from_markup("".join(parts))
        line.no_wrap = True
        line.overflow = "crop"
        return line


_checklist = _ChecklistController()


def _terminal_lock():
    """The RLock that serializes every raw escape write to the terminal (header
    repaints, the bottom activity row, and step()'s spinner frames), so a
    background ticker can never interleave with a repaint mid-escape-sequence."""
    return _checklist._paint_lock


def _stdout_isatty():
    """True only when the REAL stdout is a genuine tty. Used to gate hand-rolled
    spinners — stricter than Rich's is_terminal (which a forced-color CI can flip
    true on a pipe), so piped/redirected output stays free of escape codes."""
    try:
        return bool(sys.__stdout__) and sys.__stdout__.isatty()
    except Exception:
        return False


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


# Actionable notes collected during a run (HF-access blocks, warnings) so they can
# be recapped at the end — after per-phase collapse has cleared the inline copy.
_notes = []


def add_note(markup):
    """Record an actionable note (Rich markup) to re-show in the end-of-run
    'Needs attention' recap."""
    _notes.append(markup)


def get_notes():
    """The actionable notes collected this run (for the end recap)."""
    return list(_notes)


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


def build_activity(text):
    """Set the label on the apt-style bottom activity row shown during the build
    (e.g. 'frontend · installing JS deps'). Re-cropped to width on every repaint."""
    _checklist._build_activity = text or ""


def start_pulse():
    """Start continuously animating the active phase node (top-of-screen 'pulse')."""
    _checklist.start_pulse()


def stop_pulse():
    """Stop the active-node pulse animation."""
    _checklist.stop_pulse()


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
    display doesn't fight the input line, then resume it. Flags the active phase
    node red while blocked on input, so a waiting prompt is obvious up top."""
    ph = _active_phase
    _checklist.set_awaiting(True)
    if ph is not None:
        ph.suspend()
    try:
        yield
    finally:
        if ph is not None:
            ph.resume()
        _checklist.set_awaiting(False)


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
