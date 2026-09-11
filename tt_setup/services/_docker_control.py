# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Compatibility helpers for the Compose-managed Docker Control service.

Docker Control used to run as a host-side Uvicorn process.  The service now
lives in the Compose stack so the backend can reach it over the private bridge
without exposing host port 8002.  The cleanup helper remains intentionally
small to remove a legacy host process left by an older TT-Studio install.
"""

import os
import signal
import subprocess
import time

from tt_setup.constants import DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_SERVICE_DIR
from tt_setup.console import console


def _legacy_pid_command(pid):
    """Return the command for *pid*, or an empty string if it cannot be read."""
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            check=False,
        )
        return (result.stdout or "").strip()
    except Exception:
        return ""


def _is_legacy_docker_control_process(pid):
    """Avoid killing a different process if an old PID file was recycled."""
    command = _legacy_pid_command(pid).lower()
    if not command:
        return False
    return "docker-control-service" in command or DOCKER_CONTROL_SERVICE_DIR.lower() in command


def _legacy_docker_control_listener_pids():
    """Return port-8002 listeners whose command identifies legacy Docker Control.

    A missing or stale PID file is common after an upgrade, so the migration
    path also checks the old public port.  It deliberately validates every PID
    before returning it: port 8002 may belong to an unrelated local service.
    """
    try:
        result = subprocess.run(
            ["lsof", "-nP", "-tiTCP:8002", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
    except (FileNotFoundError, OSError):
        return []

    pids = {int(raw_pid) for raw_pid in (result.stdout or "").split() if raw_pid.isdigit()}
    return [pid for pid in pids if _is_legacy_docker_control_process(pid)]


def _stop_legacy_docker_control_process(pid, no_sudo=False):
    """Terminate a process already proven to be legacy Docker Control."""
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(2)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    except PermissionError:
        if not no_sudo:
            subprocess.run(["sudo", "kill", "-15", str(pid)], check=False)
            time.sleep(1)
            try:
                os.kill(pid, 0)
                subprocess.run(["sudo", "kill", "-9", str(pid)], check=False)
            except (ProcessLookupError, PermissionError):
                pass
        else:
            console.print(
                f"[warning]Permission denied stopping legacy Docker Control (PID {pid}). "
                "Re-run without --no-sudo or kill PID manually.[/warning]"
            )


def cleanup_docker_control_service(no_sudo=False):
    """Stop known legacy host Docker Control processes.

    Besides the old PID-file path, this safely discovers a legacy process that
    still listens on port 8002 after an upgrade.  It never stops an arbitrary
    port-8002 listener: each process must identify itself as Docker Control.
    """
    pid_path = DOCKER_CONTROL_PID_FILE
    cleaned_pids = set()
    try:
        with open(pid_path, "r") as f:
            raw_pid = f.read().strip()
        if raw_pid.isdigit():
            pid = int(raw_pid)
            if _is_legacy_docker_control_process(pid):
                _stop_legacy_docker_control_process(pid, no_sudo=no_sudo)
                cleaned_pids.add(pid)
            else:
                console.print(
                    f"[warning]Ignoring stale Docker Control PID file {pid_path}; "
                    "the recorded process is not Docker Control.[/warning]"
                )
    except FileNotFoundError:
        pass
    except Exception as exc:
        console.print(f"[warning]Could not clean up legacy Docker Control process: {exc}[/warning]")
    finally:
        try:
            os.remove(pid_path)
        except FileNotFoundError:
            pass
        except OSError:
            pass

    # PID files are not reliable across upgrades.  Scan the former host port
    # as a migration step, but kill only listeners we can positively identify.
    for pid in _legacy_docker_control_listener_pids():
        if pid not in cleaned_pids:
            _stop_legacy_docker_control_process(pid, no_sudo=no_sudo)
