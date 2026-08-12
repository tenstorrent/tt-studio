# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker Control service lifecycle: start + cleanup."""

import os
import subprocess
import time
import tempfile
import signal
from datetime import datetime
try:
    import requests  # noqa: F401
    HAS_REQUESTS = True
except ImportError:
    import urllib.request  # noqa: F401
    HAS_REQUESTS = False
from tt_setup.constants import *
from tt_setup.venv_utils import print_manual_fix_steps, recreate_venv_if_stale
from tt_setup.env_config import get_env_var
from tt_setup.docker import check_docker_access
from tt_setup.console import console, progress_status, show_detail
from tt_setup.services._ports import check_port_available, kill_process_on_port


def archive_docker_control_log():
    """Move the current service log into logs/docker_control_logs/, timestamped.

    Mirrors how model_run_logs/ keeps one file per deployment: a stable live log
    plus a timestamped archive, named
    ``docker-control-service_<YYYY-MM-DD_HH-MM-SS>.log``. Needed because the log
    is truncated on every start, so without this the record of why the previous
    instance died is lost exactly when you restart to investigate it.

    No-op when the log is missing or empty, so a fresh start doesn't litter the
    archive with empty files. Best-effort: never blocks startup.
    """
    try:
        if not (os.path.isfile(DOCKER_CONTROL_LOG_FILE)
                and os.path.getsize(DOCKER_CONTROL_LOG_FILE) > 0):
            return None
        os.makedirs(DOCKER_CONTROL_LOGS_DIR, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        dest = os.path.join(
            DOCKER_CONTROL_LOGS_DIR, f"docker-control-service_{stamp}.log"
        )
        os.replace(DOCKER_CONTROL_LOG_FILE, dest)
        return dest
    except Exception:
        return None


def _stop_supervisor(process):
    """Stop the wrapper so a failed start leaves nothing running.

    The wrapper supervises uvicorn in a restart loop and lives in its own session,
    so without this an unsuccessful start would leave that loop respawning every
    three seconds forever — unreported, and appending to the log indefinitely.
    SIGTERM triggers the wrapper's own shutdown handler, which takes uvicorn and
    its children down; waiting also reaps it instead of leaving a zombie.
    """
    if process is None or process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=10)
    except Exception:
        try:
            process.kill()
            process.wait(timeout=5)
        except Exception:
            pass


