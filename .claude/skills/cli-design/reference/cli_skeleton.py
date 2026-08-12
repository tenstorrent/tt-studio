# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A working CLI in this design — copy and fill in. Runs as-is:

    python3 cli_skeleton.py --help      # grouped flags, action-shaped names
    python3 cli_skeleton.py             # the phased run + ready card
    python3 cli_skeleton.py --info      # re-view the ready card (no work done)
    python3 cli_skeleton.py --stop      # teardown, with a "what was kept" card
    python3 cli_skeleton.py -v          # folded detail returns

The shape is the point:

  one entrypoint  →  bootstrap  →  parse  →  EARLY DISPATCH (utility flags)
                                          →  the phased run  →  ready card

Utility/lifecycle flags (--stop/--info/--logs/--status) do their work and return
BEFORE any phase starts. Only flags that modify a normal run fall through. That
one rule is what keeps a launcher from growing into a maze.

Uses argparse so it runs with no dependencies beyond `rich` (via console.py);
the Typer notes in _build_parser() show the equivalent when you have Typer.
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from console import (  # noqa: E402
    console, failure_card, milestone, note, notice_panel, phase, progress_bar,
    ready_panel, register_phases, run_with_activity, set_verbose, show_detail, step,
)

APP = "demoapp"
PHASES = [
    ("Checks",    "system, tools & versions"),
    ("Configure", "environment, secrets & ports"),
    ("Launch",    "start the services"),
]
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".demoapp-state")


# ── bootstrap: runs BEFORE your deps exist, so stdlib only ───────────────────
def ensure_environment():
    """Create/validate the managed venv and re-exec into it.

    Real implementations create a venv, install requirements, and re-exec. The
    rule that matters: this code runs before your pretty layer is installed, so
    it is stdlib-only — never import the console module here. Mimic the style by
    hand (a plain "⠋ label…" spinner is ~15 lines of stdlib).
    """
    try:
        import rich  # noqa: F401
    except ImportError:
        sys.exit("This CLI needs `rich`:  pip install rich")


# ── the command surface ──────────────────────────────────────────────────────
def _build_parser():
    """Flags grouped by intent, because `--help` is documentation.

    With Typer, each option carries `rich_help_panel="Lifecycle"` etc. and you get
    the same grouping for free. Conventions worth keeping either way:

      * Action-shaped, lowercase names that match their own output — `--stop`
        prints "Stopping…/Stopped", not "Cleaning up".
      * A fixed set of groups: Setup · Lifecycle · Reset · Advanced · Troubleshooting.
      * Deprecated flags stay as hidden aliases that warn and normalize onto the
        current name — never a hard break for someone's muscle memory or script.
      * Destructive flags say what they destroy in the flag name (`--purge-all`),
        and confirm before acting.
    """
    parser = argparse.ArgumentParser(
        prog=APP, description=APP + " — start, stop, and inspect the stack.",
        formatter_class=argparse.RawDescriptionHelpFormatter)

    setup = parser.add_argument_group("Setup & Configuration")
    setup.add_argument("--dev", action="store_true", help="Development mode (hot reload, mounted source).")
    setup.add_argument("--reconfigure", action="store_true", help="Re-run the interactive configuration.")

    lifecycle = parser.add_argument_group("Lifecycle")
    lifecycle.add_argument("--stop", action="store_true", help="Stop the services, keep data.")
    lifecycle.add_argument("--info", action="store_true", help="Re-show the ready summary.")
    lifecycle.add_argument("--logs", action="store_true", help="Stream service logs.")

    reset = parser.add_argument_group("Reset")
    reset.add_argument("--purge-all", action="store_true", help="Remove services AND their data.")

    advanced = parser.add_argument_group("Advanced")
    advanced.add_argument("--strict", action="store_true",
                          help="Fail on a hardware/config mismatch instead of warning.")

    trouble = parser.add_argument_group("Troubleshooting & Info")
    trouble.add_argument("-v", "--verbose", action="store_true", help="Show all folded detail.")

    # Deprecated alias: warn + normalize, never break.
    parser.add_argument("--cleanup", action="store_true", help=argparse.SUPPRESS)
    return parser


def normalize(args):
    if args.cleanup:
        console.print("[warning]--cleanup is deprecated; use --stop.[/warning]")
        args.stop = True
    return args


# ── utility commands: work, then return (never inside a phase) ───────────────
def render_ready(args, elapsed=None):
    """ONE renderer, called both at the end of a run and by --info.

    It probes live state rather than reusing values from the run, which is what
    makes it re-viewable. Never duplicate the assembly — a second copy drifts.
    """
    running = os.path.exists(STATE_FILE)
    rows = [("URL", "http://localhost:8000", "up" if running else "down"),
            ("Mode", "Local + Dev" if args.dev else "Local")]
    footer = []
    if elapsed is not None:
        footer.append("[muted]Ready in {} · {} phases[/muted]".format(
            "%.1fs" % elapsed, len(PHASES)))
    footer += ["[muted]Stop · {} --stop[/muted]".format(APP),
               "[muted]Logs · {} --logs[/muted]".format(APP),
               "[muted]Info · {} --info[/muted]".format(APP)]
    console.print(ready_panel(APP + " is ready" if running else APP + " is not running",
                             rows, footer))


