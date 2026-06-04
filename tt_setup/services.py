# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Service lifecycle: ports, health checks, FastAPI, docker-control, frontend deps."""

import os
import sys
import subprocess
import time
import shutil
import re
import webbrowser
import socket
import tempfile
import signal
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False
from tt_setup.venv_utils import recreate_venv_if_stale, print_manual_fix_steps
from tt_setup.constants import *
from tt_setup.shell import clear_lines, run_command
from tt_setup.docker_diag import _resolve_container_name
from tt_setup.docker import check_docker_access
from tt_setup.env_config import get_env_var, get_preference, save_preference


def check_port_available(port):
    """Check if a port is available (like startup.sh)."""
    try:
        # Use the same approach as startup.sh
        result1 = subprocess.run(["lsof", "-Pi", f":{port}", "-sTCP:LISTEN", "-t"], 
                                capture_output=True, text=True, check=False)
        result2 = subprocess.run(["nc", "-z", "localhost", str(port)], 
                                capture_output=True, text=True, check=False)
        
        # Port is available if both commands fail (no output)
        return not (result1.stdout.strip() or result2.returncode == 0)
    except Exception:
        # Fallback to socket approach
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                return True
        except OSError:
            return False


def check_and_free_ports(ports, no_sudo=False):
    """
    Check if multiple ports are available and attempt to free them if not.
    
    Args:
        ports: List of tuples (port_number, service_name)
        no_sudo: Whether to skip sudo usage
        
    Returns:
        tuple: (bool, list) - (True if all ports OK, list of failed ports with service names)
    """
    failed_ports = []
    
    for port, service_name in ports:
        if not check_port_available(port):
            print(f"{C_YELLOW}⚠️  Port {port} ({service_name}) in use — freeing...{C_RESET}")
            if not kill_process_on_port(port, no_sudo=no_sudo):
                print(f"{C_RED}❌ Failed to free port {port} for {service_name}{C_RESET}")
                failed_ports.append((port, service_name))
            else:
                print(f"{C_GREEN}✅ Port {port} freed{C_RESET}")
    
    return (len(failed_ports) == 0, failed_ports)


def wait_for_service_health(service_name, health_url, timeout=300, interval=5):
    """
    Wait for a service to become healthy (HTTP 200 at the given URL).
    Returns True if healthy within timeout, else False.
    Classifies failure reasons (connection refused, timeout, HTTP error) for diagnostics.
    """
    start_time = time.time()
    last_failure = "waiting to connect"

    while time.time() - start_time < timeout:
        elapsed = int(time.time() - start_time)
        failure_reason = None

        if HAS_REQUESTS:
            try:
                response = requests.get(health_url, timeout=5)
                if response.status_code == 200:
                    # Clear the waiting line and return success silently
                    sys.stdout.write(f"\r{' ' * 80}\r")
                    sys.stdout.flush()
                    return True
                failure_reason = f"HTTP {response.status_code}"
            except requests.exceptions.ConnectionError:
                failure_reason = "connection refused"
            except requests.exceptions.Timeout:
                failure_reason = "request timeout"
            except requests.RequestException as exc:
                failure_reason = f"network error: {type(exc).__name__}"
        else:
            try:
                import urllib.error
                resp = urllib.request.urlopen(health_url, timeout=5)
                if resp.getcode() == 200:
                    sys.stdout.write(f"\r{' ' * 80}\r")
                    sys.stdout.flush()
                    return True
                failure_reason = f"HTTP {resp.getcode()}"
            except urllib.error.URLError as exc:
                reason = str(exc.reason) if hasattr(exc, 'reason') else str(exc)
                if "refused" in reason.lower():
                    failure_reason = "connection refused"
                elif "timed out" in reason.lower():
                    failure_reason = "request timeout"
                else:
                    failure_reason = f"URL error: {reason}"
            except Exception as exc:
                failure_reason = f"error: {type(exc).__name__}"

        if failure_reason:
            last_failure = failure_reason

        sys.stdout.write(f"\r⏳ {service_name} not ready ({elapsed}s/{timeout}s) — {last_failure}      ")
        sys.stdout.flush()
        time.sleep(interval)

    sys.stdout.write(f"\r{' ' * 80}\r")
    sys.stdout.flush()
    print(f"{C_RED}⛔ {service_name} did not become healthy within {timeout}s{C_RESET}")
    print(f"   Last failure: {last_failure}")

    # Auto-fetch container logs if this maps to a container
    prefix = SERVICE_CONTAINER_PREFIX_MAP.get(health_url)
    container = _resolve_container_name(prefix) if prefix else None
    if container:
        try:
            result = subprocess.run(
                ["docker", "logs", "--tail", "10", container],
                capture_output=True, text=True, check=False, timeout=10,
            )
            log_output = (result.stdout or "") + (result.stderr or "")
            if log_output.strip():
                print(f"{C_CYAN}   [{container} last 10 log lines]{C_RESET}")
                for line in log_output.strip().splitlines()[-10:]:
                    print(f"   {line}")
        except Exception:
            pass

    return False


