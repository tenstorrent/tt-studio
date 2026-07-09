# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker Control service lifecycle: start + cleanup."""

import os
import subprocess
import time
import tempfile
import signal
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


def start_docker_control_service(no_sudo=False, dev_mode=False):
    """Start the Docker Control Service on port 8002."""
    mode_label = " (dev/reload)" if dev_mode else ""
    console.print(f"[info]🔧 Starting Docker Control Service{mode_label}...[/info]")

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
    try:
        # Create a temporary wrapper script similar to FastAPI
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
            reload_flag = "--reload" if dev_mode else ""
            temp_script.write(f'''#!/bin/bash
set -e
cd "$1"
# Save PID to file
echo $$ > "$2"
# Start the service
if ! "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8002 {reload_flag} > "$4" 2>&1; then
    echo "Failed to start Docker Control Service. Check logs at $4"
    exit 1
fi
''')
            temp_script_path = temp_script.name

        # Make the script executable
        os.chmod(temp_script_path, 0o755)

        # Start the service
        cmd = [temp_script_path, DOCKER_CONTROL_SERVICE_DIR, DOCKER_CONTROL_PID_FILE, ".venv", DOCKER_CONTROL_LOG_FILE]
        process = subprocess.Popen(cmd, env=env)

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
                    return False

                docker_ctl_spinner.update(f"Waiting for Docker Control Service… (attempt {i}/{health_check_retries})")
                time.sleep(health_check_delay)

    except Exception as e:
        console.print(f"[error]⛔ Error starting Docker Control Service: {e}[/error]")
        return False
    finally:
        # Clean up the temporary script
        try:
            os.unlink(temp_script_path)
        except:
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

    # Remove PID and log files
    for file_path in [DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE]:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass

