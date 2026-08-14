# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Copy this into your repo's tests/ — the three checks that keep CLI output honest.

    python3 -m unittest test_cli_output -v      # or pytest

1. Pure helpers (bars, sizes, folding) — plain unit tests, no terminal needed.
2. Stream parsers/classifiers — real captured tool output as the fixture.
3. Render checks — a genuine PTY for anything animated, and a pipe check proving
   non-TTY output carries zero escape codes.

Point CONSOLE_MODULE at wherever you put console.py; adapt the parser tests to
your own aggregator.
"""

import os
import pty
import re
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

CONSOLE_MODULE = "console"      # e.g. "mycli.console" once it lives in your package
DEMO = os.path.join(HERE, "demo.py")

console = __import__(CONSOLE_MODULE, fromlist=["*"])


# ── 1. pure helpers ──────────────────────────────────────────────────────────
class TestPureHelpers(unittest.TestCase):
    def test_progress_bar_fills_left_to_right(self):
        self.assertEqual(console.progress_bar(0, 4, width=4), "▕░░░░▏")
        self.assertEqual(console.progress_bar(2, 4, width=4), "▕██░░▏")
        self.assertEqual(console.progress_bar(4, 4, width=4), "▕████▏")

    def test_unknown_total_renders_no_bar(self):
        # Say nothing rather than fake a percentage you don't have.
        self.assertEqual(console.progress_bar(3, 0), "")

    def test_bytes_use_decimal_units(self):
        self.assertEqual(console.fmt_bytes(12_110_000), "12.1 MB")
        self.assertEqual(console.fmt_bytes(0), "0 B")

    def test_folding_predicate(self):
        console.set_verbose(False)
        self.assertTrue(console.show_detail())        # outside a phase: shown
        console.set_verbose(True)
        self.assertTrue(console.show_detail())        # -v: always shown
        console.set_verbose(False)


# ── 2. stream parsing / failure classification ───────────────────────────────
# Paste REAL tool output here — the wording your parser must survive is the
# wording the tool actually prints, not the wording you imagined.
PULL_FAILED = """ Image ghcr.io/acme/app/backend:sha-205aedf73de2 Pulling
 Image ghcr.io/acme/app/backend:sha-205aedf73de2 Error failed to resolve reference \
"ghcr.io/acme/app/backend:sha-205aedf73de2": not found
Error response from daemon: failed to resolve reference: not found
"""


def classify_pull_failure(output):
    """Replace with your own; kept here so the test file runs standalone."""
    text = (output or "").lower()
    if not text.strip():
        return "unknown"
    if any(k in text for k in ("dial tcp", "no such host", "i/o timeout", "tls handshake")):
        return "unreachable"
    if any(k in text for k in ("unauthorized", "authentication required", "denied")):
        return "auth"
    if any(k in text for k in ("not found", "manifest unknown", "name unknown")):
        return "unpublished"
    return "unknown"


class TestFailureClassification(unittest.TestCase):
    def test_missing_tag_is_unpublished(self):
        self.assertEqual(classify_pull_failure(PULL_FAILED), "unpublished")

    def test_offline_wins_over_missing_manifest(self):
        # An offline machine reports both; "you're offline" is the useful half.
        out = "dial tcp: lookup ghcr.io: no such host\nmanifest unknown"
        self.assertEqual(classify_pull_failure(out), "unreachable")

    def test_empty_output_is_unknown(self):
        self.assertEqual(classify_pull_failure(""), "unknown")


# ── 3. render checks ─────────────────────────────────────────────────────────
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def plain(raw):
    """Visible text only. Assert on THIS, not the raw bytes: styling puts escape
    codes between the glyph and its label, so `"✓ Docker" in raw` is never true."""
    return ANSI.sub("", raw).replace("\r", "\n")


def run_in_pty(argv, columns=100):
    """Run a command under a real PTY and return everything it wrote."""
    chunks = []

    def read(fd):
        data = os.read(fd, 1024)
        chunks.append(data)
        return data

    env_cols = os.environ.get("COLUMNS")
    os.environ["COLUMNS"] = str(columns)
    try:
        pty.spawn(argv, read)
    finally:
        if env_cols is None:
            os.environ.pop("COLUMNS", None)
        else:
            os.environ["COLUMNS"] = env_cols
    return b"".join(chunks).decode("utf8", "replace")


class TestRendering(unittest.TestCase):
    def test_piped_output_has_no_escape_codes(self):
        result = subprocess.run([sys.executable, DEMO], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("\x1b", result.stdout, "non-TTY output must be escape-free")

    def test_tty_run_animates_and_collapses(self):
        raw = run_in_pty([sys.executable, DEMO])
        self.assertTrue(any(f in raw for f in console.SPINNER_FRAMES), "spinner never drew")
        self.assertIn("\r\x1b[2K", raw, "spinner row is never erased before its result")
        visible = plain(raw)
        self.assertIn("✓ Docker", visible, "step never collapsed to a result line")
        self.assertIn("○ Optional service", visible, "skip never rendered as ○")
        self.assertIn("Phase 3/3", visible, "phases never completed")

    def test_body_lines_never_share_the_activity_row(self):
        raw = run_in_pty([sys.executable, DEMO])
        for line in plain(raw).splitlines():
            if "pulled" in line:
                self.assertFalse(any(f in line for f in console.SPINNER_FRAMES),
                                 "milestone printed onto the live activity row: " + line)

    def test_failure_run_shows_a_card_not_a_dump(self):
        visible = plain(run_in_pty([sys.executable, DEMO, "--fail"]))
        self.assertIn("port 8000 is still taken", visible, "no diagnosis in the card title")
        self.assertIn("Try:", visible, "card offers no next step")
        self.assertNotIn("Error response from daemon", visible, "raw tool error reached the user")


if __name__ == "__main__":
    unittest.main()