def start_docker_control_service(no_sudo=False, dev_mode=False):
    """Start the Docker Control Service on port 8002."""
    mode_label = " (dev/reload)" if dev_mode else ""
    console.print(f"[info]🔧 Starting Docker Control Service{mode_label}...[/info]")

    # The venv-create + bash wrapper (.sh + chmod) path below is POSIX-only. TT
    # Studio's launcher supports macOS/Linux; on other platforms degrade cleanly
    # instead of failing deep on chmod / a bash script.
    if os.name != "posix":
        console.print("[warning]⚠️  The Docker Control Service launcher supports macOS/Linux only; skipping it here.[/warning]")
        console.print("[muted]   Backend will use the direct Docker SDK instead.[/muted]")
        return False

    # Check if user has Docker access
    if not check_docker_access():
        console.print("[warning]⚠️  Docker Control Service requires direct Docker socket access[/warning]")
        console.print("[warning]   (660 permissions detected - service would need sudo which is not supported)[/warning]")
        console.print("[muted]   Skipping Docker Control Service - Backend will use direct Docker SDK instead[/muted]")
        return False

    # Check if port 8002 is available
    if not check_port_available(8002):
        if not kill_process_on_port(8002, no_sudo=no_sudo):
            console.print("[error]❌ Failed to free port 8002. Please manually stop any process using this port.[/error]")
            return False

    # Check if service is already running
    if HAS_REQUESTS:
        try:
            response = requests.get("http://127.0.0.1:8002/api/v1/health", timeout=2)
            if response.status_code == 200:
                if show_detail():  # confirmation folds into the Services phase line
                    console.print("[success]✅ Docker Control Service already running[/success]")
                return True
        except requests.exceptions.RequestException:
            pass

    # Check if service directory exists
    if not os.path.exists(DOCKER_CONTROL_SERVICE_DIR):
        console.print(f"[error]⛔ Error: Docker Control Service directory not found at {DOCKER_CONTROL_SERVICE_DIR}[/error]")
        return False

    # Preserve the previous instance's log before truncating it below. A plain
    # `python run.py` restart does not go through cleanup_docker_control_service,
    # so without this the record of why the last instance died is lost exactly
    # when you restart to investigate it.
    archive_docker_control_log()

    # Create PID and log files
    for file_path in [DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE]:
        try:
            with open(file_path, 'w') as f:
                pass
            os.chmod(file_path, 0o644)
        except Exception as e:
            console.print(f"[warning]Warning: Could not create {file_path}: {e}[/warning]")

    # Check for virtual environment
    venv_dir = os.path.join(DOCKER_CONTROL_SERVICE_DIR, ".venv")

    # Create virtual environment and install dependencies if needed
    if not os.path.exists(venv_dir) or recreate_venv_if_stale(venv_dir, C_YELLOW, C_RESET):
        try:
            subprocess.run(
                ["python3", "-m", "venv", ".venv"],
                cwd=DOCKER_CONTROL_SERVICE_DIR,
                check=True
            )
        except Exception as e:
            console.print(f"[error]⛔ Error creating virtual environment: {e}[/error]")
            print_manual_fix_steps(DOCKER_CONTROL_SERVICE_DIR, "requirements-api.txt", C_YELLOW, C_RESET)
            return False

    # Check if requirements are installed
    requirements_file = os.path.join(DOCKER_CONTROL_SERVICE_DIR, "requirements-api.txt")
    if not os.path.exists(requirements_file):
        console.print(f"[error]⛔ Error: requirements-api.txt not found at {requirements_file}[/error]")
        return False

    # Install/upgrade dependencies
    venv_pip = os.path.join(venv_dir, "bin", "pip")
    if OS_NAME == "Windows":
        venv_pip = os.path.join(venv_dir, "Scripts", "pip.exe")

    try:
        subprocess.run(
            [venv_pip, "install", "--upgrade", "pip"],
            cwd=DOCKER_CONTROL_SERVICE_DIR,
            capture_output=True,
            check=True
        )
        subprocess.run(
            [venv_pip, "install", "-r", "requirements-api.txt"],
            cwd=DOCKER_CONTROL_SERVICE_DIR,
            capture_output=True,
            check=True
        )
    except Exception as e:
        console.print(f"[error]⛔ Error installing dependencies: {e}[/error]")
        return False

    # Get environment variables for the service
    jwt_secret = get_env_var("DOCKER_CONTROL_JWT_SECRET")

    # Export environment variables
    env = os.environ.copy()
    if jwt_secret:
        env["DOCKER_CONTROL_JWT_SECRET"] = jwt_secret
    env["DOCKER_CONTROL_LOG_FILE"] = DOCKER_CONTROL_LOG_FILE
    env["STARTUP_LOG_FILE"] = STARTUP_LOG_FILE
    env["MODEL_RUN_LOG_FILE"] = MODEL_RUN_LOG_FILE

    # Start the service using uvicorn
    temp_script_path = None  # so the finally cleanup is safe if creation fails
    process = None
    try:
        # Create a temporary wrapper script similar to FastAPI
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
            reload_flag = "--reload" if dev_mode else ""
            # Supervise uvicorn in a restart loop, mirroring the FastAPI wrapper.
            # The backend can see Docker only through this service, so if it dies
            # the whole Models Deployed view goes blind — it must come back on its
            # own. Output is appended so a restart within this wrapper's lifetime
            # keeps the crashed instance's log; across launcher restarts the
            # previous log is preserved by archive_docker_control_log().
            temp_script.write(f'''#!/bin/bash
cd "$1"
# Save PID to file
echo $$ > "$2"

CHILD_PID=""
# Forward shutdown to uvicorn so stopping this wrapper doesn't orphan it, and exit
# without tripping the restart loop.
#
# In dev mode uvicorn runs with --reload, which means $CHILD_PID is a *reloader*
# that spawns the actual server as a separate process. Signalling only the
# reloader can leave that spawned process alive, orphaned, and still holding port
# 8002 — so the service looks up when it is actually unmanaged, and the next start
# has to fight for the port. Signal the children too, then escalate if anything
# is still standing.
shutdown() {{
    # Ignore what we are about to send so this handler survives to finish.
    trap '' TERM INT
    if [ -n "$CHILD_PID" ]; then
        pkill -TERM -P "$CHILD_PID" 2>/dev/null
        kill -TERM "$CHILD_PID" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 "$CHILD_PID" 2>/dev/null || break
            sleep 0.5
        done
        pkill -KILL -P "$CHILD_PID" 2>/dev/null
        kill -KILL "$CHILD_PID" 2>/dev/null
    fi
    exit 0
}}
trap shutdown TERM INT
# Ignore hangup: closing the terminal or SSH session that ran run.py must not
# take the service (and with it the whole Models Deployed view) down.
trap "" HUP

RESTART_COUNT=0
while true; do
    "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8002 {reload_flag} >> "$4" 2>&1 &
    CHILD_PID=$!
    wait "$CHILD_PID"
    EXIT_CODE=$?
    CHILD_PID=""
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "[$(date)] Docker Control Service exited with code $EXIT_CODE (restart #$RESTART_COUNT) — restarting in 3s..." >> "$4"
    sleep 3
done
''')
            temp_script_path = temp_script.name

        # Make the script executable
        os.chmod(temp_script_path, 0o755)

        # Start the service
        cmd = [temp_script_path, DOCKER_CONTROL_SERVICE_DIR, DOCKER_CONTROL_PID_FILE, ".venv", DOCKER_CONTROL_LOG_FILE]
        # Detach into its own session so closing the terminal or SSH connection
        # that ran run.py doesn't SIGHUP the service out from under a running
        # model. cleanup_docker_control_service() still stops it via the PID file.
        process = subprocess.Popen(cmd, env=env, start_new_session=True)

        # Health check (silent — only prints on success or failure)
        health_check_retries = 30
        health_check_delay = 2

        with progress_status("Waiting for Docker Control Service…") as docker_ctl_spinner:
            for i in range(1, health_check_retries + 1):
                # Check if process is still running
                if process.poll() is not None:
                    console.print("[error]⛔ Docker Control Service process died[/error]")
                    try:
                        with open(DOCKER_CONTROL_LOG_FILE, 'r') as f:
                            lines = f.readlines()
                            for line in lines[-15:]:
                                console.print(f"   {line.rstrip()}", markup=False, highlight=False)
                    except:
                        pass
                    _stop_supervisor(process)
                    return False

                # Check if service is responding
                if HAS_REQUESTS:
                    try:
                        response = requests.get("http://127.0.0.1:8002/api/v1/health", timeout=5)
                        if response.status_code == 200:
                            if show_detail():
                                console.print("[success]✅ Docker Control Service ready at http://localhost:8002[/success]")
                            return True
                    except:
                        pass
                else:
                    try:
                        import urllib.request
                        response = urllib.request.urlopen("http://localhost:8002/api/v1/health", timeout=5)
                        if response.getcode() == 200:
                            if show_detail():
                                console.print("[success]✅ Docker Control Service ready at http://localhost:8002[/success]")
                            return True
                    except:
                        pass

                if i == health_check_retries:
                    console.print("[error]⛔ Docker Control Service failed to start[/error]")
                    console.print(f"   [muted]Check logs: tail -50 {DOCKER_CONTROL_LOG_FILE}[/muted]")
                    # Don't leave the restart loop respawning a service we've just
                    # declared failed. The log is left in place for the hint above.
                    _stop_supervisor(process)
                    return False

                docker_ctl_spinner.update(f"Waiting for Docker Control Service… (attempt {i}/{health_check_retries})")
                time.sleep(health_check_delay)

    except Exception as e:
        console.print(f"[error]⛔ Error starting Docker Control Service: {e}[/error]")
        _stop_supervisor(process)
        return False
    finally:
        # Clean up the temporary script (only if it was actually created)
        if temp_script_path:
            try:
                os.unlink(temp_script_path)
            except OSError:
                pass

    return True


