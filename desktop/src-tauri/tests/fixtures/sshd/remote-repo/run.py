# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Fake TT-Studio launcher for the desktop e2e tests.

Speaks the real machine-readable protocol (dev-docs/json-events.md on the
json-events branch) without any Docker: `--status --json` dumps a status
event, `--json-events` emits a canned bring-up (starting fake_stack.py, the
stub HTTP stand-in for the frontend/backend) ending in `ready`, and `--stop`
kills the stub stack. Baked into the sshd fixture image at
/home/tunnel/tt-studio.
"""

import json
import os
import signal
import socket
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PID_FILE = "/tmp/fake-stack.pid"
STACK_PORTS = [3000, 8000, 8001, 8002]
SERVICES = ["frontend", "backend", "inference server", "docker control"]


def emit(event, phase=None, detail=None):
    line = {"v": 1, "ts": time.time(), "event": event, "phase": phase, "detail": detail or {}}
    print(json.dumps(line), flush=True)


def stack_running():
    if not os.path.exists(PID_FILE):
        return False
    try:
        with open(PID_FILE) as f:
            os.kill(int(f.read().strip()), 0)
        return True
    except (OSError, ValueError):
        return False


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def cmd_status():
    healthy = stack_running()
    emit(
        "status",
        detail={
            "services": [
                {"name": name, "port": port, "url": f"http://localhost:{port}", "healthy": healthy}
                for name, port in zip(SERVICES, STACK_PORTS)
            ],
            "head": "deadbee",
            "hardware": "fixture",
        },
    )


def cmd_bring_up():
    emit("phase_begin", "Checks", {"index": 1, "total": 2})
    emit("progress", "Checks", {"activity": "fixture preflight"})
    emit("phase_end", "Checks", {"index": 1, "status": "ok", "duration_s": 0.1})

    emit("phase_begin", "Launch", {"index": 2, "total": 2})
    if not stack_running():
        # Detached (new session, no inherited stdio) so it survives this
        # process — and the SSH exec channel — going away.
        subprocess.Popen(
            [sys.executable, os.path.join(HERE, "fake_stack.py")],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    deadline = time.time() + 15
    while time.time() < deadline:
        if all(port_open(p) for p in STACK_PORTS):
            break
        time.sleep(0.2)
    else:
        emit(
            "error",
            "Launch",
            {"message": "fake stack never opened its ports", "remediation": "n/a (test fixture)"},
        )
        emit("phase_end", "Launch", {"index": 2, "status": "failed"})
        sys.exit(1)
    emit("phase_end", "Launch", {"index": 2, "status": "ok", "duration_s": 0.5})
    emit(
        "ready",
        detail={"urls": {"app": "http://localhost:3000"}, "hardware": "fixture"},
    )


def cmd_stop():
    if stack_running():
        with open(PID_FILE) as f:
            os.kill(int(f.read().strip()), signal.SIGTERM)
        os.unlink(PID_FILE)
        print("Stopped the TT-Studio stack.")
    else:
        print("Nothing to stop.")


def main():
    args = sys.argv[1:]
    if "--status" in args and "--json" in args:
        cmd_status()
    elif "--json-events" in args:
        cmd_bring_up()
    elif "--stop" in args:
        cmd_stop()
    else:
        print("fake run.py: unsupported arguments", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
