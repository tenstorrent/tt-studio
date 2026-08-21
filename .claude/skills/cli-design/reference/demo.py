# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Runnable tour of the CLI design language — no repo setup needed.

    python3 demo.py            # a normal run: stepper, steps, progress, ready card
    python3 demo.py --fail     # the failure paths: expected note + diagnosis card
    python3 demo.py -v         # verbose: folded detail and raw tool lines come back
    python3 demo.py | cat -v   # non-TTY: must print ZERO escape codes

Every element here is one call into console.py, so this doubles as the smoke test
after you copy the module into a project. Needs `rich`.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from console import (  # noqa: E402
    console, failure_card, fmt_bytes, milestone, note, phase, progress_bar,
    ready_panel, register_phases, run_with_activity, set_verbose, show_detail, step,
)

FAIL = "--fail" in sys.argv
set_verbose("-v" in sys.argv or "--verbose" in sys.argv)


class FakePull:
    """Stand-in for a real stream aggregator (see patterns.md §3): pure, feed()
    per line, activity() renders the label. Counts what it knows exactly."""

    def __init__(self, total=3):
        self.total, self.done, self.bytes = total, 0, 0

    def feed(self, line):
        line = line.strip()
        if line.startswith("layer"):
            self.bytes += 1_400_000
            return self.activity()
        if line.startswith("done"):
            self.done += 1
            return ("milestone", line.split()[1] + " pulled")
        return None

    def activity(self):
        text = "Pulling images  {}  {}/{} images".format(
            progress_bar(self.done, self.total), self.done, self.total)
        return text + (" · " + fmt_bytes(self.bytes) if self.bytes else "")


register_phases(["Checks", "Build", "Launch"])

# ── Phase 1 · steps: one collapsing line each, with detail / skip ────────────
with phase("Checks"):
    with step("Docker") as s:
        time.sleep(0.7)
        s.detail("28.5.1")
    with step("Optional service") as s:
        s.skip("not configured")            # ○ — a benign no-op, never an error
    with step("Reading config") as s:
        print("this noisy line is captured, not shown")   # only surfaces on failure

# ── Phase 2 · a subprocess turned into one live line + milestones ────────────
with phase("Build"):
    pull = FakePull()
    script = ("for i in 1 2 3; do for j in 1 2 3; do echo layer $j; sleep 0.2; done; "
              "echo done image$i; done")
    if FAIL:
        script += "; echo 'Error response from daemon: failed to resolve reference: not found' >&2; exit 18"
    rc, output = run_with_activity(["bash", "-c", script],
                                   label="Pulling images", parse=pull.feed)
    if rc != 0:
        # An expected failure is a NOTE, not an error: cause + what happens instead.
        note("Prebuilt images for sha-205aedf73de2 aren't published — using local images")

# ── Phase 3 · folding, and a real failure card ───────────────────────────────
with phase("Launch"):
    with step("Starting server") as s:
        time.sleep(0.5)
        if FAIL:
            s.fail()
    if show_detail():   # routine detail: hidden inside a phase unless -v
        console.print("[muted]server pid 4242 · http://localhost:8000[/muted]")

if FAIL:
    console.print(failure_card(
        "Demo service",
        {"cause": "port 8000 is still taken",
         "detail": "Another process was holding port 8000 when the service tried to bind to it.",
         "evidence": "ERROR:    [Errno 98] Address already in use",
         "actions": ["lsof -i :8000", "demo --stop, then re-run"]},
        log_file="logs/demo.log",
        consequence="Startup continues — the demo falls back to the in-process runner."))

console.print(ready_panel(
    "Demo is ready",
    [("URL", "http://localhost:8000", "up"),
     ("Mode", "Local + Dev"),
     ("Hardware", "No accelerator (demo)")],
    ["[muted]Stop · demo --stop[/muted]", "[muted]Logs · demo --logs[/muted]"]))
