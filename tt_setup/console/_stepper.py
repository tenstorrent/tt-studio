# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sticky-top phase stepper, build progress, pulse ticker, prompts guard, and
the phase-lifecycle module API (begin/end_phase, build_*, notes)."""

import contextlib
import shutil
import sys
import threading
import time
from rich.rule import Rule
from rich.text import Text
from tt_setup.console import _events as events
from tt_setup.console._theme import _fmt_duration, _real_console, console, is_verbose


_IN_PHASE = False        # True while a phase spinner is active


_active_phase = None     # the running phase handle (so error paths can stop it)


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
    return is_verbose() or not _IN_PHASE


# The startup roadmap — single source of truth for the steps panel, the sticky
# header stepper, and register_setup_phases(). (title, one-line description).
SETUP_PHASES = [
    ("Checks",    "system, hardware, Docker & update freshness"),
    ("Configure", "environment, secrets, network & ports"),
    ("Services",  "Docker-control & the inference-server artifact"),
    ("Build",     "pull or build & start the containers"),
    ("Launch",    "inference-server env & process start"),
]


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
        self._log_seen = set()    # compose status lines already shown (dedupe)
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
        return console.is_terminal and not is_verbose()

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

    def set_title(self, index, title):
        """Retitle a phase node. The phase COUNT is fixed (k/N must never drift),
        but the word can follow what the run actually decided to do — e.g. Build
        vs Pull, known only once the image source is resolved."""
        p = self._by_index.get(index)
        if p is not None and title and p.title != title:
            p.title = title
            self._paint()

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
        elif kind in ("built", "pulled", "started") and svc:
            with self._paint_lock:
                console.print(f"  [success]✓ {svc} {kind}[/success]")

    def build_note(self, text, marker="○", style="muted"):
        """A short note in the same gutter as the build events (e.g. why the
        image pull was skipped). Rendered as a Text (not markup) since the note
        carries image refs, and padded so a wrapped line keeps the indent."""
        from rich.padding import Padding
        prefix = f"{marker} " if marker else "  "
        with self._paint_lock:
            console.print(Padding(Text(f"{prefix}{text}", style=style), (0, 0, 0, 2)))

    def build_log(self, line):
        """Show only meaningful compose status transitions (Started/Healthy/errors)
        as they scroll; skip the Creating/Created/Starting/Waiting wall and the raw
        BuildKit '#NN …' chatter (the friendly milestones cover the rest)."""
        line = line.strip()
        if not line or line.startswith("#"):
            return
        if any(k in line for k in (" Started", " Healthy", " Error", " Failed", "error", "failed")):
            # Compose restates the same transition on every poll ("… Healthy" x3);
            # show each distinct line once so the body doesn't stutter.
            if line in self._log_seen:
                return
            self._log_seen.add(line)
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


def _phase_title(index=None):
    """The registered title for a phase (defaults to the active one), or None.
    Used to stamp the `phase` field on emitted events."""
    if index is None:
        index = _active_phase.index if _active_phase is not None else None
    p = _checklist._by_index.get(index) if index is not None else None
    return p.title if p is not None else None


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
        events.emit("progress", phase=_phase_title(self.index),
                    detail={"activity": activity})

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
    events.emit("warn", phase=_phase_title(), detail={"text": events.plain(markup)})


def get_notes():
    """The actionable notes collected this run (for the end recap)."""
    return list(_notes)


def begin_phase(index, total, title):
    """Mark a phase active in the checklist. (register_phases() should have been
    called first; falls back to a single-phase skeleton otherwise.)"""
    global _IN_PHASE, _active_phase
    if not _checklist.phases:
        _checklist.register([(index, total, title)])
    _checklist.set_title(index, title)   # the caller's title wins over the roadmap's
    _checklist.start_phase(index)
    handle = _PhaseHandle(index)
    _IN_PHASE = True
    _active_phase = handle
    events.emit("phase_begin", phase=title, detail={"index": index, "total": total})
    return handle


def end_phase(handle=None):
    """Finalize a phase: mark it ✓ (or ✗ if .fail() was called) in the checklist."""
    global _IN_PHASE, _active_phase
    handle = handle or _active_phase
    if handle is None:
        return
    _checklist.finish_phase(handle.index, handle.failed)
    p = _checklist._by_index.get(handle.index)
    detail = {"index": handle.index, "status": "failed" if handle.failed else "ok"}
    if p is not None and p.start is not None and p.end is not None:
        detail["duration_s"] = round(p.end - p.start, 3)
    events.emit("phase_end", phase=_phase_title(handle.index), detail=detail)
    _IN_PHASE = False
    _active_phase = None


def rename_phase(index, title):
    """Retitle a phase mid-run when the plan changes (e.g. a pull that fell back
    to a local build), so the stepper and the final record say what happened."""
    _checklist.set_title(index, title)
    events.emit("progress", phase=title,
                detail={"kind": "phase_renamed", "index": index})


def end_run():
    """Clear the pinned checklist at the end of a normal run (ready panel follows)."""
    _checklist.end_run()


def build_event(kind, svc=None, x=None, y=None, label=None):
    """Feed a Docker build event into the active phase's folded build row."""
    _checklist.build_event(kind, svc=svc, x=x, y=y, label=label)
    detail = {"kind": kind}
    if svc:
        detail["service"] = svc
    if label:
        detail["label"] = label
    events.emit("progress", phase=_phase_title(), detail=detail)


def build_log(line):
    """Feed a raw build-output line into the Build row's rolling tail."""
    _checklist.build_log(line)


def build_note(text, marker="○", style="muted"):
    """Print a calm note in the build body's gutter (aligned with ✓ <svc> lines).
    Pass marker="" for a continuation/hint line under a previous note."""
    _checklist.build_note(text, marker=marker, style=style)
    events.emit("note", phase=_phase_title(), detail={"text": events.plain(text)})


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
    if _active_phase is not None:
        events.emit("phase_end", phase=_phase_title(_active_phase.index),
                    detail={"index": _active_phase.index, "status": "failed"})
    _checklist.stop()
    _IN_PHASE = False
    _active_phase = None


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