def wait_for_all_services(skip_fastapi=False, is_deployed_mode=False, skip_docker_control=False):
    """
    Wait for all core services to become healthy.
    Returns True if all are healthy, False otherwise.
    """
    print(f"\n{C_BLUE}⏳ Waiting for all services to become healthy...{C_RESET}")

    services_to_check = [
        ("ChromaDB", "http://localhost:8111/api/v1/heartbeat"),
        ("Backend API", "http://localhost:8000/up/"),
        ("Frontend", "http://localhost:3000/"),
    ]
    if not skip_docker_control and os.path.exists(DOCKER_CONTROL_PID_FILE):
        services_to_check.append(("Docker Control Service", "http://localhost:8002/api/v1/health"))
    if not skip_fastapi and not is_deployed_mode:
        services_to_check.append(("FastAPI Server", "http://localhost:8001/"))

    all_healthy = True
    failed_services = []

    for service_name, health_url in services_to_check:
        if not wait_for_service_health(service_name, health_url, timeout=120, interval=3):
            all_healthy = False
            failed_services.append(service_name)

    if all_healthy:
        print(f"\n{C_GREEN}✅ All services are healthy and ready!{C_RESET}")
    else:
        print(f"\n{C_RED}⛔ The following services failed health checks:{C_RESET}")
        for svc in failed_services:
            print(f"  • {C_RED}{svc}{C_RESET}")

        # Map to log sources
        service_log_map = {
            "ChromaDB": "docker logs -f tt_studio_chroma",
            "Backend API": "docker logs -f tt_studio_backend",
            "Frontend": "docker logs -f tt_studio_frontend",
            "FastAPI Server": f"tail -f {FASTAPI_LOG_FILE}",
            "Docker Control Service": f"tail -f {DOCKER_CONTROL_LOG_FILE}",
        }
        print(f"\n{C_CYAN}📋 Check logs:{C_RESET}")
        for svc in failed_services:
            log_cmd = service_log_map.get(svc, "unknown")
            print(f"  # {svc}:")
            print(f"  {log_cmd}")

    return all_healthy


def wait_for_frontend_and_open_browser(host="localhost", port=3000, timeout=60, auto_deploy_model=None, device_id=0):
    """
    Wait for frontend service to be healthy before opening browser.

    Args:
        host: Frontend host
        port: Frontend port
        timeout: Timeout in seconds
        auto_deploy_model: Model name to auto-deploy (optional)
        device_id: Chip slot index for auto-deploy (default 0)

    Returns:
        bool: True if browser opened successfully, False otherwise
    """
    base_url = f"http://{host}:{port}/"

    # Add auto-deploy parameter if specified
    if auto_deploy_model:
        from urllib.parse import urlencode
        params = urlencode({"auto-deploy": auto_deploy_model, "device-id": device_id})
        frontend_url = f"{base_url}?{params}"
        print(f"\n🤖 Auto-deploying model: {auto_deploy_model} on chip {device_id}")
    else:
        frontend_url = base_url
    
    if wait_for_service_health("Frontend", base_url, timeout=timeout, interval=2):
        try:
            webbrowser.open(frontend_url)
            return True
        except Exception as e:
            print(f"⚠️  Could not open browser automatically: {e}")
            print(f"💡 Please manually open: {frontend_url}")
            return False
    else:
        print(f"{C_YELLOW}⚠️  Frontend not ready within {timeout} seconds{C_RESET}")
        print(f"{C_CYAN}💡 To fix this, run:{C_RESET}")
        print(f"  {C_WHITE}python run.py --cleanup && python run.py{C_RESET}")
        print(f"{C_CYAN}   Or check container logs: cd app && docker compose logs -f{C_RESET}")
        return False