def do_stop():
    """Teardown is a first-class command, not an afterthought: same calm steps,
    and a card naming what was KEPT so nobody wonders about their data."""
    console.print("[bold accent]Stopping {}[/bold accent]".format(APP))
    with step("Stopping services") as s:
        time.sleep(0.6)
        existed = os.path.exists(STATE_FILE)
        if existed:
            os.remove(STATE_FILE)
        else:
            s.skip("nothing running")
    console.print(notice_panel("[bold accent]Preserved[/bold accent]",
                               ["[muted]Data volume · demoapp_data[/muted]",
                                "[muted]Config     · .env[/muted]",
                                "",
                                "[muted]Remove these too · {} --purge-all[/muted]".format(APP)],
                               border_style="muted"))
    console.print("[success]✓ Stopped[/success]")


# ── checks: lenient by default, strict is opt-in, verify what you assume ─────
def check_environment(strict):
    """Three rules that keep checks from being hostile:

    1. Lenient defaults — never block a laptop or a CI box out of the box.
       Strict behavior is opt-in (--strict) or gated on a real signal.
    2. Assume and VERIFY — if config claims something ("this is a GPU box"),
       check it against reality and surface a mismatch instead of trusting it.
    3. Every hard stop names a fix AND an escape hatch.
    """
    claimed = os.environ.get("DEMOAPP_HAS_ACCELERATOR", "").lower() in ("1", "true", "yes")
    detected = os.path.exists("/dev/definitely-not-here")
    if claimed and not detected:
        if strict:
            console.print(notice_panel(
                "[error]Configured for an accelerator, but none was found[/error]",
                ["[error]DEMOAPP_HAS_ACCELERATOR is set, but no device is present.[/error]",
                 "",
                 "[info]Try:[/info]",
                 "[muted]  install the driver and re-run[/muted]",
                 "[muted]  or unset DEMOAPP_HAS_ACCELERATOR to run without one[/muted]"],
                border_style="error"))
            sys.exit(1)
        note("Configured for an accelerator but none detected — continuing without it",
             marker="!", style="warning")
    return "accelerator" if detected else "no accelerator"


# ── the phased run ───────────────────────────────────────────────────────────
def run(args):
    start = time.monotonic()
    register_phases([title for title, _ in PHASES])

    with phase("Checks"):
        with step("Tooling") as s:
            time.sleep(0.5)
            s.detail("python " + ".".join(map(str, sys.version_info[:3])))
        hardware = check_environment(args.strict)

    with phase("Configure"):
        with step("Environment") as s:
            time.sleep(0.4)
            s.detail("12 vars")
        if show_detail():        # routine confirmation: folded unless -v
            console.print("[muted]ports 8000, 8111 free[/muted]")

    with phase("Launch"):
        # A long command becomes ONE live line plus real milestones. The parser
        # is a pure function you unit-test with captured output (patterns.md §3).
        done = {"n": 0}

        def parse(line):
            line = line.strip()
            if line.startswith("start "):
                return "Starting services  {}  {}/3".format(progress_bar(done["n"], 3), done["n"])
            if line.startswith("up "):
                done["n"] += 1
                return ("milestone", line.split()[1] + " up")
            return None

        rc, output = run_with_activity(
            ["bash", "-c", "for s in api worker web; do echo start $s; sleep 0.4; echo up $s; done"],
            label="Starting services", parse=parse)
        if rc != 0:
            console.print(failure_card(APP, {
                "cause": "a service didn't start",
                "detail": "One of the services exited during startup.",
                "evidence": output.strip().splitlines()[-1] if output.strip() else "",
                "actions": [APP + " --logs", APP + " --stop, then re-run"]},
                consequence="Stopping here — nothing is left half-started."))
            sys.exit(1)
        open(STATE_FILE, "w").close()

    render_ready(args, elapsed=time.monotonic() - start)
    console.print("[muted]hardware · {}[/muted]".format(hardware)) if args.verbose else None


def main():
    ensure_environment()
    args = normalize(_build_parser().parse_args())
    set_verbose(args.verbose)

    # ── EARLY DISPATCH ───────────────────────────────────────────────────────
    # Utility/lifecycle flags do their work and return before any phase begins.
    if args.stop:
        return do_stop()
    if args.purge_all:
        console.print("[warning]This removes all data. (Confirm here, then purge.)[/warning]")
        return
    if args.info:
        return render_ready(args)
    if args.logs:
        console.print("[muted]streaming logs… (wire to your log source)[/muted]")
        return

    try:
        run(args)
    except KeyboardInterrupt:
        # Interrupts get a card too — say what state the machine is in and how to
        # resume, so Ctrl-C is never a cliff.
        console.print()
        console.print(notice_panel("[warning]Interrupted[/warning]",
                                   ["[muted]Resume   · {}[/muted]".format(APP),
                                    "[muted]Clean up · {} --stop[/muted]".format(APP)],
                                   border_style="warning"))
        sys.exit(130)


if __name__ == "__main__":
    main()