def cleanup_docker_control_service(no_sudo=False):
    """Clean up Docker Control Service processes and files (quiet — only warns on errors)."""
    def is_process_alive(pid):
        try:
            os.kill(int(pid), 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            if not no_sudo:
                result = subprocess.run(["sudo", "kill", "-0", str(pid)],
                                      capture_output=True, check=False)
                return result.returncode == 0
            return True

    # Kill process if PID file exists
    if os.path.exists(DOCKER_CONTROL_PID_FILE):
        try:
            with open(DOCKER_CONTROL_PID_FILE, 'r') as f:
                pid = f.read().strip()
            if pid and pid.isdigit():
                pid_int = int(pid)
                if is_process_alive(pid_int):
                    try:
                        os.kill(pid_int, signal.SIGTERM)
                        time.sleep(2)
                        if is_process_alive(pid_int):
                            os.kill(pid_int, signal.SIGKILL)
                            time.sleep(1)
                    except PermissionError:
                        if not no_sudo:
                            subprocess.run(["sudo", "kill", "-15", pid], check=False)
                            time.sleep(2)
                            if is_process_alive(pid_int):
                                subprocess.run(["sudo", "kill", "-9", pid], check=False)
                                time.sleep(1)
                        else:
                            print(f"{C_YELLOW}⚠️  Could not kill Docker Control process {pid} (no sudo){C_RESET}")
                    except (ProcessLookupError, Exception):
                        pass
        except Exception:
            pass

    # Kill any process on port 8002
    kill_process_on_port(8002, no_sudo=no_sudo, quiet=True)

    # Remove the PID file; rotate the log rather than deleting it. Deleting it
    # here meant a restart destroyed the only record of why the previous
    # instance died, which is exactly what you need after an outage.
    try:
        if os.path.exists(DOCKER_CONTROL_PID_FILE):
            os.remove(DOCKER_CONTROL_PID_FILE)
    except Exception:
        pass

    archive_docker_control_log()