def get_frontend_config():
    """
    Getting frontend configuration from environment or defaults.
    """
    # Read from environment variables or use defaults
    host = os.getenv('FRONTEND_HOST', 'localhost')
    port = int(os.getenv('FRONTEND_PORT', '3000'))
    timeout = int(os.getenv('FRONTEND_TIMEOUT', '60'))
    
    return host, port, timeout


def kill_process_on_port(port, no_sudo=False, quiet=False):
    """
    Find and kill a process using a specific port. More robust and cross-platform.
    Handles permissions by trying commands with and without sudo.
    """
    pid = None

    # --- macOS and Linux logic ---

    # Define commands to try
    lsof_cmd = ["lsof", "-ti", f"tcp:{port}"]
    ss_cmd = ["ss", "-lptn", f"sport = :{port}"]

    # Function to run a command and extract PID
    def find_pid_with_command(base_cmd, use_sudo):
        cmd_to_run = base_cmd.copy()
        if use_sudo:
            cmd_to_run.insert(0, "sudo")

        result = run_command(cmd_to_run, check=False, capture_output=True)

        if result.returncode == 0 and result.stdout.strip():
            if "ss" in base_cmd[0]:
                match = re.search(r'pid=(\d+)', result.stdout.strip())
                return match.group(1) if match else None
            else:
                return result.stdout.strip().split('\n')[0]
        return None

    # Try lsof, then lsof with sudo
    if shutil.which("lsof"):
        pid = find_pid_with_command(lsof_cmd, use_sudo=False)
        if not pid and not no_sudo:
            pid = find_pid_with_command(lsof_cmd, use_sudo=True)

    # If lsof failed, try ss, then ss with sudo
    if not pid and shutil.which("ss"):
        pid = find_pid_with_command(ss_cmd, use_sudo=False)
        if not pid and not no_sudo:
            pid = find_pid_with_command(ss_cmd, use_sudo=True)

    if not pid:
        if not quiet:
            print(f"{C_YELLOW}⚠️  Could not find a specific process using port {port}. This is likely okay.{C_RESET}")
        return True

    if not quiet:
        print(f"🛑 Found process with PID {pid} using port {port}. Attempting to stop it...")

    # Build kill commands
    kill_cmd_graceful = ["kill", "-15", pid]
    kill_cmd_force = ["kill", "-9", pid]
    check_alive_cmd = ["kill", "-0", pid]
    use_sudo_for_kill = not no_sudo and os.geteuid() != 0

    if use_sudo_for_kill:
        kill_cmd_graceful.insert(0, "sudo")
        kill_cmd_force.insert(0, "sudo")
        check_alive_cmd.insert(0, "sudo")

    try:
        run_command(kill_cmd_graceful, check=False, capture_output=True)
        time.sleep(2)

        result = run_command(check_alive_cmd, check=False, capture_output=True)
        if result.returncode == 0:
            if not quiet:
                print(f"⚠️  Process {pid} still alive. Forcing termination...")
            run_command(kill_cmd_force, check=True, capture_output=True)
            if not quiet:
                print(f"{C_GREEN}✅ Process {pid} terminated by force.{C_RESET}")
        else:
            if not quiet:
                print(f"{C_GREEN}✅ Process {pid} terminated gracefully.{C_RESET}")

    except Exception as e:
        if not quiet:
            print(f"{C_RED}⛔ Failed to kill process {pid}: {e}{C_RESET}")
            print(f"{C_YELLOW}   You may need to stop it manually. Try: {' '.join(kill_cmd_force)}{C_RESET}")
        return False

    return True


