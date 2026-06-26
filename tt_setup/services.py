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
from tt_setup.shell import run_command
from tt_setup.docker_diag import _resolve_container_name
from tt_setup.docker import check_docker_access
from tt_setup.env_config import get_env_var, get_preference, save_preference
from tt_setup.console import console, in_phase, is_verbose, notice_panel, progress_status, show_detail


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
    Check if multiple ports are available and free any that are in use.

    In-use ports are freed one at a time on a single transient progress line
    ("[i/N] Freeing port ...") that is cleared on completion, so the PID-hunting
    mechanics never clutter the output. A successful run collapses to one
    summary line instead of several lines per port.

    Args:
        ports: List of tuples (port_number, service_name)
        no_sudo: Whether to skip sudo usage

    Returns:
        tuple: (bool, list) - (True if all ports OK, list of failed ports with service names)
    """
    in_use = [(port, name) for port, name in ports if not check_port_available(port)]
    if not in_use:
        return (True, [])

    total = len(in_use)
    freed_ports = []
    failed_ports = []
    docker_ports = []  # held by Docker (a running TT Studio container) — left alone
    # In-place rewrites only make sense on a TTY; in a piped/redirected log the
    # carriage returns and escape codes would corrupt the output, so skip them.
    use_ansi = sys.stdout.isatty()

    for index, (port, service_name) in enumerate(in_use, start=1):
        if use_ansi:
            # Transient line — overwritten in place per step, then cleared, so the
            # noisy "found PID / terminated" details are taken away once done.
            sys.stdout.write(
                f"\r{C_YELLOW}🔓 Freeing in-use ports [{index}/{total}] — "
                f"port {port} ({service_name})...{C_RESET}\033[K"
            )
            sys.stdout.flush()

        result = kill_process_on_port(port, no_sudo=no_sudo, quiet=True)
        if result == "docker":
            docker_ports.append((port, service_name))
        elif result:
            freed_ports.append((port, service_name))
        else:
            failed_ports.append((port, service_name))

    if use_ansi:
        # Clear the transient progress line.
        sys.stdout.write("\r\033[K")
        sys.stdout.flush()

    # Ports held by Docker mean TT Studio containers are still up. Do NOT kill
    # them — that would crash Docker Desktop's engine. `docker compose up` will
    # recreate our own containers; if a *different* stack owns the port, compose
    # will surface a clear bind error. Just note it (and don't fail).
    if docker_ports:
        names = ", ".join(f"{port} ({name})" for port, name in docker_ports)
        console.print(f"[muted]↻ {len(docker_ports)} port(s) held by running TT Studio "
                      f"containers — left for compose to recreate ([/muted]"
                      f"[muted]python run.py --stop[/muted][muted] to free them): {names}[/muted]")

    if freed_ports:
        # The transient "🔓 Freeing…" line already showed the work; keep the
        # confirmation minimal. Fold it into the phase line on a normal run;
        # show the full port→service breakdown only with --verbose.
        n = len(freed_ports)
        word = "port" if n == 1 else "ports"
        if is_verbose():
            summary = ", ".join(f"{port} ({name})" for port, name in freed_ports)
            console.print(f"[success]✓ Freed {n} in-use {word}: {summary}[/success]")
        elif not in_phase():
            console.print(f"[success]✓ Freed {n} in-use {word}[/success]")

    # Failures always surface — never folded.
    for port, service_name in failed_ports:
        console.print(f"[error]❌ Could not free port {port} ({service_name})[/error]")

    return (len(failed_ports) == 0, failed_ports)


def probe_service(health_url, timeout=2):
    """One-shot health probe: True if `health_url` returns HTTP 200 within
    `timeout`s. Used for the ready-panel snapshot dot — not the long wait loop."""
    try:
        if HAS_REQUESTS:
            return requests.get(health_url, timeout=timeout).status_code == 200
        import urllib.request
        return urllib.request.urlopen(health_url, timeout=timeout).getcode() == 200
    except Exception:
        return False


def snapshot_health(health_urls, timeout=2):
    """Probe several health URLs concurrently; return {url: healthy_bool}. A quick
    parallel snapshot for the ready panel so a stalled service can't block it."""
    if not health_urls:
        return {}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=len(health_urls)) as pool:
        return dict(pool.map(lambda u: (u, probe_service(u, timeout)), health_urls))


def wait_for_service_health(service_name, health_url, timeout=300, interval=5):
    """
    Wait for a service to become healthy (HTTP 200 at the given URL).
    Returns True if healthy within timeout, else False.
    Classifies failure reasons (connection refused, timeout, HTTP error) for diagnostics.
    """
    start_time = time.time()
    last_failure = "waiting to connect"

    with progress_status(f"Waiting for {service_name}…") as health_spinner:
        while time.time() - start_time < timeout:
            elapsed = int(time.time() - start_time)
            failure_reason = None

            if HAS_REQUESTS:
                try:
                    response = requests.get(health_url, timeout=5)
                    if response.status_code == 200:
                        # Spinner clears on exiting the context manager; succeed silently.
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

            health_spinner.update(
                f"Waiting for {service_name}… ({elapsed}s/{timeout}s) — {last_failure}"
            )
            time.sleep(interval)

    console.print(f"[error]⛔ {service_name} did not become healthy within {timeout}s[/error]")
    console.print(f"   [muted]Last failure: {last_failure}[/muted]")

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
                console.print(f"[muted]   \\[{container} last 10 log lines][/muted]", highlight=False)
                for line in log_output.strip().splitlines()[-10:]:
                    # Raw container log lines may contain markup-like brackets.
                    console.print(f"   {line}", markup=False, highlight=False)
        except Exception:
            pass

    return False


def wait_for_all_services(skip_fastapi=False, is_deployed_mode=False, skip_docker_control=False):
    """
    Wait for all core services to become healthy.
    Returns True if all are healthy, False otherwise.
    """
    console.print("\n[info]⏳ Waiting for all services to become healthy...[/info]")

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
        console.print("\n[success]✅ All services are healthy and ready![/success]")
    else:
        console.print()
        failed_lines = [f"[error]• {svc}[/error]" for svc in failed_services]
        console.print(notice_panel(
            "[error]Service health checks failed[/error]",
            failed_lines,
            border_style="error",
        ))

        # Map to log sources
        service_log_map = {
            "ChromaDB": "docker logs -f tt_studio_chroma",
            "Backend API": "docker logs -f tt_studio_backend",
            "Frontend": "docker logs -f tt_studio_frontend",
            "FastAPI Server": f"tail -f {MODEL_RUN_LOG_FILE}",
            "Docker Control Service": f"tail -f {DOCKER_CONTROL_LOG_FILE}",
        }
        console.print("\n[info]📋 Check logs:[/info]")
        for svc in failed_services:
            log_cmd = service_log_map.get(svc, "unknown")
            console.print(f"  [muted]# {svc}:[/muted]")
            console.print(f"  [muted]{log_cmd}[/muted]", highlight=False)

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
        console.print(f"\n[info]🤖 Auto-deploying model: {auto_deploy_model} on chip {device_id}[/info]")
    else:
        frontend_url = base_url

    if wait_for_service_health("Frontend", base_url, timeout=timeout, interval=2):
        try:
            webbrowser.open(frontend_url)
            return True
        except Exception as e:
            console.print(f"[warning]⚠️  Could not open browser automatically: {e}[/warning]")
            console.print(f"[info]💡 Please manually open: {frontend_url}[/info]")
            return False
    else:
        console.print(f"[warning]⚠️  Frontend not ready within {timeout} seconds[/warning]")
        console.print("[info]💡 To fix this, run:[/info]")
        console.print("  [bold]python run.py --stop && python run.py[/bold]")
        console.print("[info]   Or check container logs: cd app && docker compose logs -f[/info]")
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


