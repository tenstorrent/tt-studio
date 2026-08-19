# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the NDJSON event emitter (tt_setup/console/_events.py)."""
import io
import json
import sys
import unittest

from tt_setup.console import _events as events


class TestEventEmitter(unittest.TestCase):
    def tearDown(self):
        # The emitter is module-global state; never leak it into other tests.
        events.disable()

    def _enable_buffer(self):
        buf = io.StringIO()
        events.enable(stream=buf)
        return buf

    def test_disabled_by_default_and_emit_is_noop(self):
        self.assertFalse(events.enabled())
        # Must not raise (and must write nowhere) while disabled.
        events.emit("note", detail={"text": "ignored"})

    def test_emit_writes_one_stable_keyed_json_line(self):
        buf = self._enable_buffer()
        events.emit("phase_begin", phase="Checks", detail={"index": 1, "total": 5})
        lines = buf.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        rec = json.loads(lines[0])
        # Key order is part of the schema contract (stable for consumers).
        self.assertEqual(list(rec.keys()), ["v", "ts", "event", "phase", "detail"])
        self.assertEqual(rec["v"], events.SCHEMA_VERSION)
        self.assertIsInstance(rec["ts"], float)
        self.assertEqual(rec["event"], "phase_begin")
        self.assertEqual(rec["phase"], "Checks")
        self.assertEqual(rec["detail"], {"index": 1, "total": 5})

    def test_phase_defaults_to_null_and_detail_to_empty(self):
        buf = self._enable_buffer()
        events.emit("warn")
        rec = json.loads(buf.getvalue())
        self.assertIsNone(rec["phase"])
        self.assertEqual(rec["detail"], {})

    def test_stream_is_parseable_ndjson(self):
        buf = self._enable_buffer()
        events.emit("phase_begin", phase="Checks")
        events.emit("progress", phase="Checks", detail={"activity": "tt-smi"})
        events.emit("phase_end", phase="Checks", detail={"status": "ok"})
        records = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual([r["event"] for r in records],
                         ["phase_begin", "progress", "phase_end"])

    def test_ready_event_carries_urls_and_hardware(self):
        buf = self._enable_buffer()
        events.emit_ready(
            urls={"app": "http://localhost:3000",
                  "fastapi": "http://localhost:8001",
                  "docker_control": "http://localhost:8002"},
            hardware="QuietBox (QB2)")
        rec = json.loads(buf.getvalue())
        self.assertEqual(rec["event"], "ready")
        self.assertEqual(rec["detail"]["urls"]["app"], "http://localhost:3000")
        self.assertEqual(rec["detail"]["urls"]["fastapi"], "http://localhost:8001")
        self.assertEqual(rec["detail"]["urls"]["docker_control"], "http://localhost:8002")
        self.assertEqual(rec["detail"]["hardware"], "QuietBox (QB2)")

    def test_error_event_carries_remediation(self):
        buf = self._enable_buffer()
        events.emit_error("inference server didn't start",
                          remediation="tail -50 fastapi.log", phase="Launch",
                          service="Inference server")
        rec = json.loads(buf.getvalue())
        self.assertEqual(rec["event"], "error")
        self.assertEqual(rec["phase"], "Launch")
        self.assertEqual(rec["detail"]["remediation"], "tail -50 fastapi.log")
        self.assertEqual(rec["detail"]["service"], "Inference server")

    def test_prompt_blocked_event(self):
        buf = self._enable_buffer()
        events.emit_prompt_blocked("Enter your HF token",
                                   remediation="set HF_TOKEN in .env")
        rec = json.loads(buf.getvalue())
        self.assertEqual(rec["event"], "prompt_blocked")
        self.assertEqual(rec["detail"]["prompt"], "Enter your HF token")
        self.assertIn("HF_TOKEN", rec["detail"]["remediation"])

    def test_non_serializable_detail_degrades_to_str(self):
        buf = self._enable_buffer()
        events.emit("note", detail={"obj": object()})
        rec = json.loads(buf.getvalue())  # default=str keeps the line valid JSON
        self.assertIsInstance(rec["detail"]["obj"], str)

    def test_broken_stream_never_raises(self):
        class Broken:
            def write(self, _):
                raise BrokenPipeError
            def flush(self):
                raise BrokenPipeError
        events.enable(stream=Broken())
        events.emit("note", detail={"text": "consumer went away"})  # must not raise

    def test_enable_with_explicit_stream_leaves_stdout_alone(self):
        before = sys.stdout
        self._enable_buffer()
        self.assertIs(sys.stdout, before)

    def test_enable_redirects_stdout_and_disable_restores(self):
        before = sys.stdout
        events.enable()
        try:
            self.assertIs(sys.stdout, sys.stderr)
            events.emit("note", detail={"text": "goes to the captured stdout"})
        finally:
            events.disable()
        self.assertIs(sys.stdout, before)
        self.assertFalse(events.enabled())

    def test_enable_is_idempotent(self):
        buf = self._enable_buffer()
        events.enable()  # second call must not steal stdout or reset the stream
        events.emit("note")
        self.assertTrue(buf.getvalue())

    def test_plain_strips_rich_markup(self):
        self.assertEqual(events.plain("[warning]⚠  tt-smi missing[/warning]"),
                         "⚠  tt-smi missing")
        self.assertEqual(events.plain("no markup"), "no markup")


if __name__ == "__main__":
    unittest.main()
