# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Compatibility helpers for the Compose-managed Docker Control service.

Docker Control used to run as a host-side Uvicorn process.  The service now
lives in the Compose stack so the backend can reach it over the private bridge
without exposing host port 8002.  The cleanup helper remains intentionally
small to remove a legacy host process left by an older TT-Studio install.
"""

import os
import re
import shutil
import subprocess

from tt_setup.constants import DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_SERVICE_DIR
from tt_setup.console import console
from tt_setup.services._ports import (
    _find_supervisor_wrapper_pid,
    _terminate_pid_graceful_then_force,
    kill_process_on_port,
)


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
    """Avoid killing a different process if an old PID file was recycled.

    Matches if the process command references docker-control-service, or if any
    ancestor in its process tree is a supervisor wrapper for docker-control-service.
    """
    command = _legacy_pid_command(pid).lower()
    if command and ("docker-control-service" in command or DOCKER_CONTROL_SERVICE_DIR.lower() in command):
        return True
    if _find_supervisor_wrapper_pid(pid):
        return True
    return False


def _legacy_docker_control_listener_pids():
    """Return port-8002 listeners whose command identifies legacy Docker Control.

    A missing or stale PID file is common after an upgrade, so the migration
    path also checks the old public port.  It deliberately validates every PID
    before returning it: port 8002 may belong to an unrelated local service.
    Supports both lsof and ss (Linux) to ensure listeners are discovered.
    """
    pids = set()
    try:
        result = subprocess.run(
            ["lsof", "-nP", "-tiTCP:8002", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
        pids.update(int(raw_pid) for raw_pid in (result.stdout or "").split() if raw_pid.isdigit())
    except (FileNotFoundError, OSError):
        pass

    # Fall back to ss on Linux systems where lsof is missing or returned nothing
    if not pids and shutil.which("ss"):
        try:
            result = subprocess.run(
                ["ss", "-lptn", "sport = :8002"],
                capture_output=True,
                text=True,
                check=False,
            )
            pids.update(int(m) for m in re.findall(r"pid=(\d+)", result.stdout or ""))
        except (FileNotFoundError, OSError):
            pass

    return [pid for pid in pids if _is_legacy_docker_control_process(pid)]


def _stop_legacy_docker_control_process(pid, no_sudo=False):
    """Terminate a legacy Docker Control process and any parent supervisor wrapper."""
    use_sudo = not no_sudo and hasattr(os, "geteuid") and os.geteuid() != 0

    # Stop supervisor wrapper first if one exists in the process tree.
    # Killing only the socket holder leaves the supervisor loop alive to respawn
    # its child ~2 seconds later and recapture the port (Issue #1307).
    supervisor_pid = _find_supervisor_wrapper_pid(pid)
    if supervisor_pid and supervisor_pid != pid:
        console.print(f"[muted]   Stopping legacy Docker Control supervisor wrapper (pid {supervisor_pid})…[/muted]")
        _terminate_pid_graceful_then_force(supervisor_pid, use_sudo=use_sudo, quiet=True)

    # Terminate the identified listener process itself
    _terminate_pid_graceful_then_force(pid, use_sudo=use_sudo, quiet=True)


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
            cleaned_pids.add(pid)

    # Final guard: if any legacy listener was cleaned up, ensure port 8002 is freed
    if cleaned_pids:
        kill_process_on_port(8002, no_sudo=no_sudo, quiet=True)