def is_valid_git_repo(path):
    """Check if directory is a valid git repository.
    
    Args:
        path: Path to check
        
    Returns:
        None if directory doesn't exist
        True if directory is a valid git repository
        False if directory exists but is not a valid git repository
    """
    if not os.path.exists(path):
        return None  # Doesn't exist
    
    git_dir = os.path.join(path, ".git")
    if os.path.isfile(git_dir) or os.path.isdir(git_dir):
        # Verify it's actually valid by checking for HEAD
        try:
            result = subprocess.run(
                ["git", "-C", path, "rev-parse", "--git-dir"],
                capture_output=True, text=True, check=False
            )
            return result.returncode == 0
        except Exception:
            return False
    return False  # Exists but not a git repo


def setup_fastapi_environment():
    """Set up the inference-api FastAPI environment."""
    print(f"🔧 Setting up inference-api environment...")
    
    original_dir = os.getcwd()

    try:
        if not os.path.exists(INFERENCE_API_DIR):
            print(f"{C_RED}⛔ Error: inference-api directory not found at {INFERENCE_API_DIR}{C_RESET}")
            return False

        os.chdir(INFERENCE_API_DIR)

        if not os.path.exists("requirements.txt"):
            print(f"{C_RED}⛔ Error: requirements.txt not found{C_RESET}")
            return False

        # Create virtual environment if it doesn't exist or is stale (e.g. repo moved)
        if not os.path.exists(".venv") or recreate_venv_if_stale(".venv", C_YELLOW, C_RESET):
            try:
                run_command(["python3", "-m", "venv", ".venv"], check=True, capture_output=True)
            except (subprocess.CalledProcessError, SystemExit) as e:
                print(f"{C_RED}⛔ Failed to create virtual environment: {e}{C_RESET}")
                print_manual_fix_steps(INFERENCE_API_DIR, "requirements.txt", C_YELLOW, C_RESET)
                return False

        venv_pip = ".venv/bin/pip"
        if OS_NAME == "Windows":
            venv_pip = ".venv/Scripts/pip.exe"

        if not os.path.exists(venv_pip):
            print(f"{C_RED}⛔ Virtual environment pip not found{C_RESET}")
            return False

        # Upgrade pip + install requirements (silent)
        try:
            run_command([venv_pip, "install", "--upgrade", "pip"], check=True, capture_output=True)
        except (subprocess.CalledProcessError, SystemExit):
            pass  # Non-fatal

        try:
            run_command([venv_pip, "install", "-r", "requirements.txt"], check=True, capture_output=True)
        except (subprocess.CalledProcessError, SystemExit) as e:
            print(f"{C_RED}⛔ Failed to install requirements: {e}{C_RESET}")
            return False

        # Verify uvicorn
        venv_uvicorn = ".venv/bin/uvicorn"
        if OS_NAME == "Windows":
            venv_uvicorn = ".venv/Scripts/uvicorn.exe"

        if not os.path.exists(venv_uvicorn):
            try:
                run_command([".venv/bin/python", "-c", "import uvicorn"], check=True, capture_output=True)
            except (subprocess.CalledProcessError, SystemExit):
                print(f"{C_RED}⛔ uvicorn is not available{C_RESET}")
                return False

        return True
    finally:
        os.chdir(original_dir)


