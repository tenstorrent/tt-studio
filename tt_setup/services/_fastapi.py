# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""FastAPI inference-api lifecycle: venv setup, catalog overlay, start, cleanup."""

import os
import sys
import subprocess
import time
import tempfile
import signal
from tt_setup.constants import *
from tt_setup.venv_utils import print_manual_fix_steps, recreate_venv_if_stale
from tt_setup.shell import run_command
from tt_setup.env_config import get_env_var
from tt_setup.console import console, progress_status, show_detail
from tt_setup.services._ports import check_port_available, kill_process_on_port


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


def apply_media_catalog_env_overlay():
    """STOPGAP: overlay HF_HUB_DISABLE_XET=1 onto the extracted model-spec catalog.

    Runs after the artifact is extracted and before uvicorn loads it. Uses the
    inference-api venv interpreter because the top-level run.py has no PyYAML, while
    the inference-api venv does (it parses these same catalog YAMLs). Non-fatal: a
    failure here only forfeits the Xet workaround, it must not block server start.
    See app/backend/shared_config/patch_catalog_env.py for the full rationale.
    """
    if not os.path.exists(INFERENCE_ARTIFACT_DIR):
        return
    patch_script = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config", "patch_catalog_env.py",
    )
    if not os.path.exists(patch_script):
        console.print(f"[warning]⚠️  Catalog env overlay script not found: {patch_script}[/warning]")
        return
    venv_python = os.path.join(INFERENCE_API_DIR, ".venv", "bin", "python")
    if OS_NAME == "Windows":
        venv_python = os.path.join(INFERENCE_API_DIR, ".venv", "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        venv_python = sys.executable  # fall back to the launcher interpreter
    try:
        result = subprocess.run(
            [venv_python, patch_script, INFERENCE_ARTIFACT_DIR],
            capture_output=True, text=True, check=False,
        )
        for line in (result.stdout or "").strip().splitlines():
            console.print(f"   {line}")
        if result.returncode != 0 and (result.stderr or "").strip():
            console.print("[warning]⚠️  Catalog env overlay reported errors:[/warning]")
            for line in result.stderr.strip().splitlines():
                console.print(f"   {line}")
    except Exception as e:
        console.print(f"[warning]⚠️  Catalog env overlay failed (continuing): {e}[/warning]")


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
        artifact_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION")
        artifact_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH")
        if artifact_version:
            env["TT_INFERENCE_ARTIFACT_VERSION"] = artifact_version
        if artifact_branch:
            env["TT_INFERENCE_ARTIFACT_BRANCH"] = artifact_branch
        # Also set OVERRIDE_BENCHMARK_TARGETS to point to the file in the artifact directory
        benchmark_file = os.path.join(INFERENCE_ARTIFACT_DIR, "benchmarking", "benchmark_targets", "model_performance_reference.json")
        if os.path.exists(benchmark_file):
            env["OVERRIDE_BENCHMARK_TARGETS"] = benchmark_file

    # STOPGAP (excise when upstream catalog carries the var): overlay
    # HF_HUB_DISABLE_XET=1 onto every model-spec template in the freshly-extracted
    # artifact. Media containers get their per-model env solely from the catalog
    # env_vars block (run_docker_server.py forwards model_spec.env_vars as -e flags),
    # so nothing set on the compose services reaches them.
    # Without it, large media weight downloads stall on the Xet CDN and hang past the
    # model-load timeout. Real fix: add it to tt-inference-server's catalogs and bump
    # the pin, then delete this block and patch_catalog_env.py.
    apply_media_catalog_env_overlay()

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

