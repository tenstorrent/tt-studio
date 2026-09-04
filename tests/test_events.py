# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the NDJSON event emitter (tt_setup/console/_events.py)."""
import io
import json
import sys
import unittest
from unittest.mock import patch

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


class TestStepperEventTaps(unittest.TestCase):
    """The phase-lifecycle taps in tt_setup/console/_stepper.py."""

    def setUp(self):
        from tt_setup.console import _stepper as stepper
        self.stepper = stepper
        self.buf = io.StringIO()
        events.enable(stream=self.buf)

    def tearDown(self):
        events.disable()

    def _records(self):
        return [json.loads(line) for line in self.buf.getvalue().splitlines()]

    def test_phase_lifecycle_emits_begin_progress_end(self):
        ph = self.stepper.begin_phase(1, 5, "Checks")
        ph.set("tt-smi")
        self.stepper.end_phase(ph)
        recs = self._records()
        self.assertEqual([r["event"] for r in recs],
                         ["phase_begin", "progress", "phase_end"])
        self.assertTrue(all(r["phase"] == "Checks" for r in recs))
        self.assertEqual(recs[0]["detail"], {"index": 1, "total": 5})
        self.assertEqual(recs[1]["detail"], {"activity": "tt-smi"})
        self.assertEqual(recs[2]["detail"]["status"], "ok")
        self.assertIn("duration_s", recs[2]["detail"])

    def test_failed_phase_reports_failed_status(self):
        ph = self.stepper.begin_phase(2, 5, "Configure")
        ph.fail()
        self.stepper.end_phase(ph)
        recs = self._records()
        self.assertEqual(recs[-1]["event"], "phase_end")
        self.assertEqual(recs[-1]["detail"]["status"], "failed")

    def test_stop_active_phase_emits_failed_end(self):
        self.stepper.begin_phase(4, 5, "Build")
        self.stepper.stop_active_phase()
        recs = self._records()
        self.assertEqual(recs[-1]["event"], "phase_end")
        self.assertEqual(recs[-1]["phase"], "Build")
        self.assertEqual(recs[-1]["detail"]["status"], "failed")

    def test_stop_with_no_active_phase_emits_nothing(self):
        self.stepper.stop_active_phase()
        self.assertEqual(self.buf.getvalue(), "")

    def test_add_note_emits_plain_text_warn(self):
        self.stepper.add_note("[warning]⚠  tt-smi not installed[/warning]")
        recs = self._records()
        self.assertEqual(recs[-1]["event"], "warn")
        self.assertEqual(recs[-1]["detail"]["text"], "⚠  tt-smi not installed")

    def test_rename_phase_emits_progress(self):
        self.stepper.begin_phase(4, 5, "Pull")
        self.stepper.rename_phase(4, "Build")
        recs = self._records()
        self.assertEqual(recs[-1]["event"], "progress")
        self.assertEqual(recs[-1]["phase"], "Build")
        self.assertEqual(recs[-1]["detail"]["kind"], "phase_renamed")
        self.stepper.stop_active_phase()

    def test_build_event_emits_progress(self):
        ph = self.stepper.begin_phase(4, 5, "Build")
        self.stepper.build_event("built", svc="frontend")
        self.stepper.end_phase(ph)
        recs = self._records()
        built = [r for r in recs if r["event"] == "progress"]
        self.assertEqual(built[-1]["detail"], {"kind": "built", "service": "frontend"})

    def test_taps_are_silent_when_disabled(self):
        events.disable()
        ph = self.stepper.begin_phase(1, 5, "Checks")   # must not raise
        self.stepper.end_phase(ph)
        self.assertEqual(self.buf.getvalue(), "")


class TestPromptBlocking(unittest.TestCase):
    """--json-events implies non-interactive: prompts must never hang the run."""

    def tearDown(self):
        events.disable()

    def test_prompts_exit_with_prompt_blocked_event_in_machine_mode(self):
        from tt_setup.console import _prompts
        buf = io.StringIO()
        events.enable(stream=buf)
        attempts = (
            lambda: _prompts.ask("Enter your HF token"),
            lambda: _prompts.confirm("Continue?"),
            lambda: _prompts.secret("Token: "),
        )
        for attempt in attempts:
            with self.assertRaises(SystemExit) as ctx:
                attempt()
            self.assertEqual(ctx.exception.code, 2)
        recs = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(len(recs), len(attempts))
        for rec in recs:
            self.assertEqual(rec["event"], "prompt_blocked")
            self.assertTrue(rec["detail"]["prompt"])
            self.assertIn("--json-events", rec["detail"]["remediation"])

    def test_prompts_behave_normally_when_disabled(self):
        from rich.prompt import Prompt
        from tt_setup.console import _prompts
        with patch.object(Prompt, "ask", return_value="answer"):
            self.assertEqual(_prompts.ask("Question?"), "answer")


class TestStatusJsonDump(unittest.TestCase):
    """`--status --json`: a one-shot state dump through the same emitter."""

    def tearDown(self):
        events.disable()

    def test_emits_one_status_event_with_services_head_and_hardware(self):
        from tt_setup import monitor
        buf = io.StringIO()
        events.enable(stream=buf)
        health = {s["health"]: s["name"] == "Frontend" for s in monitor.SERVICES}
        with patch.object(monitor, "snapshot_health", return_value=health), \
             patch.object(monitor, "_git_head", return_value="abc1234"), \
             patch.object(monitor, "_hardware_label",
                          return_value="QuietBox (QB2) · 2 chips"):
            rc = monitor.run_status_json()
        self.assertEqual(rc, 0)
        lines = buf.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        rec = json.loads(lines[0])
        self.assertEqual(rec["event"], "status")
        self.assertEqual(rec["detail"]["head"], "abc1234")
        self.assertEqual(rec["detail"]["hardware"], "QuietBox (QB2) · 2 chips")
        by_name = {s["name"]: s for s in rec["detail"]["services"]}
        self.assertEqual(set(by_name), {s["name"] for s in monitor.SERVICES})
        self.assertTrue(by_name["Frontend"]["healthy"])
        self.assertFalse(by_name["Backend"]["healthy"])
        self.assertEqual(by_name["Frontend"]["port"], 3000)


if __name__ == "__main__":
    unittest.main()
