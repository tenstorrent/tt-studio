# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""End-to-end tests for the NDJSON stream: a real child process running the
CLI, asserting stdout is pure, parseable, stable-keyed NDJSON with no ANSI —
including when stdout is a genuine PTY (where Rich would otherwise colorize).

Uses `--status --json` as the vehicle because it exercises the emitter, the
stdout/stderr split, and the CLI dispatch without starting or stopping any
service (its health probes are read-only GETs)."""
import json
import os
import subprocess
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# TT_STUDIO_ROOT is os.getcwd(), so run from the repo root like run.py does.
_CHILD = ("import sys; sys.argv = ['run.py', '--status', '--json']; "
          "from tt_setup.cli import main; main()")


def _parse_stream(text):
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class TestJsonStream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.run(
            [sys.executable, "-c", _CHILD],
            capture_output=True, text=True, cwd=REPO_ROOT, timeout=120,
        )

    def test_exits_zero(self):
        self.assertEqual(self.proc.returncode, 0, self.proc.stderr)

    def test_stdout_is_parseable_ndjson(self):
        records = _parse_stream(self.proc.stdout)   # raises on any junk line
        self.assertTrue(records)

    def test_stdout_has_no_ansi_escapes(self):
        self.assertNotIn("\x1b", self.proc.stdout)

    def test_records_are_stable_keyed(self):
        for rec in _parse_stream(self.proc.stdout):
            self.assertEqual(list(rec.keys()), ["v", "ts", "event", "phase", "detail"])
            self.assertEqual(rec["v"], 1)
            self.assertIsInstance(rec["ts"], float)
            self.assertIsInstance(rec["detail"], dict)

    def test_status_dump_shape(self):
        records = _parse_stream(self.proc.stdout)
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec["event"], "status")
        self.assertIsNone(rec["phase"])
        detail = rec["detail"]
        self.assertIn("head", detail)
        self.assertIn("hardware", detail)
        names = {s["name"] for s in detail["services"]}
        self.assertIn("Frontend", names)
        self.assertIn("Backend", names)
        for svc in detail["services"]:
            self.assertEqual(set(svc), {"name", "port", "url", "healthy"})
            self.assertIsInstance(svc["healthy"], bool)


@unittest.skipUnless(hasattr(os, "openpty"), "requires a Unix PTY")
class TestJsonStreamOnPty(unittest.TestCase):
    def test_stdout_stays_pure_ndjson_on_a_real_pty(self):
        # With stdout a genuine terminal, Rich would normally emit color/cursor
        # escapes — the machine mode must keep them off the event stream.
        master, slave = os.openpty()
        try:
            proc = subprocess.Popen(
                [sys.executable, "-c", _CHILD],
                stdout=slave, stderr=subprocess.DEVNULL, cwd=REPO_ROOT,
            )
            os.close(slave)
            slave = -1
            chunks = []
            while True:
                try:
                    chunk = os.read(master, 4096)
                except OSError:   # EIO on Linux once the child side closes
                    break
                if not chunk:
                    break
                chunks.append(chunk)
            self.assertEqual(proc.wait(timeout=120), 0)
        finally:
            if slave != -1:
                os.close(slave)
            os.close(master)
        # A PTY renders \n as \r\n; normalize before parsing.
        out = b"".join(chunks).decode("utf-8", errors="replace").replace("\r\n", "\n")
        self.assertNotIn("\x1b", out)
        records = _parse_stream(out)
        self.assertEqual([r["event"] for r in records], ["status"])


if __name__ == "__main__":
    unittest.main()
