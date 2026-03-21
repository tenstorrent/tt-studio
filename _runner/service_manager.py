# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import sys
import subprocess
import signal
import tempfile
import time
import shutil

from _runner.constants import (
    C_RESET, C_RED, C_GREEN, C_YELLOW, C_BLUE, C_CYAN,
    C_BOLD, C_TT_PURPLE,
    TT_STUDIO_ROOT, OS_NAME,
    INFERENCE_SERVER_DIR, INFERENCE_SERVER_BRANCH,
    FASTAPI_PID_FILE, FASTAPI_LOG_FILE,
    DOCKER_CONTROL_SERVICE_DIR, DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE,
)
from _runner.utils import run_command
from _runner.port_manager import PortManager

try:
    import requests as _requests
    _HAS_REQUESTS = True
except ImportError:
    import urllib.request as _urllib_request
    _HAS_REQUESTS = False


class ServiceManager:
    def __init__(self, ctx, env_mgr):
        self.ctx = ctx
        self.env_mgr = env_mgr

    # ------------------------------------------------------------------ #
    #  TT Inference Server setup                                          #
    # ------------------------------------------------------------------ #

    def setup_tt_inference_server(self):
        """Set up TT Inference Server by preparing environment (submodule expected)."""
        print(f"\n{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
        print(f"{C_TT_PURPLE}{C_BOLD}         🔧 Setting up TT Inference Server          {C_RESET}")
        print(f"{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")

        # Always ensure submodules are properly initialized
        from _runner.artifact_manager import ArtifactManager
        artifact_mgr = ArtifactManager(self.ctx, self.env_mgr)
        if not artifact_mgr.configure_inference_server_artifact():
            return False

        # Check if the directory exists after submodule initialization
        if not os.path.exists(INFERENCE_SERVER_DIR):
            print(f"{C_RED}⛔ Error: TT Inference Server directory still not found at {INFERENCE_SERVER_DIR}{C_RESET}")
            print(f"   This suggests the submodule configuration may be incorrect.")
            return False
        else:
            print(f"📁 TT Inference Server directory found at {INFERENCE_SERVER_DIR}")

        # Ensure the submodule is on the correct branch and up to date
        try:
            print(f"🔧 Ensuring TT Inference Server is on the correct branch and up to date...")
            original_dir = os.getcwd()
            os.chdir(INFERENCE_SERVER_DIR)

            # Check current branch/status
            result = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True, check=False)
            current_branch = result.stdout.strip()

            if current_branch != INFERENCE_SERVER_BRANCH:
                print(f"🌿 Current branch: {current_branch or 'detached HEAD'}, switching to: {INFERENCE_SERVER_BRANCH}")

                # Fetch the latest changes from remote
                print(f"📥 Fetching latest changes from remote...")
                run_command(["git", "fetch", "origin"], check=True)

                # Check out the correct branch as specified in .gitmodules
                run_command(["git", "checkout", INFERENCE_SERVER_BRANCH], check=True)

                # Pull the latest changes
                print(f"📥 Pulling latest changes...")
                run_command(["git", "pull", "origin", INFERENCE_SERVER_BRANCH], check=True)
            else:
                print(f"✅ Already on correct branch: {INFERENCE_SERVER_BRANCH}")
                # Still pull latest changes
                print(f"📥 Pulling latest changes...")
                run_command(["git", "pull", "origin", INFERENCE_SERVER_BRANCH], check=True)

            print(f"✅ TT Inference Server is now on the correct branch: {INFERENCE_SERVER_BRANCH}")

        except (subprocess.CalledProcessError, SystemExit) as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not update TT Inference Server branch: {e}{C_RESET}")
            print(f"   Continuing with current state...")
        finally:
            os.chdir(original_dir)

        # Verify that requirements-api.txt exists
        requirements_file = os.path.join(INFERENCE_SERVER_DIR, "requirements-api.txt")
        if not os.path.exists(requirements_file):
            print(f"{C_RED}⛔ Error: requirements-api.txt not found in TT Inference Server directory{C_RESET}")
            print(f"   Expected path: {requirements_file}")
            print(f"   This suggests the submodule is not properly set up or on the wrong branch.")
            return False
        else:
            print(f"✅ Found requirements-api.txt in TT Inference Server directory")

        return True

    def setup_fastapi_environment(self):
        """Set up the FastAPI environment with virtual environment and dependencies."""
        print(f"🔧 Setting up FastAPI environment...")

        # Store original directory
        original_dir = os.getcwd()

        try:
            # Change to inference server directory (like startup.sh)
            print(f"📁 Changing to TT Inference Server directory: {INFERENCE_SERVER_DIR}")
            os.chdir(INFERENCE_SERVER_DIR)

            # Verify we're in the right directory and can see the requirements file
            current_dir = os.getcwd()
            print(f"📍 Current directory: {current_dir}")

            if not os.path.exists("requirements-api.txt"):
                print(f"{C_RED}⛔ Error: requirements-api.txt not found in {current_dir}{C_RESET}")
                print(f"📂 Files in current directory:")
                try:
                    for item in os.listdir("."):
                        print(f"   - {item}")
                except Exception as e:
                    print(f"   Could not list directory: {e}")
                return False
            else:
                print(f"✅ Found requirements-api.txt in {current_dir}")

            # Create virtual environment if it doesn't exist (like startup.sh)
            if not os.path.exists(".venv"):
                print(f"🐍 Creating Python virtual environment...")
                try:
                    run_command(["python3", "-m", "venv", ".venv"], check=True)
                    print(f"✅ Virtual environment created successfully")
                except (subprocess.CalledProcessError, SystemExit) as e:
                    print(f"{C_RED}⛔ Error: Failed to create virtual environment: {e}{C_RESET}")
                    return False
            else:
                print(f"🐍 Virtual environment already exists")

            # Verify the virtual environment was created properly
            venv_pip = ".venv/bin/pip"
            if OS_NAME == "Windows":
                venv_pip = ".venv/Scripts/pip.exe"

            if not os.path.exists(venv_pip):
                print(f"{C_RED}⛔ Error: Virtual environment pip not found at {venv_pip}{C_RESET}")
                return False

            # Upgrade pip first
            print(f"📦 Upgrading pip in virtual environment...")
            try:
                run_command([venv_pip, "install", "--upgrade", "pip"], check=True)
                print(f"✅ Pip upgraded successfully")
            except (subprocess.CalledProcessError, SystemExit) as e:
                print(f"{C_YELLOW}⚠️  Warning: Failed to upgrade pip: {e}{C_RESET}")
                print(f"   Continuing with installation...")

            # Install requirements (like startup.sh)
            print(f"📦 Installing Python requirements from requirements-api.txt...")
            try:
                run_command([venv_pip, "install", "-r", "requirements-api.txt"], check=True)
                print(f"✅ Requirements installed successfully")
            except (subprocess.CalledProcessError, SystemExit) as e:
                print(f"{C_RED}⛔ Error: Failed to install requirements: {e}{C_RESET}")
                print(f"📜 Contents of requirements-api.txt:")
                try:
                    with open("requirements-api.txt", "r") as f:
                        for line_num, line in enumerate(f, 1):
                            print(f"   {line_num}: {line.rstrip()}")
                except Exception as read_e:
                    print(f"   Could not read requirements file: {read_e}")
                return False

            # Verify uvicorn was installed
            venv_uvicorn = ".venv/bin/uvicorn"
            if OS_NAME == "Windows":
                venv_uvicorn = ".venv/Scripts/uvicorn.exe"

            if os.path.exists(venv_uvicorn):
                print(f"✅ uvicorn installed successfully at {venv_uvicorn}")
            else:
                print(f"{C_YELLOW}⚠️  Warning: uvicorn not found at expected location {venv_uvicorn}{C_RESET}")
                print(f"   Checking if uvicorn is available in the virtual environment...")
                try:
                    run_command([".venv/bin/python", "-c", "import uvicorn; print('uvicorn is available')"], check=True)
                    print(f"✅ uvicorn is available in the virtual environment")
                except (subprocess.CalledProcessError, SystemExit):
                    print(f"{C_RED}⛔ Error: uvicorn is not available in the virtual environment{C_RESET}")
                    return False

            return True
        finally:
            # Always return to original directory
            os.chdir(original_dir)

    def start_fastapi_server(self, no_sudo=False):
        """Start the FastAPI server on port 8001."""
        print(f"🚀 Starting FastAPI server on port 8001...")

        port_mgr = PortManager(self.ctx)

        # Check if port 8001 is available
        if not port_mgr.check_port_available(8001):
            print(f"⚠️  Port 8001 is already in use. Attempting to free the port...")
            if not port_mgr.kill_process_on_port(8001, no_sudo=no_sudo):
                print(f"{C_RED}❌ Failed to free port 8001. Please manually stop any process using this port.{C_RESET}")
                return False
            print(f"✅ Port 8001 is now available")
        else:
            print(f"✅ Port 8001 is available")

        # Create PID and log files as regular user (no sudo needed for port 8001)
        # FastAPI writes logs to fastapi.log at repo root, not to persistent volume
        print(f"🔧 Setting up log and PID files...")

        for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
            try:
                # Create files as regular user
                with open(file_path, 'w') as f:
                    pass
                os.chmod(file_path, 0o644)
            except Exception as e:
                print(f"{C_YELLOW}Warning: Could not create {file_path}: {e}{C_RESET}")

        # Get environment variables for the server (exactly like startup.sh)
        jwt_secret = self.env_mgr.get_env_var("JWT_SECRET")
        hf_token = self.env_mgr.get_env_var("HF_TOKEN")

        # Export the environment variables (exactly like startup.sh)
        if jwt_secret:
            os.environ["JWT_SECRET"] = jwt_secret
        if hf_token:
            os.environ["HF_TOKEN"] = hf_token

        # Start the FastAPI server - use the same approach as startup.sh
        venv_uvicorn = os.path.join(INFERENCE_SERVER_DIR, ".venv", "bin", "uvicorn")
        if OS_NAME == "Windows":
            venv_uvicorn = os.path.join(INFERENCE_SERVER_DIR, ".venv", "Scripts", "uvicorn.exe")

        if not os.path.exists(venv_uvicorn):
            print(f"{C_RED}⛔ Error: uvicorn not found in virtual environment{C_RESET}")
            print(f"   Expected path: {venv_uvicorn}")
            print(f"   Please ensure requirements-api.txt was installed correctly")
            return False

        try:
            # Create a temporary wrapper script exactly like startup.sh
            with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
                temp_script.write('''#!/bin/bash
set -e
cd "$1"
# Save PID to file first to avoid permission issues
echo $$ > "$2"
# Try to start the server with specific error handling
if ! "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8001 > "$4" 2>&1; then
    echo "Failed to start FastAPI server. Check logs at $4"
    exit 1
fi
''')
                temp_script_path = temp_script.name

            # Make the script executable
            os.chmod(temp_script_path, 0o755)

            # Start the server using the wrapper script with environment variables
            # Run as the actual user (no sudo needed for port 8001)
            env = os.environ.copy()
            if jwt_secret:
                env["JWT_SECRET"] = jwt_secret
            if hf_token:
                env["HF_TOKEN"] = hf_token

            # Run without sudo - port 8001 is non-privileged
            cmd = [temp_script_path, INFERENCE_SERVER_DIR, FASTAPI_PID_FILE, ".venv", FASTAPI_LOG_FILE]
            process = subprocess.Popen(cmd, env=env)

            # Health check (same as startup.sh)
            print(f"⏳ Waiting for FastAPI server to start...")
            health_check_retries = 30
            health_check_delay = 2

            for i in range(1, health_check_retries + 1):
                # First check if process is running (exactly like startup.sh)
                if process.poll() is not None:
                    print(f"{C_RED}⛔ Error: FastAPI server process died{C_RESET}")
                    print(f"📜 Last few lines of FastAPI log:")
                    try:
                        with open(FASTAPI_LOG_FILE, 'r') as f:
                            lines = f.readlines()
                            for line in lines[-15:]:
                                print(f"   {line.rstrip()}")
                    except:
                        print("   No log file found")

                    # Check for common errors in the log (exactly like startup.sh)
                    try:
                        with open(FASTAPI_LOG_FILE, 'r') as f:
                            log_content = f.read()
                            if "address already in use" in log_content:
                                print(f"{C_RED}❌ Error: Port 8001 is still in use by another process.{C_RESET}")
                                print(f"   Please manually stop any process using port 8001:")
                                print(f"   1. Run: sudo lsof -i :8001")
                                print(f"   2. Run: sudo kill -9 <PID>")
                    except:
                        pass
                    return False

                # Check if server is responding to HTTP requests (exactly like startup.sh)
                try:
                    result = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:8001/"],
                                           capture_output=True, text=True, timeout=5, check=False)
                    if result.stdout.strip() in ["200", "404"]:
                        print(f"✅ FastAPI server started successfully (PID: {process.pid})")
                        print(f"🌐 FastAPI server accessible at: http://localhost:8001")
                        print(f"🔐 FastAPI server: {C_CYAN}http://localhost:8001{C_RESET} (check: curl http://localhost:8001/)")
                        return True
                except:
                    # Fallback to urllib if curl is not available
                    try:
                        import urllib.request
                        response = urllib.request.urlopen("http://localhost:8001/", timeout=5)
                        if response.getcode() in [200, 404]:
                            print(f"✅ FastAPI server started successfully (PID: {process.pid})")
                            print(f"🌐 FastAPI server accessible at: http://localhost:8001")
                            print(f"🔐 FastAPI server: {C_CYAN}http://localhost:8001{C_RESET} (check: curl http://localhost:8001/)")
                            return True
                    except:
                        pass

                if i == health_check_retries:
                    print(f"{C_RED}⛔ Error: FastAPI server failed health check after {health_check_retries} attempts{C_RESET}")
                    print(f"📜 Last few lines of FastAPI log:")
                    try:
                        with open(FASTAPI_LOG_FILE, 'r') as f:
                            lines = f.readlines()
                            for line in lines[-10:]:
                                print(f"   {line.rstrip()}")
                    except:
                        print("   No log file found")
                    print(f"💡 Try running: curl -v http://localhost:8001/ to debug connection issues")
                    return False

                print(f"⏳ Health check attempt {i}/{health_check_retries} - waiting {health_check_delay}s...")
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

    def cleanup_fastapi_server(self, no_sudo=False):
        """Clean up FastAPI server processes and files."""
        print(f"🧹 Cleaning up FastAPI server...")

        # Track what was cleaned
        pid_file_existed = False
        process_killed = False
        port_freed = False
        files_removed = []

        port_mgr = PortManager(self.ctx)

        # Helper function to check if process is still alive
        def is_process_alive(pid):
            """Check if a process with given PID is still running."""
            try:
                # Signal 0 doesn't kill, just checks if process exists
                os.kill(int(pid), 0)
                return True
            except ProcessLookupError:
                return False  # Process doesn't exist
            except PermissionError:
                # If we can't check, try with sudo
                if not no_sudo:
                    result = subprocess.run(["sudo", "kill", "-0", str(pid)],
                                          capture_output=True, check=False)
                    return result.returncode == 0
                return True  # Assume alive if we can't check

        # Kill process if PID file exists
        if os.path.exists(FASTAPI_PID_FILE):
            pid_file_existed = True
            try:
                with open(FASTAPI_PID_FILE, 'r') as f:
                    pid = f.read().strip()
                if pid and pid.isdigit():
                    pid_int = int(pid)
                    # Check if process is actually running
                    if is_process_alive(pid_int):
                        print(f"🛑 Found FastAPI process with PID {pid}. Stopping it...")
                        try:
                            # Try graceful termination first
                            os.kill(pid_int, signal.SIGTERM)
                            time.sleep(2)

                            # Check if still alive and force kill if needed
                            if is_process_alive(pid_int):
                                print(f"⚠️  Process {pid} still running. Forcing termination...")
                                os.kill(pid_int, signal.SIGKILL)
                                time.sleep(1)

                            # Verify termination
                            if not is_process_alive(pid_int):
                                process_killed = True
                                print(f"✅ FastAPI process {pid} terminated successfully")
                            else:
                                print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                        except PermissionError:
                            if not no_sudo:
                                # Try with sudo
                                print(f"🔐 Using sudo to terminate process {pid}...")
                                subprocess.run(["sudo", "kill", "-15", pid], check=False)
                                time.sleep(2)
                                if is_process_alive(pid_int):
                                    subprocess.run(["sudo", "kill", "-9", pid], check=False)
                                    time.sleep(1)

                                # Verify termination
                                if not is_process_alive(pid_int):
                                    process_killed = True
                                    print(f"✅ FastAPI process {pid} terminated successfully")
                                else:
                                    print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                            else:
                                print(f"{C_YELLOW}⚠️  Warning: Could not kill process {pid} without sudo{C_RESET}")
                        except ProcessLookupError:
                            # Process already terminated
                            process_killed = True
                            print(f"ℹ️  Process {pid} was already terminated")
                        except Exception as e:
                            print(f"{C_YELLOW}⚠️  Warning: Could not kill FastAPI process {pid}: {e}{C_RESET}")
                    else:
                        print(f"ℹ️  PID file exists but process {pid} is not running")
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not read PID file: {e}{C_RESET}")

        # Kill any process on port 8001 (this handles cases where PID file is missing but port is in use)
        port_was_in_use = not port_mgr.check_port_available(8001)
        port_result = port_mgr.kill_process_on_port(8001, no_sudo=no_sudo)
        if port_result and port_was_in_use:
            # kill_process_on_port returned True and port was in use, so we freed it
            # Verify port is now available
            if port_mgr.check_port_available(8001):
                port_freed = True

        # Remove PID and log files
        # FastAPI writes logs to fastapi.log at repo root (not persistent volume)
        for file_path in [FASTAPI_PID_FILE, FASTAPI_LOG_FILE]:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    files_removed.append(file_path)
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not remove {file_path}: {e}{C_RESET}")

        # Report cleanup status
        if process_killed or port_freed or files_removed:
            print(f"✅ FastAPI server cleanup completed")
            if process_killed:
                print(f"   • Process terminated")
            if port_freed:
                print(f"   • Port 8001 freed")
            if files_removed:
                print(f"   • Removed {len(files_removed)} file(s)")
        elif pid_file_existed:
            # PID file existed but process was already dead
            print(f"✅ FastAPI server cleanup completed (process was already stopped)")
        else:
            # Nothing to clean
            print(f"✅ FastAPI server cleanup completed (no running process found)")

    def start_docker_control_service(self, no_sudo=False):
        """Start the Docker Control Service on port 8002."""
        print(f"🚀 Starting Docker Control Service on port 8002...")

        from _runner.docker_manager import DockerManager
        docker_mgr = DockerManager(self.ctx)
        port_mgr = PortManager(self.ctx)

        # Check if user has Docker access
        if not docker_mgr.check_docker_access():
            print(f"{C_YELLOW}⚠️  Docker Control Service requires direct Docker socket access{C_RESET}")
            print(f"{C_YELLOW}   (660 permissions detected - service would need sudo which is not supported){C_RESET}")
            print(f"{C_CYAN}   Skipping Docker Control Service - Backend will use direct Docker SDK instead{C_RESET}")
            return False

        # Check if port 8002 is available
        if not port_mgr.check_port_available(8002):
            print(f"⚠️  Port 8002 is already in use. Attempting to free the port...")
            if not port_mgr.kill_process_on_port(8002, no_sudo=no_sudo):
                print(f"{C_RED}❌ Failed to free port 8002. Please manually stop any process using this port.{C_RESET}")
                return False
            print(f"✅ Port 8002 is now available")
        else:
            print(f"✅ Port 8002 is available")

        # Check if service is already running
        if _HAS_REQUESTS:
            try:
                response = _requests.get("http://127.0.0.1:8002/api/v1/health", timeout=2)
                if response.status_code == 200:
                    print(f"{C_GREEN}✅ Docker Control Service already running{C_RESET}")
                    return True
            except _requests.exceptions.RequestException:
                pass

        # Check if service directory exists
        if not os.path.exists(DOCKER_CONTROL_SERVICE_DIR):
            print(f"{C_RED}⛔ Error: Docker Control Service directory not found at {DOCKER_CONTROL_SERVICE_DIR}{C_RESET}")
            return False

        # Create PID and log files
        print(f"🔧 Setting up log and PID files...")

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
        if not os.path.exists(venv_dir):
            print("📦 Creating virtual environment for Docker Control Service...")
            try:
                subprocess.run(
                    ["python3", "-m", "venv", ".venv"],
                    cwd=DOCKER_CONTROL_SERVICE_DIR,
                    check=True
                )
            except Exception as e:
                print(f"{C_RED}⛔ Error creating virtual environment: {e}{C_RESET}")
                return False

        # Check if requirements are installed
        requirements_file = os.path.join(DOCKER_CONTROL_SERVICE_DIR, "requirements-api.txt")
        if not os.path.exists(requirements_file):
            print(f"{C_RED}⛔ Error: requirements-api.txt not found at {requirements_file}{C_RESET}")
            return False

        # Install/upgrade dependencies
        print("📦 Installing Docker Control Service dependencies...")
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
        jwt_secret = self.env_mgr.get_env_var("DOCKER_CONTROL_JWT_SECRET")

        # Export environment variables
        env = os.environ.copy()
        if jwt_secret:
            env["DOCKER_CONTROL_JWT_SECRET"] = jwt_secret

        # Start the service using uvicorn
        try:
            # Create a temporary wrapper script similar to FastAPI
            with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as temp_script:
                temp_script.write('''#!/bin/bash
set -e
cd "$1"
# Save PID to file
echo $$ > "$2"
# Start the service
if ! "$3/bin/uvicorn" api:app --host 0.0.0.0 --port 8002 > "$4" 2>&1; then
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

            # Health check
            print(f"⏳ Waiting for Docker Control Service to start...")
            health_check_retries = 30
            health_check_delay = 2

            for i in range(1, health_check_retries + 1):
                # Check if process is still running
                if process.poll() is not None:
                    print(f"{C_RED}⛔ Error: Docker Control Service process died{C_RESET}")
                    print(f"📜 Last few lines of log:")
                    try:
                        with open(DOCKER_CONTROL_LOG_FILE, 'r') as f:
                            lines = f.readlines()
                            for line in lines[-15:]:
                                print(f"   {line.rstrip()}")
                    except:
                        print("   No log file found")
                    return False

                # Check if service is responding
                if _HAS_REQUESTS:
                    try:
                        response = _requests.get("http://127.0.0.1:8002/api/v1/health", timeout=5)
                        if response.status_code == 200:
                            print(f"✅ Docker Control Service started successfully (PID: {process.pid})")
                            print(f"🌐 Docker Control Service accessible at: http://localhost:8002")
                            print(f"🔐 API documentation: {C_CYAN}http://localhost:8002/api/v1/docs{C_RESET}")
                            return True
                    except:
                        pass
                else:
                    # Fallback to urllib if requests not available
                    try:
                        import urllib.request
                        response = urllib.request.urlopen("http://localhost:8002/api/v1/health", timeout=5)
                        if response.getcode() == 200:
                            print(f"✅ Docker Control Service started successfully (PID: {process.pid})")
                            print(f"🌐 Docker Control Service accessible at: http://localhost:8002")
                            print(f"🔐 API documentation: {C_CYAN}http://localhost:8002/api/v1/docs{C_RESET}")
                            return True
                    except:
                        pass

                if i == health_check_retries:
                    print(f"{C_RED}⛔ Error: Docker Control Service failed health check after {health_check_retries} attempts{C_RESET}")
                    print(f"📜 Last few lines of log:")
                    try:
                        with open(DOCKER_CONTROL_LOG_FILE, 'r') as f:
                            lines = f.readlines()
                            for line in lines[-10:]:
                                print(f"   {line.rstrip()}")
                    except:
                        print("   No log file found")
                    return False

                print(f"⏳ Health check attempt {i}/{health_check_retries} - waiting {health_check_delay}s...")
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

    def cleanup_docker_control_service(self, no_sudo=False):
        """Clean up Docker Control Service processes and files."""
        print(f"🧹 Cleaning up Docker Control Service...")

        # Track what was cleaned
        pid_file_existed = False
        process_killed = False
        port_freed = False
        files_removed = []

        port_mgr = PortManager(self.ctx)

        # Helper function to check if process is still alive
        def is_process_alive(pid):
            """Check if a process with given PID is still running."""
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
            pid_file_existed = True
            try:
                with open(DOCKER_CONTROL_PID_FILE, 'r') as f:
                    pid = f.read().strip()
                if pid and pid.isdigit():
                    pid_int = int(pid)
                    if is_process_alive(pid_int):
                        print(f"🛑 Found Docker Control Service process with PID {pid}. Stopping it...")
                        try:
                            # Try graceful termination first
                            os.kill(pid_int, signal.SIGTERM)
                            time.sleep(2)

                            # Check if still alive and force kill if needed
                            if is_process_alive(pid_int):
                                print(f"⚠️  Process {pid} still running. Forcing termination...")
                                os.kill(pid_int, signal.SIGKILL)
                                time.sleep(1)

                            # Verify termination
                            if not is_process_alive(pid_int):
                                process_killed = True
                                print(f"✅ Docker Control Service process {pid} terminated successfully")
                            else:
                                print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                        except PermissionError:
                            if not no_sudo:
                                print(f"🔐 Using sudo to terminate process {pid}...")
                                subprocess.run(["sudo", "kill", "-15", pid], check=False)
                                time.sleep(2)
                                if is_process_alive(pid_int):
                                    subprocess.run(["sudo", "kill", "-9", pid], check=False)
                                    time.sleep(1)

                                if not is_process_alive(pid_int):
                                    process_killed = True
                                    print(f"✅ Docker Control Service process {pid} terminated successfully")
                                else:
                                    print(f"{C_YELLOW}⚠️  Warning: Could not verify termination of process {pid}{C_RESET}")
                            else:
                                print(f"{C_YELLOW}⚠️  Warning: Could not kill process {pid} without sudo{C_RESET}")
                        except ProcessLookupError:
                            process_killed = True
                            print(f"ℹ️  Process {pid} was already terminated")
                        except Exception as e:
                            print(f"{C_YELLOW}⚠️  Warning: Could not kill process {pid}: {e}{C_RESET}")
                    else:
                        print(f"ℹ️  PID file exists but process {pid} is not running")
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not read PID file: {e}{C_RESET}")

        # Kill any process on port 8002
        port_was_in_use = not port_mgr.check_port_available(8002)
        port_result = port_mgr.kill_process_on_port(8002, no_sudo=no_sudo)
        if port_result and port_was_in_use:
            if port_mgr.check_port_available(8002):
                port_freed = True

        # Remove PID and log files
        for file_path in [DOCKER_CONTROL_PID_FILE, DOCKER_CONTROL_LOG_FILE]:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    files_removed.append(file_path)
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not remove {file_path}: {e}{C_RESET}")

        # Report cleanup status
        if process_killed or port_freed or files_removed:
            print(f"✅ Docker Control Service cleanup completed")
            if process_killed:
                print(f"   • Process terminated")
            if port_freed:
                print(f"   • Port 8002 freed")
            if files_removed:
                print(f"   • Removed {len(files_removed)} file(s)")
        elif pid_file_existed:
            print(f"✅ Docker Control Service cleanup completed (process was already stopped)")
        else:
            print(f"✅ Docker Control Service cleanup completed (no running process found)")

    def ensure_frontend_dependencies(self, force_prompt=False, easy_mode=False):
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

        print(f"\n{C_BLUE}📦 Checking frontend dependencies for IDE support...{C_RESET}")

        if not os.path.exists(package_json_path):
            print(f"{C_RED}⛔ Error: package.json not found in {frontend_dir}. Cannot continue.{C_RESET}")
            return False

        # If node_modules already exists and is populated, we're good.
        if os.path.exists(node_modules_dir) and os.listdir(node_modules_dir):
            print(f"{C_GREEN}✅ Local node_modules found. IDE support is active.{C_RESET}")
            return True

        print(f"{C_YELLOW}💡 Local node_modules directory not found or is empty.{C_RESET}")
        print(f"{C_CYAN}   Installing them locally will enable IDE features like autocompletion.{C_RESET}")
        print(f"{C_CYAN}   This is optional; the application will still run correctly using the dependencies inside the Docker container.{C_RESET}")

        # Check for local npm installation
        has_local_npm = shutil.which("npm")

        try:
            if has_local_npm:
                # In easy mode, automatically skip npm installation
                if easy_mode:
                    print(f"{C_YELLOW}Skipping local npm installation (easy mode). IDE features may be limited.{C_RESET}")
                    self.env_mgr.save_preference("npm_install_locally", 'n')
                    return True

                # Check for saved preference
                npm_pref = self.env_mgr.get_preference("npm_install_locally")
                choice = None

                if not force_prompt and npm_pref:
                    if npm_pref in ['n', 'no', 'false']:
                        print(f"{C_YELLOW}Skipping local dependency installation (using saved preference). IDE features may be limited.{C_RESET}")
                        return True
                    # else preference is to install
                    choice = npm_pref
                else:
                    choice = input(f"Do you want to run 'npm install' locally? (Y/n): ").lower().strip() or 'y'
                    self.env_mgr.save_preference("npm_install_locally", choice)

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
                docker_pref = self.env_mgr.get_preference("npm_install_via_docker")
                choice = None

                if not force_prompt and docker_pref:
                    if docker_pref in ['n', 'no', 'false']:
                        print(f"{C_YELLOW}Skipping local dependency installation (using saved preference). IDE features may be limited.{C_RESET}")
                        return True
                    choice = docker_pref
                else:
                    choice = input(f"Do you want to install dependencies using Docker? (Y/n): ").lower().strip() or 'y'
                    self.env_mgr.save_preference("npm_install_via_docker", choice)

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