def start_fastapi_server(no_sudo=False, dev_mode=False):
    """Start the inference-api FastAPI server on port 8001."""
    print(f"🔧 Starting FastAPI server...")

    # Check if port 8001 is available
    if not check_port_available(8001):
        if not kill_process_on_port(8001, no_sudo=no_sudo):
            print(f"{C_RED}❌ Failed to free port 8001. Please manually stop any process using this port.{C_RESET}")
            return False

    # Create PID and log files
    
    for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
        try:
            # Create files as regular user
            with open(file_path, 'w') as f:
                pass
            os.chmod(file_path, 0o644)
        except Exception as e:
            print(f"{C_YELLOW}Warning: Could not create {file_path}: {e}{C_RESET}")
    
    # Get environment variables for the server
    jwt_secret = get_env_var("JWT_SECRET")
    hf_token = get_env_var("HF_TOKEN")
    tts_api_key = get_env_var("TTS_API_KEY")
    
    # Export the environment variables
    env = os.environ.copy()
    if jwt_secret:
        env["JWT_SECRET"] = jwt_secret
    if hf_token:
        env["HF_TOKEN"] = hf_token
    if tts_api_key:
        env["TTS_API_KEY"] = tts_api_key
    
    # Set artifact path and version/branch so inference-api uses the version-resolved artifact
    if os.path.exists(INFERENCE_ARTIFACT_DIR):
        env["TT_INFERENCE_ARTIFACT_PATH"] = INFERENCE_ARTIFACT_DIR
        artifact_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION") or os.getenv("TT_INFERENCE_ARTIFACT_VERSION")
        artifact_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH") or os.getenv("TT_INFERENCE_ARTIFACT_BRANCH")
        if artifact_version:
            env["TT_INFERENCE_ARTIFACT_VERSION"] = artifact_version
        if artifact_branch:
            env["TT_INFERENCE_ARTIFACT_BRANCH"] = artifact_branch
        # Also set OVERRIDE_BENCHMARK_TARGETS to point to the file in the artifact directory
        benchmark_file = os.path.join(INFERENCE_ARTIFACT_DIR, "benchmarking", "benchmark_targets", "model_performance_reference.json")
        if os.path.exists(benchmark_file):
            env["OVERRIDE_BENCHMARK_TARGETS"] = benchmark_file
    
    # Start the server - use inference-api/main.py
    venv_uvicorn = os.path.join(INFERENCE_API_DIR, ".venv", "bin", "uvicorn")
    if OS_NAME == "Windows":
        venv_uvicorn = os.path.join(INFERENCE_API_DIR, ".venv", "Scripts", "uvicorn.exe")
    
    if not os.path.exists(venv_uvicorn):
        print(f"{C_RED}⛔ Error: uvicorn not found in virtual environment{C_RESET}")
        print(f"   Expected path: {venv_uvicorn}")
        print(f"   Please ensure requirements.txt was installed correctly")
        return False
    
    try:
        # Create a temporary wrapper script
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
            # Export TT_INFERENCE_ARTIFACT_PATH if it's in the environment
            artifact_path_export = ""
            benchmark_targets_export = ""
            if os.path.exists(INFERENCE_ARTIFACT_DIR):
                artifact_path_export = f'export TT_INFERENCE_ARTIFACT_PATH="{INFERENCE_ARTIFACT_DIR}"\n'
                benchmark_file = os.path.join(INFERENCE_ARTIFACT_DIR, "benchmarking", "benchmark_targets", "model_performance_reference.json")
                if os.path.exists(benchmark_file):
                    benchmark_targets_export = f'export OVERRIDE_BENCHMARK_TARGETS="{benchmark_file}"\n'
            
            # Set PYTHONPATH to include artifact directory so imports work correctly (currently it searches in the root)
            pythonpath_export = ""
            if os.path.exists(INFERENCE_ARTIFACT_DIR):
                pythonpath_export = f'export PYTHONPATH="{INFERENCE_ARTIFACT_DIR}:$PYTHONPATH"\n'
            
            if dev_mode:
                uvicorn_block = f'''\
echo $$ > "$2"
RESTART_COUNT=0
while true; do
    "$3/bin/uvicorn" main:app --host 0.0.0.0 --port 8001 >> "$4" 2>&1
    EXIT_CODE=$?
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "[$(date)] FastAPI exited with code $EXIT_CODE (restart #$RESTART_COUNT) — restarting in 3s..." >> "$4"
    sleep 3
done
'''
            else:
                uvicorn_block = '''\
echo $$ > "$2"
if ! "$3/bin/uvicorn" main:app --host 0.0.0.0 --port 8001 >> "$4" 2>&1; then
    echo "Failed to start inference-api server. Check logs at $4"
    exit 1
fi
'''

            tt_studio_root_export = f'export TT_STUDIO_ROOT="{TT_STUDIO_ROOT}"\n'

            temp_script.write(f'''#!/bin/bash
set -e
cd "$1"
{tt_studio_root_export}{artifact_path_export}{benchmark_targets_export}{pythonpath_export}{uvicorn_block}''')
            temp_script_path = temp_script.name
        
        # Make the script executable
        os.chmod(temp_script_path, 0o755)
        
        # Start server
        cmd = [temp_script_path, INFERENCE_API_DIR, FASTAPI_PID_FILE, ".venv", FASTAPI_LOG_FILE]
        process = subprocess.Popen(cmd, env=env)
        
        # Health check (silent — only prints on success or failure)
        health_check_retries = 30
        health_check_delay = 2

        for i in range(1, health_check_retries + 1):
            if process.poll() is not None:
                print(f"{C_RED}⛔ FastAPI server process died{C_RESET}")
                try:
                    with open(FASTAPI_LOG_FILE, 'r') as f:
                        lines = f.readlines()
                        for line in lines[-15:]:
                            print(f"   {line.rstrip()}")
                except:
                    pass
                try:
                    with open(FASTAPI_LOG_FILE, 'r') as f:
                        if "address already in use" in f.read():
                            print(f"{C_YELLOW}   Port 8001 still in use. Try: python run.py --cleanup && python run.py{C_RESET}")
                except:
                    pass
                return False

            try:
                result = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:8001/health"],
                                       capture_output=True, text=True, timeout=5, check=False)
                if result.stdout.strip() in ["200", "404"]:
                    clear_lines(1)  # clear "Starting FastAPI server..."
                    print(f"{C_GREEN}✅ FastAPI server ready at http://localhost:8001{C_RESET}")
                    return True
            except:
                try:
                    import urllib.request
                    response = urllib.request.urlopen("http://localhost:8001/health", timeout=5)
                    if response.getcode() in [200, 404]:
                        clear_lines(1)  # clear "Starting FastAPI server..."
                        print(f"{C_GREEN}✅ FastAPI server ready at http://localhost:8001{C_RESET}")
                        return True
                except:
                    pass

            if i == health_check_retries:
                print(f"{C_RED}⛔ FastAPI server failed to start{C_RESET}")
                print(f"   Check logs: tail -50 {FASTAPI_LOG_FILE}")
                return False

            time.sleep(health_check_delay)
        
    except Exception as e:
        print(f"{C_RED}⛔ Error starting FastAPI server: {e}{C_RESET}")
        return False
    finally:
        # Clean up the temporary script
        try:
            os.unlink(temp_script_path)
        except:
            pass
    
    return True