def _process_is_docker(pid):
    """True if `pid` belongs to Docker itself (Docker Desktop backend, docker-proxy,
    dockerd, containerd, vpnkit). On macOS/Docker Desktop a *published* container
    port is held by `com.docker.backend`, so killing the port's holder would take
    down the whole Docker engine — we must never do that."""
    try:
        r = subprocess.run(["ps", "-p", str(pid), "-o", "comm="],
                           capture_output=True, text=True, check=False)
    except Exception:
        return False
    name = (r.stdout or "").strip().lower()
    return any(tok in name for tok in ("docker", "vpnkit", "containerd"))


def kill_process_on_port(port, no_sudo=False, quiet=False):
    """
    Free a port by stopping the process holding it. Returns True if freed (or
    nothing was holding it), "docker" if the holder is Docker itself (left
    untouched — killing it would crash the engine), or False on failure.
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

    # NEVER kill Docker itself. On macOS/Docker Desktop the port is held by
    # com.docker.backend; killing it crashes the engine and the build then fails
    # with "Cannot connect to the Docker daemon". A TT Studio container holding
    # the port is recreated by `docker compose up` anyway.
    if _process_is_docker(pid):
        return "docker"

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
    console.print("[info]🔧 Setting up inference-api environment...[/info]")

    original_dir = os.getcwd()

    try:
        if not os.path.exists(INFERENCE_API_DIR):
            console.print(f"[error]⛔ Error: inference-api directory not found at {INFERENCE_API_DIR}[/error]")
            return False

        os.chdir(INFERENCE_API_DIR)

        if not os.path.exists("requirements.txt"):
            console.print("[error]⛔ Error: requirements.txt not found[/error]")
            return False

        # Create virtual environment if it doesn't exist or is stale (e.g. repo moved)
        if not os.path.exists(".venv") or recreate_venv_if_stale(".venv", C_YELLOW, C_RESET):
            try:
                run_command(["python3", "-m", "venv", ".venv"], check=True, capture_output=True)
            except (subprocess.CalledProcessError, SystemExit) as e:
                console.print(f"[error]⛔ Failed to create virtual environment: {e}[/error]")
                print_manual_fix_steps(INFERENCE_API_DIR, "requirements.txt", C_YELLOW, C_RESET)
                return False

        venv_pip = ".venv/bin/pip"
        if OS_NAME == "Windows":
            venv_pip = ".venv/Scripts/pip.exe"

        if not os.path.exists(venv_pip):
            console.print("[error]⛔ Virtual environment pip not found[/error]")
            return False

        # Upgrade pip + install requirements (silent)
        try:
            run_command([venv_pip, "install", "--upgrade", "pip"], check=True, capture_output=True)
        except (subprocess.CalledProcessError, SystemExit):
            pass  # Non-fatal

        try:
            run_command([venv_pip, "install", "-r", "requirements.txt"], check=True, capture_output=True)
        except (subprocess.CalledProcessError, SystemExit) as e:
            console.print(f"[error]⛔ Failed to install requirements: {e}[/error]")
            return False

        # Verify uvicorn
        venv_uvicorn = ".venv/bin/uvicorn"
        if OS_NAME == "Windows":
            venv_uvicorn = ".venv/Scripts/uvicorn.exe"

        if not os.path.exists(venv_uvicorn):
            try:
                run_command([".venv/bin/python", "-c", "import uvicorn"], check=True, capture_output=True)
            except (subprocess.CalledProcessError, SystemExit):
                console.print("[error]⛔ uvicorn is not available[/error]")
                return False

        return True
    finally:
        os.chdir(original_dir)


def start_fastapi_server(no_sudo=False, dev_mode=False):
    """Start the inference-api FastAPI server on port 8001."""
    console.print("[info]🔧 Starting FastAPI server...[/info]")

    # Check if port 8001 is available
    if not check_port_available(8001):
        if not kill_process_on_port(8001, no_sudo=no_sudo):
            console.print("[error]❌ Failed to free port 8001. Please manually stop any process using this port.[/error]")
            return False

    # Create PID and log files

    for file_path in [FASTAPI_PID_FILE, MODEL_RUN_LOG_FILE]:
        try:
            # Create files as regular user
            with open(file_path, 'w') as f:
                pass
            os.chmod(file_path, 0o644)
        except Exception as e:
            console.print(f"[warning]Warning: Could not create {file_path}: {e}[/warning]")
    
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
        console.print("[error]⛔ Error: uvicorn not found in virtual environment[/error]")
        console.print(f"   [muted]Expected path: {venv_uvicorn}[/muted]")
        console.print("   [muted]Please ensure requirements.txt was installed correctly[/muted]")
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
        cmd = [temp_script_path, INFERENCE_API_DIR, FASTAPI_PID_FILE, ".venv", MODEL_RUN_LOG_FILE]
        process = subprocess.Popen(cmd, env=env)
        
        # Health check (silent — only prints on success or failure)
        health_check_retries = 30
        health_check_delay = 2

        with progress_status("Waiting for FastAPI server…") as fastapi_spinner:
            for i in range(1, health_check_retries + 1):
                if process.poll() is not None:
                    console.print("[error]⛔ FastAPI server process died[/error]")
                    try:
                        with open(MODEL_RUN_LOG_FILE, 'r') as f:
                            lines = f.readlines()
                            for line in lines[-15:]:
                                console.print(f"   {line.rstrip()}", markup=False, highlight=False)
                    except:
                        pass
                    try:
                        with open(MODEL_RUN_LOG_FILE, 'r') as f:
                            if "address already in use" in f.read():
                                console.print("[warning]   Port 8001 still in use. Try: python run.py --stop && python run.py[/warning]")
                    except:
                        pass
                    return False

                try:
                    result = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:8001/health"],
                                           capture_output=True, text=True, timeout=5, check=False)
                    if result.stdout.strip() in ["200", "404"]:
                        if show_detail():
                            console.print("[success]✅ FastAPI server ready at http://localhost:8001[/success]")
                        return True
                except:
                    try:
                        import urllib.request
                        response = urllib.request.urlopen("http://localhost:8001/health", timeout=5)
                        if response.getcode() in [200, 404]:
                            if show_detail():
                                console.print("[success]✅ FastAPI server ready at http://localhost:8001[/success]")
                            return True
                    except:
                        pass

                if i == health_check_retries:
                    console.print("[error]⛔ FastAPI server failed to start[/error]")
                    console.print(f"   [muted]Check logs: tail -50 {MODEL_RUN_LOG_FILE}[/muted]")
                    return False

                fastapi_spinner.update(f"Waiting for FastAPI server… (attempt {i}/{health_check_retries})")
                time.sleep(health_check_delay)

    except Exception as e:
        console.print(f"[error]⛔ Error starting FastAPI server: {e}[/error]")
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
    for file_path in [FASTAPI_PID_FILE, MODEL_RUN_LOG_FILE]:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass


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


def ensure_frontend_dependencies(force_prompt=False, quick_setup=False):
    """
    Ensures frontend dependencies are available locally for IDE support.
    This is optional for running the app, as dependencies are always installed
    inside the Docker container, but it greatly improves the development experience
    (e.g., for TypeScript autocompletion).
    
    Args:
        force_prompt (bool): If True, always prompt user even if preference exists
        quick_setup (bool): If True, automatically skip npm installation without prompting (quick setup)
    """
    frontend_dir = os.path.join(TT_STUDIO_ROOT, "app", "frontend")
    node_modules_dir = os.path.join(frontend_dir, "node_modules")
    package_json_path = os.path.join(frontend_dir, "package.json")

    if not os.path.exists(package_json_path):
        console.print(f"[error]⛔ package.json not found in {frontend_dir}[/error]")
        return False

    # If node_modules already exists and is populated, we're good.
    if os.path.exists(node_modules_dir) and os.listdir(node_modules_dir):
        return True

    # Local node_modules is optional — the running app always installs its deps
    # inside the Docker container. We no longer prompt to install it locally;
    # just leave a quiet hint for anyone who wants IDE type-checking/autocomplete.
    if show_detail():
        console.print(
            "[muted]Frontend deps install in Docker; skipping the local copy. "
            "For IDE support run: cd app/frontend && npm install[/muted]"
        )
    return True

    return True
