# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"""Fake run.py for the desktop launcher's integration tests.

Emits canned `--json-events` NDJSON streams on stdout (schema per
dev-docs/json-events.md) selected by the FAKE_RUN_SCENARIO env var:
success (default), failure, prompt_blocked, slow. `--stop` in argv takes a
plain-text teardown path and exits 0. Human chatter goes to stderr, like the
real launcher.

Mirrors run.py's TT_STUDIO_ROOT-from-cwd contract: refuses to run (exit 3)
when the current directory doesn't contain run.py, so a spawner with the
wrong cwd fails loudly in tests.
"""

import json
import os
import sys
import time


def emit(event, phase=None, detail=None, ts=1000.0):
    line = {"v": 1, "ts": ts, "event": event, "phase": phase, "detail": detail or {}}
    print(json.dumps(line), flush=True)


def main():
    if not os.path.isfile(os.path.join(os.getcwd(), "run.py")):
        print("fake_run: cwd is not a checkout (no run.py)", file=sys.stderr)
        return 3

    print("human-facing chatter belongs on stderr", file=sys.stderr)

    if "--stop" in sys.argv:
        print("stopping containers (fake)", flush=True)
        return 0

    if "--report-bug" in sys.argv:
        # Mirror tt_setup/bug_report.py: write logs/tt-studio-logs-ttbr-*.zip.
        import zipfile

        os.makedirs("logs", exist_ok=True)
        path = os.path.join("logs", "tt-studio-logs-ttbr-abcdef123456.zip")
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("system_info.json", "{}")
        print("Bundle      →  %s" % path, flush=True)
        return 0

    scenario = os.environ.get("FAKE_RUN_SCENARIO", "success")

    if scenario == "success":
        emit("phase_begin", "Checks", {"index": 1, "total": 2})
        emit("progress", "Checks", {"activity": "tt-smi"})
        emit("phase_end", "Checks", {"index": 1, "status": "ok", "duration_s": 0.1})
        emit("phase_begin", "Launch", {"index": 2, "total": 2})
        emit("phase_end", "Launch", {"index": 2, "status": "ok", "duration_s": 0.2})
        emit(
            "ready",
            None,
            {
                "urls": {"app": "http://localhost:3000"},
                "hardware": "Fake QuietBox · 2 device(s)",
            },
        )
        return 0

    if scenario == "failure":
        emit("phase_begin", "Launch", {"index": 1, "total": 1})
        emit(
            "error",
            "Launch",
            {
                "message": "Inference server didn't start — port 8001 is still taken",
                "remediation": "lsof -i :8001; python run.py --stop, then re-run",
                "service": "Inference server",
                "log": "fastapi.log",
            },
        )
        emit("phase_end", "Launch", {"index": 1, "status": "failed"})
        return 1

    if scenario == "prompt_blocked":
        emit("phase_begin", "Configure", {"index": 1, "total": 2})
        emit(
            "prompt_blocked",
            "Configure",
            {
                "prompt": "A Hugging Face token is required for gated models",
                "remediation": "set HF_TOKEN in .env, or run: python run.py",
            },
        )
        return 2

    if scenario == "slow":
        # Drip progress long enough for a test to observe and kill us.
        emit("phase_begin", "Checks", {"index": 1, "total": 5})
        for i in range(240):
            emit("progress", "Checks", {"activity": "step %d" % i})
            time.sleep(0.25)
        return 0

    print("fake_run: unknown scenario %r" % scenario, file=sys.stderr)
    return 4


if __name__ == "__main__":
    sys.exit(main())