def cleanup_fastapi_server(no_sudo=False):
    """Clean up FastAPI server processes and files (quiet — only warns on errors)."""
    # Helper function to check if process is still alive
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
    if os.path.exists(FASTAPI_PID_FILE):
        try:
            with open(FASTAPI_PID_FILE, 'r') as f:
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
                            print(f"{C_YELLOW}⚠️  Could not kill FastAPI process {pid} (no sudo){C_RESET}")
                    except (ProcessLookupError, Exception):
                        pass
        except Exception:
            pass

    # Kill any process on port 8001
    kill_process_on_port(8001, no_sudo=no_sudo, quiet=True)

    # Remove PID and log files
    for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass


def start_docker_control_service(no_sudo=False, dev_mode=False):
    """Start the Docker Control Service on port 8002."""
    mode_label = " (dev/reload)" if dev_mode else ""
    print(f"🔧 Starting Docker Control Service{mode_label}...")

    # Check if user has Docker access
    if not check_docker_access():
        print(f"{C_YELLOW}⚠️  Docker Control Service requires direct Docker socket access{C_RESET}")
        print(f"{C_YELLOW}   (660 permissions detected - service would need sudo which is not supported){C_RESET}")
        print(f"{C_CYAN}   Skipping Docker Control Service - Backend will use direct Docker SDK instead{C_RESET}")
        return False

    # Check if port 8002 is available
    if not check_port_available(8002):
        if not kill_process_on_port(8002, no_sudo=no_sudo):
            print(f"{C_RED}❌ Failed to free port 8002. Please manually stop any process using this port.{C_RESET}")
            return False

    # Check if service is already running
    if HAS_REQUESTS:
        try:
            response = requests.get("http://127.0.0.1:8002/api/v1/health", timeout=2)
            if response.status_code == 200:
                print(f"{C_GREEN}✅ Docker Control Service already running{C_RESET}")
                return True
        except requests.exceptions.RequestException:
            pass

    # Check if service directory exists
    if not os.path.exists(DOCKER_CONTROL_SERVICE_DIR):
        print(f"{C_RED}⛔ Error: Docker Control Service directory not found at {DOCKER_CONTROL_SERVICE_DIR}{C_RESET}")
        return False

    # Create PID and log files
    for file_path in [DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE]:
        try:
            with open(file_path, 'w') as f:
                pass
            os.chmod(file_path, 0o644)
        except Exception as e:
            print(f"{C_YELLOW}Warning: Could not create {file_path}: {e}{C_RESET}")

    # Check for virtual environment
    venv_dir = os.path.join(DOCKER_CONTROL_SERVICE_DIR, ".venv")
    venv_python = os.path.join(venv_dir, "bin", "python")

    if OS_NAME == "Windows":
        venv_python = os.path.join(venv_dir, "Scripts", "python.exe")

    # Create virtual environment and install dependencies if needed
    if not os.path.exists(venv_dir) or recreate_venv_if_stale(venv_dir, C_YELLOW, C_RESET):
        try:
            subprocess.run(
                ["python3", "-m", "venv", ".venv"],
                cwd=DOCKER_CONTROL_SERVICE_DIR,
                check=True
            )
        except Exception as e:
            print(f"{C_RED}⛔ Error creating virtual environment: {e}{C_RESET}")
            print_manual_fix_steps(DOCKER_CONTROL_SERVICE_DIR, "requirements-api.txt", C_YELLOW, C_RESET)
            return False

    # Check if requirements are installed
    requirements_file = os.path.join(DOCKER_CONTROL_SERVICE_DIR, "requirements-api.txt")
    if not os.path.exists(requirements_file):
        print(f"{C_RED}⛔ Error: requirements-api.txt not found at {requirements_file}{C_RESET}")
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
        print(f"{C_RED}⛔ Error installing dependencies: {e}{C_RESET}")
        return False

    # Get environment variables for the service
    jwt_secret = get_env_var("DOCKER_CONTROL_JWT_SECRET")

    # Export environment variables
    env = os.environ.copy()
    if jwt_secret:
        env["DOCKER_CONTROL_JWT_SECRET"] = jwt_secret
    env["DOCKER_CONTROL_LOG_FILE"] = DOCKER_CONTROL_LOG_FILE
    env["STARTUP_LOG_FILE"] = STARTUP_LOG_FILE
    env["FASTAPI_LOG_FILE"] = FASTAPI_LOG_FILE

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

        for i in range(1, health_check_retries + 1):
            # Check if process is still running
            if process.poll() is not None:
                print(f"{C_RED}⛔ Docker Control Service process died{C_RESET}")
                try:
                    with open(DOCKER_CONTROL_LOG_FILE, 'r') as f:
                        lines = f.readlines()
                        for line in lines[-15:]:
                            print(f"   {line.rstrip()}")
                except:
                    pass
                return False

            # Check if service is responding
            if HAS_REQUESTS:
                try:
                    response = requests.get("http://127.0.0.1:8002/api/v1/health", timeout=5)
                    if response.status_code == 200:
                        clear_lines(1)  # clear "Starting Docker Control Service..."
                        print(f"{C_GREEN}✅ Docker Control Service ready at http://localhost:8002{C_RESET}")
                        return True
                except:
                    pass
            else:
                try:
                    import urllib.request
                    response = urllib.request.urlopen("http://localhost:8002/api/v1/health", timeout=5)
                    if response.getcode() == 200:
                        clear_lines(1)  # clear "Starting Docker Control Service..."
                        print(f"{C_GREEN}✅ Docker Control Service ready at http://localhost:8002{C_RESET}")
                        return True
                except:
                    pass

            if i == health_check_retries:
                print(f"{C_RED}⛔ Docker Control Service failed to start{C_RESET}")
                print(f"   Check logs: tail -50 {DOCKER_CONTROL_LOG_FILE}")
                return False

            time.sleep(health_check_delay)

    except Exception as e:
        print(f"{C_RED}⛔ Error starting Docker Control Service: {e}{C_RESET}")
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


