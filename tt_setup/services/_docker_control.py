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


def cleanup_docker_control_service(no_sudo=False):
    """Stop only a known legacy host Docker Control process.

    This deliberately does not scan or kill whatever happens to listen on
    port 8002.  The new service has no host listener, and an unrelated process
    must never be terminated by TT-Studio cleanup.
    """
    pid_path = DOCKER_CONTROL_PID_FILE
    try:
        with open(pid_path, "r") as f:
            raw_pid = f.read().strip()
        if raw_pid.isdigit():
            pid = int(raw_pid)
            if _is_legacy_docker_control_process(pid):
                try:
                    os.kill(pid, signal.SIGTERM)
                    time.sleep(2)
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        pass
                    else:
                        os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    if not no_sudo:
                        subprocess.run(["sudo", "kill", "-15", str(pid)], check=False)
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