def ensure_frontend_dependencies(force_prompt=False, easy_mode=False):
    """
    Ensures frontend dependencies are available locally for IDE support.
    This is optional for running the app, as dependencies are always installed
    inside the Docker container, but it greatly improves the development experience
    (e.g., for TypeScript autocompletion).
    
    Args:
        force_prompt (bool): If True, always prompt user even if preference exists
        easy_mode (bool): If True, automatically skip npm installation without prompting
    """
    frontend_dir = os.path.join(TT_STUDIO_ROOT, "app", "frontend")
    node_modules_dir = os.path.join(frontend_dir, "node_modules")
    package_json_path = os.path.join(frontend_dir, "package.json")

    if not os.path.exists(package_json_path):
        print(f"{C_RED}⛔ package.json not found in {frontend_dir}{C_RESET}")
        return False

    # If node_modules already exists and is populated, we're good.
    if os.path.exists(node_modules_dir) and os.listdir(node_modules_dir):
        return True

    # Check for local npm installation
    has_local_npm = shutil.which("npm")

    try:
        if has_local_npm:
            # In easy mode, automatically skip npm installation
            if easy_mode:
                save_preference("npm_install_locally", 'n')
                return True
            
            # Check for saved preference
            npm_pref = get_preference("npm_install_locally")
            choice = None
            
            if not force_prompt and npm_pref:
                if npm_pref in ['n', 'no', 'false']:
                    print(f"{C_YELLOW}Skipping local dependency installation (using saved preference). IDE features may be limited.{C_RESET}")
                    return True
                # else preference is to install
                choice = npm_pref
            else:
                choice = input(f"Do you want to run 'npm install' locally? (Y/n): ").lower().strip() or 'y'
                save_preference("npm_install_locally", choice)
            
            # Check the actual choice (either from preference or from user input)
            if choice not in ['n', 'no', 'false']:
                print(f"\n{C_BLUE}📦 Installing dependencies locally with npm...{C_RESET}")
                run_command(["npm", "install"], check=True, cwd=frontend_dir)
                print(f"{C_GREEN}✅ Frontend dependencies installed successfully.{C_RESET}")
            else:
                print(f"{C_YELLOW}Skipping local dependency installation. IDE features may be limited.{C_RESET}")

        else: # No local npm found
            print(f"\n{C_YELLOW}⚠️ 'npm' command not found on your local machine.{C_RESET}")
            
            # Check for saved preference
            docker_pref = get_preference("npm_install_via_docker")
            choice = None
            
            if not force_prompt and docker_pref:
                if docker_pref in ['n', 'no', 'false']:
                    print(f"{C_YELLOW}Skipping local dependency installation (using saved preference). IDE features may be limited.{C_RESET}")
                    return True
                choice = docker_pref
            else:
                choice = input(f"Do you want to install dependencies using Docker? (Y/n): ").lower().strip() or 'y'
                save_preference("npm_install_via_docker", choice)
            
            # Check the actual choice (either from preference or from user input)
            if choice not in ['n', 'no', 'false']:
                print(f"\n{C_BLUE}📦 Installing dependencies using a temporary Docker container...{C_RESET}")
                # This command runs `npm install` inside a container and mounts the result back to the host.
                docker_cmd = [
                    "docker", "run", "--rm",
                    "-v", f"{frontend_dir}:/app",
                    "-w", "/app",
                    "node:22-alpine3.20",
                    "npm", "install"
                ]
                run_command(docker_cmd, check=True)
                print(f"{C_GREEN}✅ Frontend dependencies installed successfully using Docker.{C_RESET}")
            else:
                print(f"{C_YELLOW}Skipping local dependency installation. IDE features may be limited.{C_RESET}")

    except (subprocess.CalledProcessError, SystemExit) as e:
        print(f"{C_RED}⛔ Error installing frontend dependencies: {e}{C_RESET}")
        print(f"{C_YELLOW}   Could not install dependencies locally. IDE features may be limited, but the app will still run.{C_RESET}")
        return True # Still return True, as this is not a fatal error for the application itself.
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}🛑 Installation cancelled by user.{C_RESET}")
        return True

    return True
