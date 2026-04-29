# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
TT Studio Setup Script

This script sets up the TT Studio environment including:
- Environment configuration
- Frontend dependencies installation (node_modules)
- Docker services setup
- TT Inference Server FastAPI setup (clones tt-inference-server repo and starts FastAPI on port 8001)

Usage:
    python run.py [options]

Options:
    --dev              Development mode with suggested defaults
    --cleanup          Clean up Docker containers and networks
    --cleanup-all      Clean up everything including persistent data
    --skip-fastapi     Skip TT Inference Server FastAPI setup
    --no-sudo          Skip sudo usage for FastAPI setup
    --check-headers       Check for missing SPDX license headers
    --add-headers         Add missing SPDX license headers (excludes frontend)
    --help-env         Show environment variables help
"""

import os
import sys
import subprocess
import time
import platform
import argparse
import shutil
import re
import getpass
import webbrowser
import socket
import tempfile
import signal
import json
from pathlib import Path
from datetime import datetime
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False

from venv_utils import recreate_venv_if_stale, print_manual_fix_steps
from startup_checks import check_startup_freshness

# --- Color Definitions ---
C_RESET = '\033[0m'
C_RED = '\033[0;31m'
C_GREEN = '\033[0;32m'
C_YELLOW = '\033[0;33m'
C_BLUE = '\033[0;34m'
C_MAGENTA = '\033[0;35m'
C_CYAN = '\033[0;36m'
C_WHITE = '\033[0;37m'
C_BOLD = '\033[1m'
C_ORANGE = '\033[38;5;208m'
C_TT_PURPLE = '\033[38;5;99m'

# --- Global Paths and Constants ---
TT_STUDIO_ROOT = os.getcwd()
# Removed: INFERENCE_SERVER_BRANCH - no longer using git submodule (externalized as artifact)
OS_NAME = platform.system()

# --- ASCII Art Constants ---
# Credit: figlet font slant by Glenn Chappell
TENSTORRENT_ASCII_ART = r"""   __                  __                             __
  / /____  ____  _____/ /_____  _____________  ____  / /_
 / __/ _ \/ __ \/ ___/ __/ __ \/ ___/ ___/ _ \/ __ \/ __/
/ /_/  __/ / / (__  ) /_/ /_/ / /  / /  /  __/ / / / /_
\__/\___/_/ /_/____/\__/\____/_/  /_/   \___/_/ /_/\__/"""

# --- File Paths ---
DOCKER_COMPOSE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.yml")
DOCKER_COMPOSE_DEV_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.dev-mode.yml")
DOCKER_COMPOSE_PROD_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.prod.yml")
DOCKER_COMPOSE_TT_HARDWARE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.tt-hardware.yml")
ENV_FILE_PATH = os.path.join(TT_STUDIO_ROOT, "app", ".env")
ENV_FILE_DEFAULT = os.path.join(TT_STUDIO_ROOT, "app", ".env.default")
# Updated: Use inference-api instead of tt-inference-server submodule
INFERENCE_API_DIR = os.path.join(TT_STUDIO_ROOT, "inference-api")
INFERENCE_ARTIFACT_DIR = os.path.join(TT_STUDIO_ROOT, ".artifacts", "tt-inference-server")
# These will be read from .env file or environment variables
INFERENCE_ARTIFACT_VERSION = None  # Will be set after get_env_var is defined
INFERENCE_ARTIFACT_URL = None  # Will be set after get_env_var is defined
FASTAPI_PID_FILE = os.path.join(TT_STUDIO_ROOT, "fastapi.pid")
FASTAPI_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "fastapi.log")
DOCKER_CONTROL_SERVICE_DIR = os.path.join(TT_STUDIO_ROOT, "docker-control-service")
DOCKER_CONTROL_PID_FILE = os.path.join(TT_STUDIO_ROOT, "docker-control-service.pid")
DOCKER_CONTROL_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "docker-control-service.log")
PREFS_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_preferences.json")
EASY_CONFIG_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_easy_config.json")
STARTUP_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "startup.log")

# Map health check URLs to Docker container name prefixes (for auto-log-fetching on failure)
# Container names vary by mode: tt_studio_backend_api_prod, tt_studio_frontend_dev, etc.
# We use prefixes and resolve at runtime via _resolve_container_name()
SERVICE_CONTAINER_PREFIX_MAP = {
    "http://localhost:8000/up/": "tt_studio_backend",
    "http://localhost:3000/": "tt_studio_frontend",
    "http://localhost:8080/": "tt_studio_agent",
    "http://localhost:8111/api/v1/heartbeat": "tt_studio_chroma",
}

# Global flag to determine if we should overwrite existing values
FORCE_OVERWRITE = False


# --- Startup Logger ---
class StartupLogger:
    """
    Writes a structured startup.log to TT_STUDIO_ROOT.
    Fail-silent: if log file is unwritable, all methods are no-ops.
    """
    def __init__(self, log_path):
        self._path = log_path
        self._steps = []
        self._enabled = True
        try:
            self._f = open(log_path, 'w', buffering=1)
        except OSError:
            self._enabled = False
            self._f = None

    def _ts(self):
        return datetime.now().isoformat(timespec='seconds')

    def header(self, version_info):
        if not self._enabled:
            return
        self._f.write(f"=== TT Studio Startup Log ===\n")
        self._f.write(f"Timestamp : {self._ts()}\n")
        self._f.write(f"Version   : {version_info}\n")
        self._f.write(f"Python    : {sys.version.split()[0]}\n")
        self._f.write(f"Platform  : {OS_NAME} {platform.release()}\n")
        self._f.write(f"CWD       : {TT_STUDIO_ROOT}\n")
        self._f.write(f"{'─'*60}\n")

    def step(self, name, status="START", detail=""):
        if not self._enabled:
            return
        entry = {"step": name, "status": status, "detail": detail, "ts": self._ts()}
        self._steps.append(entry)
        line = f"[{entry['ts']}] [{status:<5}] {name}"
        if detail:
            line += f"  -- {detail}"
        self._f.write(line + "\n")

    def summary(self, exit_code):
        if not self._enabled:
            return
        self._f.write(f"{'─'*60}\n")
        self._f.write(f"Exit code : {exit_code}\n")
        fails = [s for s in self._steps if s['status'] == 'FAIL']
        if fails:
            self._f.write("Failed steps:\n")
            for s in fails:
                self._f.write(f"  - {s['step']}: {s['detail']}\n")
        else:
            self._f.write("All steps completed successfully.\n")
        self._f.write(f"=== End of log ===\n")
        self._f.flush()

    def close(self):
        if self._f:
            self._f.close()


startup_log = StartupLogger(STARTUP_LOG_FILE)


def clear_lines(n):
    """Move cursor up n lines and clear them. Used to replace transient progress output."""
    if n <= 0:
        return
    for _ in range(n):
        sys.stdout.write("\033[A\033[2K")  # move up + clear line
    sys.stdout.flush()


def run_command(command, check=False, cwd=None, capture_output=True, shell=False):
    """Helper function to run a shell command."""
    try:
        cmd_str = command if shell else ' '.join(command)
        return subprocess.run(command, check=check, cwd=cwd, text=True, capture_output=capture_output, shell=shell)
    except FileNotFoundError as e:
        print(f"{C_RED}⛔ Error: Command not found: {e.filename}{C_RESET}")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        # Don't exit if check=False, just return the result
        if check:
            print(f"{C_RED}⛔ Error executing command: {cmd_str}{C_RESET}")
            if capture_output:
                print(f"{C_RED}Stderr: {e.stderr}{C_RESET}")
            sys.exit(1)
        return e


def run_preflight_checks():
    """
    Run fast system checks before startup. Only prints output on warnings/failures.
    Returns True if checks pass (warnings are OK).
    """
    warnings = []

    # 1. Python version
    major, minor = sys.version_info[:2]
    if (major, minor) < (3, 8):
        print(f"{C_RED}⛔ Python {major}.{minor} detected. TT Studio requires Python 3.8+.{C_RESET}")
        sys.exit(1)

    # 2. Disk space
    try:
        statvfs = os.statvfs(TT_STUDIO_ROOT)
        free_gb = (statvfs.f_bavail * statvfs.f_frsize) / (1024 ** 3)
        if free_gb < 5:
            warnings.append(f"Low disk space: {free_gb:.1f} GB free (5 GB recommended). Run: docker system prune -af")
    except Exception:
        pass

    # 3. Available memory (Linux only)
    try:
        if OS_NAME == "Linux":
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemAvailable:"):
                        free_ram_gb = int(line.split()[1]) / (1024 ** 2)
                        if free_ram_gb < 4:
                            warnings.append(f"Low RAM: {free_ram_gb:.1f} GB available (4 GB recommended)")
                        break
    except Exception:
        pass

    # 4. Docker Hub connectivity
    try:
        with socket.create_connection(("registry.hub.docker.com", 443), timeout=5):
            pass
    except OSError:
        warnings.append("Cannot reach Docker Hub — builds may fail if images need pulling")

    if warnings:
        print(f"\n{C_YELLOW}⚠️  Pre-flight warnings:{C_RESET}")
        for w in warnings:
            print(f"  {C_YELLOW}• {w}{C_RESET}")
        print()

    return True


def _resolve_container_name(prefix):
    """Resolve a container name prefix to the actual running container name.
    E.g. 'tt_studio_frontend' -> 'tt_studio_frontend_prod' or 'tt_studio_frontend_dev'.
    Returns the first match, or the prefix itself as fallback.
    """
    try:
        result = subprocess.run(
            ["docker", "ps", "-a", "--filter", f"name={prefix}", "--format", "{{.Names}}"],
            capture_output=True, text=True, check=False, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().split('\n')[0]
    except Exception:
        pass
    return prefix


def suggest_docker_fixes(error_context):
    """Provide contextual suggestions for Docker-related errors."""
    print(f"\n{C_CYAN}💡 Common solutions:{C_RESET}")

    ctx = error_context.lower()
    if "build" in ctx:
        print(f"  • Check Dockerfile syntax and COPY/ADD source files")
        print(f"  • Rebuild without cache: cd app && docker compose build --no-cache")

    if "permission" in ctx or "denied" in ctx:
        print(f"  • Add user to docker group: sudo usermod -aG docker $USER")
        print(f"  • Or run: python run.py --fix-docker")

    if "port" in ctx or "address already in use" in ctx:
        print(f"  • Check port usage: lsof -i :8000")
        print(f"  • Free ports: python run.py --cleanup")

    # Always show these
    print(f"  • Check Docker is running: docker info")
    print(f"  • Clean up and retry: python run.py --cleanup && python run.py")


def suggest_pip_fixes():
    """Provide suggestions for pip installation errors."""
    print(f"\n{C_CYAN}💡 Common solutions:{C_RESET}")
    print(f"  • Check internet connectivity: ping pypi.org")
    print(f"  • Upgrade pip: pip3 install --upgrade pip")
    print(f"  • Clear pip cache: pip3 cache purge")
    print(f"  • Check Python version compatibility")


def copy_to_clipboard(text):
    """Copy text to system clipboard. Returns True if successful."""
    try:
        if OS_NAME == "Darwin":
            process = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
            process.communicate(text.encode('utf-8'))
            return process.returncode == 0
        elif OS_NAME == "Linux":
            for cmd in [['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]:
                try:
                    process = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                    process.communicate(text.encode('utf-8'))
                    if process.returncode == 0:
                        return True
                except FileNotFoundError:
                    continue
            return False
        elif OS_NAME == "Windows":
            process = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=True)
            process.communicate(text.encode('utf-16'))
            return process.returncode == 0
        return False
    except Exception:
        return False


def parse_docker_build_failure(output):
    """
    Parse Docker build/compose output to identify which container failed.
    Returns (container_name, friendly_name, error_section) or (None, None, None).
    """
    if not output:
        return None, None, None

    container_map = {
        'tt_studio_backend': 'Backend',
        'tt_studio_frontend': 'Frontend',
        'tt_studio_agent': 'Agent',
        'tt_studio_chroma': 'ChromaDB',
    }

    failed_container = None

    # Pattern 1: "target tt_studio_<name>: failed to solve"
    target_match = re.search(r'target (tt_studio_\w+): failed to solve', output, re.IGNORECASE)
    if target_match:
        failed_container = target_match.group(1)

    # Pattern 2: [container X/Y] with ERROR
    if not failed_container:
        for container in container_map:
            pattern = rf'\[{container}\s+\d+/\d+\].*?(?:ERROR|error|failed|FAILED)'
            if re.search(pattern, output, re.IGNORECASE):
                failed_container = container
                break

    # Pattern 3: any tt_studio container mentioned
    if not failed_container:
        match = re.search(r'\[(tt_studio_\w+)\s+\d+/\d+\]', output)
        if match:
            failed_container = match.group(1)

    if failed_container:
        friendly_name = container_map.get(failed_container, failed_container)
        error_lines = []
        for line in output.split('\n'):
            if failed_container in line or 'ERROR' in line or 'error' in line:
                error_lines.append(line)
        error_section = '\n'.join(error_lines[-20:]) if error_lines else None
        return failed_container, friendly_name, error_section

    return None, None, None


def run_docker_compose_with_progress(cmd, cwd):
    """
    Run docker compose, capturing output silently. Shows a progress indicator.
    On success, clears the transient progress lines and leaves a 1-line summary.
    On failure, the full output is returned for diagnostics.
    Returns (returncode, full_output_string).
    """
    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    output_lines = []
    printed_lines = 0  # track lines we printed for clearing
    has_dots = False
    for line in process.stdout:
        output_lines.append(line)
        stripped = line.strip()
        if "Built" in stripped or "Healthy" in stripped or "Running" in stripped:
            if has_dots:
                sys.stdout.write("\n")
                printed_lines += 1
                has_dots = False
            print(f"  {C_GREEN}{stripped}{C_RESET}")
            printed_lines += 1
        elif stripped.startswith("#") and "DONE" in stripped:
            sys.stdout.write(".")
            sys.stdout.flush()
            has_dots = True

    process.wait()

    if has_dots:
        sys.stdout.write("\n")
        printed_lines += 1

    full_output = ''.join(output_lines)

    # On success, clear the transient build output and replace with a single line
    if process.returncode == 0 and printed_lines > 0:
        clear_lines(printed_lines)

    return process.returncode, full_output


def verify_docker_containers(use_sudo=False):
    """
    Verify that Docker containers started successfully.
    Returns dict {container_name: {'status': str, 'running': bool}} or empty dict on error.
    """
    try:
        cmd = ["docker", "ps", "-a", "--filter", "name=tt_studio", "--format", "{{.Names}}\t{{.Status}}"]
        if use_sudo:
            cmd = ["sudo"] + cmd

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            print(f"{C_RED}⛔ Error: Failed to list Docker containers{C_RESET}")
            if result.stderr:
                print(f"{C_RED}   {result.stderr}{C_RESET}")
            return {}

        containers = {}
        for line in result.stdout.strip().split('\n'):
            if line and '\t' in line:
                name, status = line.split('\t', 1)
                containers[name] = {
                    'status': status,
                    'running': status.startswith('Up'),
                }

        if not containers:
            print(f"{C_YELLOW}⚠️  No tt_studio containers found{C_RESET}")

        return containers

    except FileNotFoundError:
        print(f"{C_RED}⛔ Error: Could not check containers. Ensure Docker is installed and in PATH{C_RESET}")
        return {}
    except Exception as e:
        print(f"{C_RED}⛔ Error verifying containers: {type(e).__name__}: {e}{C_RESET}")
        return {}


def diagnose_container_failure(container_name, exit_code, logs):
    """
    Analyze a container failure and return structured diagnosis.
    Returns dict with keys: severity, cause, detail, action.
    """
    # Exit code classification
    if exit_code == 137:
        return {
            'severity': 'critical',
            'cause': 'Out of Memory (OOM kill)',
            'detail': f"{container_name} was killed by the kernel (exit 137). Docker memory limit exceeded or host ran out of RAM.",
            'action': f"Check host memory: free -h\n  Check Docker limit: docker inspect {container_name} | grep -i memory\n  Consider adding swap or increasing Docker memory limit",
        }
    if exit_code == 139:
        return {
            'severity': 'critical',
            'cause': 'Segmentation fault',
            'detail': f"{container_name} crashed with a segfault (exit 139). Possible native library bug or data corruption.",
            'action': f"Run: docker logs {container_name} --tail 50\n  Check dmesg: sudo dmesg | tail -20",
        }
    if exit_code == 143:
        return {
            'severity': 'warning',
            'cause': 'Terminated (SIGTERM)',
            'detail': f"{container_name} received SIGTERM (exit 143). Usually from a prior docker stop or cleanup.",
            'action': "Re-run: python run.py",
        }

    # Log pattern classification
    log_lower = (logs or "").lower()

    if "address already in use" in log_lower:
        port_match = re.search(r':(\d{3,5})', logs or "")
        port_hint = f" (port {port_match.group(1)})" if port_match else ""
        return {
            'severity': 'critical',
            'cause': f'Port conflict{port_hint}',
            'detail': f"{container_name} could not bind to a port already in use.",
            'action': f"Run: lsof -i{port_hint or ''}\n  Or: python run.py --cleanup && python run.py",
        }

    if "modulenotfounderror" in log_lower or "importerror" in log_lower:
        module_match = re.search(r"No module named '([^']+)'", logs or "")
        module_hint = f" ({module_match.group(1)})" if module_match else ""
        return {
            'severity': 'critical',
            'cause': f'Missing Python module{module_hint}',
            'detail': f"{container_name} failed to import a required module. Docker image may be stale.",
            'action': "Rebuild: python run.py --cleanup && python run.py",
        }

    if "keyerror" in log_lower:
        key_match = re.search(r"KeyError: '?([^'\n]+)'?", logs or "")
        key_hint = f" (key: {key_match.group(1)})" if key_match else ""
        return {
            'severity': 'critical',
            'cause': f'Configuration key missing{key_hint}',
            'detail': f"{container_name} encountered a missing env var or config key.",
            'action': "Check app/.env for missing variables. Run: python run.py --reconfigure",
        }

    if "permission denied" in log_lower or "permissionerror" in log_lower:
        return {
            'severity': 'critical',
            'cause': 'Permission denied',
            'detail': f"{container_name} was denied file/socket access. Common: persistent volume owned by root.",
            'action': "Fix ownership: sudo chown -R $USER:$USER tt_studio_persistent_volume\n  Or: python run.py --cleanup-all && python run.py",
        }

    if "no space left on device" in log_lower:
        return {
            'severity': 'critical',
            'cause': 'Disk full',
            'detail': f"{container_name} failed because disk is full.",
            'action': "Free space: df -h\n  Prune Docker: docker system prune -af",
        }

    return {
        'severity': 'warning',
        'cause': f'Unknown failure (exit code {exit_code})',
        'detail': f"{container_name} exited unexpectedly. No recognized failure pattern in logs.",
        'action': f"Run: docker logs {container_name} --tail 50",
    }


def print_container_diagnostics(containers):
    """Print diagnostic info for failed containers with smart diagnosis."""
    friendly_map = {
        'tt_studio_backend': 'Backend',
        'tt_studio_frontend': 'Frontend',
        'tt_studio_agent': 'Agent',
        'tt_studio_chroma': 'ChromaDB',
    }
    failed = {name: info for name, info in containers.items() if not info['running']}
    if not failed:
        return

    print(f"\n{C_RED}⚠️  Some containers failed to start:{C_RESET}")
    for name, info in failed.items():
        friendly = friendly_map.get(name, name)
        print(f"  • {C_YELLOW}{friendly} ({name}){C_RESET}: {info['status']}")

    # Auto-diagnose each failed container
    for name in failed:
        # Get exit code
        inspect_result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.ExitCode}}", name],
            capture_output=True, text=True, check=False,
        )
        try:
            exit_code = int(inspect_result.stdout.strip())
        except (ValueError, AttributeError):
            exit_code = -1

        # Get last 50 lines of logs
        logs_result = subprocess.run(
            ["docker", "logs", "--tail", "50", name],
            capture_output=True, text=True, check=False,
        )
        logs = (logs_result.stdout or "") + (logs_result.stderr or "")

        diagnosis = diagnose_container_failure(name, exit_code, logs)
        color = C_RED if diagnosis['severity'] == 'critical' else C_YELLOW
        print(f"\n{color}{C_BOLD}  Diagnosis for {friendly_map.get(name, name)}: {diagnosis['cause']}{C_RESET}")
        print(f"{color}  {diagnosis['detail']}{C_RESET}")
        print(f"{C_CYAN}  Recommended:{C_RESET}")
        for action_line in diagnosis['action'].splitlines():
            print(f"    {action_line}")


def handle_docker_compose_result(returncode, full_output, use_sudo=False):
    """
    Process result of docker compose up --build.
    Returns True on success, False on failure (with diagnostics printed).
    """
    if returncode == 0:
        # Give containers a moment to initialize
        time.sleep(3)

        containers = verify_docker_containers(use_sudo=use_sudo)
        if not containers:
            print(f"{C_RED}⛔ Could not verify container status{C_RESET}")
            suggest_docker_fixes("Container verification")
            return False

        failed_any = any(not info['running'] for info in containers.values())
        if failed_any:
            print(f"\n{C_RED}⛔ CONTAINER STARTUP FAILED{C_RESET}")
            print_container_diagnostics(containers)
            suggest_docker_fixes("Container startup")

            failed_names = [n for n, i in containers.items() if not i['running']]
            error_log = f"TT STUDIO CONTAINER FAILURE\nTimestamp: {datetime.now().isoformat()}\nFailed: {', '.join(failed_names)}\n"
            copy_to_clipboard(error_log)
            return False

        print(f"{C_GREEN}✅ All containers built and running{C_RESET}")
        return True

    # Build failed
    container_name, friendly_name, error_section = parse_docker_build_failure(full_output)

    print(f"\n{C_RED}{'='*60}{C_RESET}")
    if friendly_name:
        print(f"{C_RED}⛔ BUILD FAILED: {friendly_name} Container ({container_name}){C_RESET}")
    else:
        print(f"{C_RED}⛔ DOCKER COMPOSE BUILD FAILED{C_RESET}")
    print(f"{C_RED}{'='*60}{C_RESET}")

    if error_section:
        print(f"\n{C_RED}Error details:{C_RESET}")
        print(error_section)

    # Check which containers exist/failed
    containers = verify_docker_containers(use_sudo=use_sudo)
    if containers:
        print(f"\n{C_YELLOW}Container status:{C_RESET}")
        for name, info in containers.items():
            if info['running']:
                print(f"  {C_GREEN}✓ {name}: {info['status']}{C_RESET}")
            else:
                print(f"  {C_RED}❌ {name}: {info['status']}{C_RESET}")

    suggest_docker_fixes("Docker build")

    sudo_prefix = "sudo " if use_sudo else ""
    print(f"\n{C_CYAN}📋 Debug commands:{C_RESET}")
    print(f"  {sudo_prefix}cd app && docker compose build --no-cache")
    if container_name:
        print(f"  {sudo_prefix}docker logs {container_name}")

    # Clipboard
    error_log = f"TT STUDIO BUILD FAILURE\nTimestamp: {datetime.now().isoformat()}\nFailed: {container_name or 'unknown'}\nExit: {returncode}\n"
    if error_section:
        error_log += f"\n{error_section}\n"
    if copy_to_clipboard(error_log):
        print(f"\n{C_GREEN}📋 Error log copied to clipboard{C_RESET}")

    return False


def check_docker_installation():
    """Function to check Docker installation and daemon connectivity."""
    if not shutil.which("docker"):
        print(f"{C_RED}⛔ Error: Docker is not installed.{C_RESET}")
        print(f"{C_YELLOW}Please install Docker from: https://docs.docker.com/get-docker/{C_RESET}")
        sys.exit(1)

    # Test Docker daemon connectivity - first try without sudo
    result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)

    if result.returncode != 0:
        error_output = result.stderr.lower()

        if "permission denied" in error_output:
            # Permission issue - try with sudo
            print(f"\n{C_YELLOW}🔒 Docker Permission Issue Detected{C_RESET}")
            print(f"{C_YELLOW}Docker socket has secure 660 permissions - sudo access will be used{C_RESET}")
            print(f"{C_CYAN}Verifying Docker daemon is running with sudo...{C_RESET}")

            # Try with sudo to verify Docker daemon is actually running
            sudo_result = subprocess.run(["sudo", "docker", "info"], capture_output=True, text=True, check=False)

            if sudo_result.returncode == 0:
                print(f"{C_GREEN}✅ Docker daemon is running (sudo access confirmed){C_RESET}")
                print(f"{C_CYAN}TT Studio will use sudo for Docker commands when needed{C_RESET}\n")
                # Docker is working with sudo - continue
                return
            else:
                # Even with sudo it's not working
                sudo_error = sudo_result.stderr.lower()
                if "cannot connect" in sudo_error or "connection refused" in sudo_error:
                    print(f"\n{C_RED}⛔ Error: Docker daemon is not running{C_RESET}")
                    print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
                    print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                    print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
                    print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
                    print()
                    print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
                    print(f"   {C_CYAN}sudo service docker start{C_RESET}")
                    print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
                    print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                else:
                    print(f"{C_RED}⛔ Error: Docker daemon error{C_RESET}")
                    print(f"{C_YELLOW}Error: {sudo_result.stderr}{C_RESET}")
                sys.exit(1)

        elif "cannot connect" in error_output or "connection refused" in error_output:
            print(f"\n{C_RED}⛔ Error: Cannot connect to Docker daemon.{C_RESET}")
            print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
            print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
            print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
            print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
            print()
            print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
            print(f"   {C_CYAN}sudo service docker start{C_RESET}")
            print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
            print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
            sys.exit(1)
        else:
            print(f"{C_RED}⛔ Error: Cannot connect to Docker daemon.{C_RESET}")
            print(f"{C_YELLOW}Docker daemon error: {result.stderr}{C_RESET}")
            print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")
            sys.exit(1)
    else:
        # Docker accessible without sudo
        print(f"{C_GREEN}✅ Docker daemon is accessible{C_RESET}")

    # Check if docker compose is available
    compose_result = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True, check=False)

    if compose_result.returncode != 0:
        # Try with sudo if permission denied
        if "permission denied" in compose_result.stderr.lower():
            compose_result = subprocess.run(["sudo", "docker", "compose", "version"], capture_output=True, text=True, check=False)

        if compose_result.returncode != 0:
            print(f"{C_RED}⛔ Error: Docker Compose is not installed or not working correctly.{C_RESET}")
            print(f"{C_YELLOW}Please install Docker Compose from: https://docs.docker.com/compose/install/{C_RESET}")
            sys.exit(1)

def check_docker_access():
    """
    Check if current user has access to Docker socket.
    Returns True if user can access Docker, False otherwise.
    """
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
        return result.returncode == 0
    except Exception:
        return False

def run_docker_command(command, use_sudo=False, capture_output=False, check=False):
    """
    Run a Docker command with automatic sudo fallback if permission denied.

    Args:
        command (list): Docker command to run
        use_sudo (bool): Force use of sudo
        capture_output (bool): Capture command output (only for non-sudo or successful commands)
        check (bool): Raise exception on non-zero exit code

    Returns:
        subprocess.CompletedProcess: Result of command execution
    """
    # First try without sudo if not forced
    if not use_sudo:
        result = subprocess.run(command, capture_output=True, text=True, check=False)

        # If permission denied, try with sudo
        if result.returncode != 0 and "permission denied" in result.stderr.lower():
            print(f"{C_YELLOW}⚠️  Permission denied, retrying with sudo (you may be prompted for password)...{C_RESET}")
            sudo_command = ["sudo"] + command
            # Don't capture output when using sudo interactively - allow password prompt to show
            # But capture stderr to check for errors after authentication
            result = subprocess.run(sudo_command, capture_output=False, text=True, check=check)
            return result

        # If check=True and command failed, raise exception
        if check and result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, command, result.stdout, result.stderr)

        return result
    else:
        # Use sudo directly - don't capture output to allow interactive password prompt
        sudo_command = ["sudo"] + command
        return subprocess.run(sudo_command, capture_output=False, text=True, check=check)

def ensure_docker_group_membership():
    """
    Check if user is in Docker group and provide guidance if not.
    Returns True if user has access, False otherwise.
    """
    if check_docker_access():
        return True

    # Check socket permissions
    try:
        socket_stat = os.stat("/var/run/docker.sock")
        import grp
        socket_group = grp.getgrgid(socket_stat.st_gid).gr_name

        print(f"\n{C_YELLOW}🔒 Docker Socket Access Issue{C_RESET}")
        print(f"{C_YELLOW}{'─' * 60}{C_RESET}")
        print(f"{C_CYAN}The Docker socket requires group membership: {socket_group}{C_RESET}")
        print(f"\n{C_GREEN}To fix this, run:{C_RESET}")
        print(f"   {C_CYAN}sudo usermod -aG {socket_group} $USER{C_RESET}")
        print(f"   {C_CYAN}newgrp {socket_group}{C_RESET}")
        print(f"\n{C_YELLOW}Or continue with sudo access (commands will prompt for password){C_RESET}")
        print(f"{C_YELLOW}{'─' * 60}{C_RESET}\n")

        return False
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Could not check Docker socket permissions: {e}{C_RESET}")
        return False

def is_placeholder(value):
    """Check for common placeholder or empty values."""
    if not value or str(value).strip() == "":
        return True

    placeholder_patterns = [
        'django-insecure-default', 'tvly-xxx', 'hf_***',
        'tt-studio-rag-admin-password', 'cloud llama chat ui url',
        'cloud llama chat ui auth token', 'test-456',
        '<PATH_TO_ROOT_OF_REPO>', 'true or false to enable deployed mode',
        'true or false to enable RAG admin'
    ]

    value_str = str(value).strip().strip('"\'')
    return value_str in placeholder_patterns

def write_env_var(var_name, var_value, quote_value=True):
    """
    Update or add an environment variable to the app/.env file.
    """
    if not os.path.exists(ENV_FILE_PATH):
        open(ENV_FILE_PATH, 'w').close()

    with open(ENV_FILE_PATH, 'r') as f:
        lines = f.readlines()

    var_found = False
    
    if quote_value and var_value and str(var_value).strip():
        # Escape quotes in the value
        escaped_value = str(var_value).replace('"', '\\"')
        formatted_value = f'"{escaped_value}"'
    else:
        formatted_value = str(var_value) if var_value else ""
    
    new_line = f"{var_name}={formatted_value}\n"
    
    for i, line in enumerate(lines):
        if re.match(f"^{re.escape(var_name)}=", line):
            lines[i] = new_line
            var_found = True
            break
            
    if not var_found:
        lines.append(new_line)

    with open(ENV_FILE_PATH, 'w') as f:
        f.writelines(lines)

def comment_out_env_var(var_name):
    """Comment out an environment variable in the .env file (VAR=val → # VAR=val)."""
    if not os.path.exists(ENV_FILE_PATH):
        return
    with open(ENV_FILE_PATH, 'r') as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if re.match(f"^{re.escape(var_name)}=", line):
            lines[i] = f"# {line}"
            break
    with open(ENV_FILE_PATH, 'w') as f:
        f.writelines(lines)

def get_env_var(var_name, default=""):
    """Safely get a variable from the .env file."""
    if not os.path.exists(ENV_FILE_PATH):
        return default
    with open(ENV_FILE_PATH, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith(f"{var_name}="):
                value = line.split('=', 1)[1]
                return value.strip('"\'')
    return default

def parse_boolean_env(raw_value):
    """Parse boolean values from .env file"""
    return str(raw_value).lower().strip().strip('"\'') in ['true', '1', 't', 'y', 'yes']

def get_existing_env_vars():
    """Read all existing environment variables from .env file"""
    env_vars = {}
    if os.path.exists(ENV_FILE_PATH):
        with open(ENV_FILE_PATH, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key] = value.strip('"\'')
    return env_vars

def save_easy_config(config_dict):
    """Save easy mode configuration to JSON file"""
    try:
        with open(EASY_CONFIG_FILE_PATH, 'w') as f:
            json.dump(config_dict, f, indent=2)
        # Silent — no need to show config file path to user
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Warning: Could not save easy mode configuration: {e}{C_RESET}")

def load_easy_config():
    """Load easy mode configuration from JSON file"""
    if os.path.exists(EASY_CONFIG_FILE_PATH):
        try:
            with open(EASY_CONFIG_FILE_PATH, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"{C_YELLOW}⚠️  Warning: Could not load easy mode configuration: {e}{C_RESET}")
            return None
    return None

def should_configure_var(var_name, current_value):
    """
    Determine if we should configure a variable based on whether it's a placeholder
    and the global FORCE_OVERWRITE flag.
    """
    global FORCE_OVERWRITE
    
    # If we're forcing overwrite, always configure
    if FORCE_OVERWRITE:
        return True
    
    # If it's a placeholder, we should configure it (placeholders should always be replaced)
    if is_placeholder(current_value):
        return True
    
    # Otherwise, skip configuration (keep existing non-placeholder value)
    return False

def load_preferences():
    """Load user preferences from JSON file."""
    if os.path.exists(PREFS_FILE_PATH):
        try:
            with open(PREFS_FILE_PATH, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}

def save_preferences(prefs):
    """Save user preferences to JSON file."""
    try:
        with open(PREFS_FILE_PATH, 'w') as f:
            json.dump(prefs, f, indent=2)
    except IOError as e:
        print(f"{C_YELLOW}Warning: Could not save preferences: {e}{C_RESET}")

def save_preference(key, value):
    """Save a single preference key-value pair."""
    prefs = load_preferences()
    prefs[key] = value
    save_preferences(prefs)

def get_preference(key, default=None):
    """Get a preference value by key, returning default if not found."""
    prefs = load_preferences()
    return prefs.get(key, default)

def clear_preferences():
    """Clear all user preferences by deleting the preferences file."""
    if os.path.exists(PREFS_FILE_PATH):
        try:
            os.remove(PREFS_FILE_PATH)
            return True
        except IOError:
            return False
    return True

def is_first_time_setup():
    """Check if this is the first time setup by checking if preferences exist."""
    return not os.path.exists(PREFS_FILE_PATH)

def display_first_time_welcome():
    """Display welcome message for first-time setup."""
    print(f"\n{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}           📝 First-Time Setup{C_RESET}")
    print(f"{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print()
    print(f"{C_CYAN}Welcome to TT Studio! We'll guide you through the initial setup.{C_RESET}")
    print()
    print(f"{C_GREEN}ℹ️  What to expect:{C_RESET}")
    print(f"  • Your responses will be saved for future runs")
    print(f"  • Subsequent runs will be much faster and non-interactive")
    print(f"  • You can reset your preferences anytime with {C_WHITE}--reconfigure{C_RESET}")
    print()
    print(f"{C_YELLOW}Note: You won't be asked these questions again unless you explicitly reset.{C_RESET}")
    print()
    print(f"Before getting started please note that by proceeding, you agree to our Terms: https://docs.tenstorrent.com/os-model-terms/")
    print()
    print(f"The TL;DR:")
    print()
    print(f"{C_GREEN}AS-IS:{C_RESET} These models are for demonstration; we don't guarantee their output.")
    print(f"{C_GREEN}Liability:{C_RESET} Tenstorrent isn't responsible for damages or AI-generated content.")
    print(f"{C_GREEN}Compliance:{C_RESET} You agree to follow the original creators' licenses.")
    print()

    # Terms acceptance confirmation
    while True:
        response = input(f"{C_CYAN}Do you agree to these terms? [y/N]: {C_RESET}").strip().lower()
        if response in ['n', 'no', '']:
            print(f"{C_RED}Terms not accepted. Exiting TT-Studio.{C_RESET}")
            sys.exit(0)
        elif response in ['y', 'yes']:
            print(f"{C_GREEN}Terms accepted. Continuing with setup...{C_RESET}")
            break
        else:
            print(f"{C_YELLOW}Please enter 'y' for yes or 'n' for no.{C_RESET}")

    print()
    print(f"{C_TT_PURPLE}{C_BOLD}====================================================={C_RESET}")
    print()

def ask_overwrite_preference(existing_vars, force_prompt=False):
    """
    Ask user if they want to overwrite existing environment variables.
    Returns True if user wants to overwrite, False otherwise.
    
    Args:
        existing_vars: Dictionary of existing environment variables
        force_prompt: If True, always prompt user even if preference exists
    """
    # Check for saved preference (unless forcing prompt)
    if not force_prompt:
        config_mode = get_preference("configuration_mode")
        if config_mode:
            if config_mode == "keep_existing":
                return False
            elif config_mode == "reconfigure_everything":
                return True
    
    # Filter out placeholder values to show only real configured values
    real_vars = {k: v for k, v in existing_vars.items() if not is_placeholder(v)}
    
    # Debug: Show what variables are being filtered
    placeholder_vars = {k: v for k, v in existing_vars.items() if is_placeholder(v)}
    if placeholder_vars:
        print(f"{C_YELLOW}📋 Found placeholder values that will be configured: {list(placeholder_vars.keys())}{C_RESET}")
    
    if not real_vars:
        print(f"{C_YELLOW}All existing variables appear to be placeholders. Will configure all values.{C_RESET}")
        return True
    
    print(f"\n{C_CYAN}{C_BOLD}🔍 Configuration Status Check{C_RESET}")
    print(f"{C_GREEN}✅ Found an existing TT Studio configuration with {len(real_vars)} configured variables:{C_RESET}")
    print()
    
    # Group variables by category for better display
    core_vars = ["TT_STUDIO_ROOT", "HOST_PERSISTENT_STORAGE_VOLUME", "INTERNAL_PERSISTENT_STORAGE_VOLUME", "BACKEND_API_HOSTNAME"]
    security_vars = ["JWT_SECRET", "DJANGO_SECRET_KEY", "HF_TOKEN", "TAVILY_API_KEY", "RAG_ADMIN_PASSWORD"]
    app_vars = ["VITE_APP_TITLE", "VITE_ENABLE_DEPLOYED", "VITE_ENABLE_RAG_ADMIN"]
    cloud_vars = [k for k in real_vars.keys() if k.startswith("CLOUD_")]
    
    def display_vars(category_name, var_list, emoji):
        category_vars = {k: v for k, v in real_vars.items() if k in var_list}
        if category_vars:
            print(f"{C_BOLD}{emoji} {category_name}:{C_RESET}")
            for var_name, var_value in category_vars.items():
                # Mask sensitive values only if they're not placeholders
                if any(sensitive in var_name.lower() for sensitive in ['secret', 'token', 'password', 'key']):
                    # Don't mask placeholder values - show them so users know they're placeholders
                    if is_placeholder(var_value):
                        display_value = f"[PLACEHOLDER: {var_value}]"
                    else:
                        display_value = "***configured***"
                else:
                    display_value = var_value[:50] + "..." if len(var_value) > 50 else var_value
                print(f"    • {var_name}: {C_CYAN}{display_value}{C_RESET}")
            print()
    
    display_vars("Core Configuration", core_vars, "📁")
    display_vars("Security Credentials", security_vars, "🔐")
    display_vars("Application Settings", app_vars, "⚙️")
    display_vars("Cloud Model APIs", cloud_vars, "☁️")
    
    # Add visual separator
    print("=" * 80)
    
    print(f"{C_YELLOW}{C_BOLD}What would you like to do?{C_RESET}")
    print()
    print(f"  {C_GREEN}{C_BOLD}1 - Keep Existing Configuration (Recommended){C_RESET}")
    print(f"    • Keep all current values as they are")
    print(f"    • Only configure any missing or placeholder values")
    print(f"    • Recommended for normal startup")
    print()
    print(f"  {C_ORANGE}{C_BOLD}2 - Reconfigure Everything{C_RESET}")
    print(f"    • Go through setup prompts for ALL variables")
    print(f"    • Replace existing values with new ones")
    print(f"    • Use this if you want to change your configuration")
    print()
    
    # Add another visual separator before input
    print("=" * 80)
    
    while True:
        print(f"{C_WHITE}{C_BOLD}Choose an option:{C_RESET}")
        print(f"  {C_GREEN}1{C_RESET} - Keep existing configuration (recommended)")
        print(f"  {C_ORANGE}2{C_RESET} - Reconfigure everything")
        print()
        try:
            choice = input(f"Enter your choice (1/2): ").strip()
        except KeyboardInterrupt:
            print(f"\n\n{C_YELLOW}🛑 Setup interrupted by user (Ctrl+C){C_RESET}")
            
            # Build the original command with flags for resume suggestion
            original_cmd = "python run.py"
            if 'args' in locals():
                if args.dev:
                    original_cmd += " --dev"
                if args.skip_fastapi:
                    original_cmd += " --skip-fastapi"
                if args.no_sudo:
                    original_cmd += " --no-sudo"
                if args.resync:
                    original_cmd += " --resync"
            
            print(f"{C_CYAN}🔄 To resume setup later, run: {C_WHITE}{original_cmd}{C_RESET}")
            print(f"{C_CYAN}🧹 To clean up any partial setup: {C_WHITE}python run.py --cleanup{C_RESET}")
            print(f"{C_CYAN}❓ For help: {C_WHITE}python run.py --help or alternatively: python3 run.py --help{C_RESET}")
            sys.exit(0)
        
        if choice == "1":
            print(f"\n{C_GREEN}✅ Keeping existing configuration. Only missing values will be configured.{C_RESET}")
            # Show which placeholder values will still need to be configured
            placeholder_vars = {k: v for k, v in existing_vars.items() if is_placeholder(v)}
            if placeholder_vars:
                print(f"{C_CYAN}📝 Note: Placeholder values will still be prompted for configuration:{C_RESET}")
                for var_name in placeholder_vars.keys():
                    print(f"    • {var_name}")
                print()
            save_preference("configuration_mode", "keep_existing")
            return False
        elif choice == "2":
            print(f"\n{C_ORANGE}🔄 Will reconfigure all environment variables.{C_RESET}")
            save_preference("configuration_mode", "reconfigure_everything")
            return True
        else:
            print(f"{C_RED}❌ Please enter 1 to keep existing config or 2 to reconfigure everything.{C_RESET}")
            print()

def _hf_check_repo(token, repo_id):
    """Return HTTP status code for a HuggingFace repo config.json. Returns None on network error."""
    url = f"https://huggingface.co/{repo_id}/resolve/main/config.json"
    headers = {"User-Agent": "tt-studio"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        if HAS_REQUESTS:
            return requests.get(url, headers=headers, timeout=10, allow_redirects=True).status_code
        else:
            req = urllib.request.Request(url, headers=headers)
            try:
                urllib.request.urlopen(req, timeout=10)
                return 200
            except urllib.error.HTTPError as e:
                return e.code
    except Exception:
        return None


def check_hf_access(token):
    """Check if HF token can access meta-llama and Qwen repos. Returns (ok, message)."""
    repos = [
        ("meta-llama/Llama-3.1-8B-Instruct", "Llama 3.1"),
        ("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3"),
        ("Qwen/Qwen3-32B", "Qwen3-32B"),
    ]
    results = []
    for repo_id, label in repos:
        code = _hf_check_repo(token, repo_id)
        results.append((label, repo_id, code))

    if all(c is None for _, _, c in results):
        return (None, "⚠️  Could not reach HuggingFace — skipping access check.")

    lines = []
    any_ok = False
    any_denied = False
    invalid = False
    for label, repo_id, code in results:
        if code is None:
            lines.append(f"   ⚠️  {label}: could not reach HuggingFace")
        elif code == 200:
            lines.append(f"   ✅ {label}: access confirmed")
            any_ok = True
        elif code == 401:
            lines.append(f"   ✖  {label}: token invalid or expired (401)")
            invalid = True
        elif code == 403:
            lines.append(f"   ✖  {label}: access not granted yet (403) — https://huggingface.co/{repo_id}")
            any_denied = True
        else:
            lines.append(f"   ⚠️  {label}: unexpected HTTP {code}")

    summary = "\n".join(lines)
    if invalid:
        return (False, f"HF token access check:\n{summary}")
    elif any_denied:
        return (False, f"HF token access check:\n{summary}")
    elif any_ok:
        return (True, f"HF token access check:\n{summary}")
    else:
        return (None, f"HF token access check:\n{summary}")


def configure_environment_sequentially(dev_mode=False, force_reconfigure=False, easy_mode=True, reconfigure_inference=False):
    """
    Handles all environment configuration in a sequential, top-to-bottom flow.
    Reads existing .env file and prompts for missing or placeholder values.

    Args:
        dev_mode (bool): If True, show dev mode banner but still prompt for all values
        force_reconfigure (bool): If True, force reconfiguration and clear preferences
        easy_mode (bool): If True, use minimal prompts and defaults for quick setup
        reconfigure_inference (bool): If True, force reconfiguration of inference server artifact only
    """
    global FORCE_OVERWRITE
    
    # Show first-time welcome if this is the first time
    if is_first_time_setup():
        display_first_time_welcome()
    
    # Clear preferences if reconfiguring
    if force_reconfigure:
        clear_preferences()
    
    env_file_exists = os.path.exists(ENV_FILE_PATH)
    
    if not env_file_exists:
        if os.path.exists(ENV_FILE_DEFAULT):
            print(f"{C_BLUE}📄 No .env file found. Creating one from the default template...{C_RESET}")
            shutil.copy(ENV_FILE_DEFAULT, ENV_FILE_PATH)
        else:
            print(f"{C_YELLOW}⚠️  Warning: .env.default not found. Creating an empty .env file.{C_RESET}")
            open(ENV_FILE_PATH, 'w').close()
        # When no .env file exists, we should configure everything without asking
        FORCE_OVERWRITE = True

    if not easy_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}TT Studio Environment Configuration{C_RESET}")
        print(f"{C_GREEN}⚙️  Configure Env Mode: Full interactive setup for all variables{C_RESET}")
        if dev_mode:
            print(f"{C_YELLOW}   Development Mode: suggested defaults shown (NOT secure for production){C_RESET}")
        else:
            print(f"{C_CYAN}   Production Mode: prompting for secure, production-ready values{C_RESET}")
    
    # Get existing variables
    existing_vars = get_existing_env_vars()
    
    # Only ask about overwrite preference if .env file existed before (skip for easy mode)
    if not easy_mode and env_file_exists and existing_vars:
        FORCE_OVERWRITE = ask_overwrite_preference(existing_vars, force_prompt=force_reconfigure)
    else:
        # No need to ask, we're configuring everything
        if not env_file_exists:
            if not easy_mode:
                print(f"\n{C_CYAN}📝 Setting up TT Studio for the first time...{C_RESET}")
            FORCE_OVERWRITE = True
        elif easy_mode:
            # In easy mode with existing .env, don't force overwrite - let individual checks handle it
            if env_file_exists and existing_vars:
                FORCE_OVERWRITE = False
            else:
                FORCE_OVERWRITE = True
        else:
            print(f"\n{C_CYAN}📝 No existing configuration found. Will configure all environment variables.{C_RESET}")
            FORCE_OVERWRITE = True

    if not easy_mode:
        print(f"\n{C_CYAN}📁 Setting core application paths...{C_RESET}")
    write_env_var("TT_STUDIO_ROOT", TT_STUDIO_ROOT, quote_value=False)
    write_env_var("HOST_PERSISTENT_STORAGE_VOLUME", os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume"), quote_value=False)
    write_env_var("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume", quote_value=False)
    write_env_var("BACKEND_API_HOSTNAME", "tt-studio-backend-api")

    if not easy_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- 🔑  Security Credentials  ---{C_RESET}")

    # JWT_SECRET
    current_jwt = get_env_var("JWT_SECRET")
    if easy_mode:
        if should_configure_var("JWT_SECRET", current_jwt):
            write_env_var("JWT_SECRET", "test-secret-456", quote_value=False)
    elif should_configure_var("JWT_SECRET", current_jwt):
        if is_placeholder(current_jwt):
            print(f"🔄 JWT_SECRET has placeholder value '{current_jwt}' - configuring...")
        dev_default = "dev-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter JWT_SECRET (for authentication to model endpoints){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
        
        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("JWT_SECRET", val.strip().strip('"\''), quote_value=False)
                print("✅ JWT_SECRET saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        if not easy_mode:
            print(f"✅ JWT_SECRET already configured (keeping existing value).")

    # DJANGO_SECRET_KEY
    current_django = get_env_var("DJANGO_SECRET_KEY")
    if easy_mode:
        if should_configure_var("DJANGO_SECRET_KEY", current_django):
            write_env_var("DJANGO_SECRET_KEY", "django-insecure-default", quote_value=False)
    elif should_configure_var("DJANGO_SECRET_KEY", current_django):
        if is_placeholder(current_django):
            print(f"🔄 DJANGO_SECRET_KEY has placeholder value '{current_django}' - configuring...")
        dev_default = "django-dev-secret-key-not-for-production-12345" if dev_mode else ""
        prompt_text = f"🔑 Enter DJANGO_SECRET_KEY (for Django backend security){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
        
        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DJANGO_SECRET_KEY", val.strip().strip('"\''), quote_value=False)
                print("✅ DJANGO_SECRET_KEY saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        print(f"✅ DJANGO_SECRET_KEY already configured (keeping existing value).")

    # TTS_API_KEY
    current_tts_api_key = get_env_var("TTS_API_KEY")
    if easy_mode:
        if should_configure_var("TTS_API_KEY", current_tts_api_key):
            write_env_var("TTS_API_KEY", "your-secret-key")
    elif should_configure_var("TTS_API_KEY", current_tts_api_key):
        if is_placeholder(current_tts_api_key):
            print(f"🔄 TTS_API_KEY has placeholder value '{current_tts_api_key}' - configuring...")
        dev_default = "your-secret-key" if dev_mode else ""
        prompt_text = f"🔑 Enter TTS_API_KEY (for TTS inference server authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("TTS_API_KEY", val)
                print("✅ TTS_API_KEY saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        if not easy_mode:
            print(f"✅ TTS_API_KEY already configured (keeping existing value).")

    # DOCKER_CONTROL_SERVICE_URL
    current_docker_url = get_env_var("DOCKER_CONTROL_SERVICE_URL")
    if easy_mode:
        if should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
            write_env_var("DOCKER_CONTROL_SERVICE_URL", "http://host.docker.internal:8002")
    elif should_configure_var("DOCKER_CONTROL_SERVICE_URL", current_docker_url):
        if is_placeholder(current_docker_url):
            print(f"🔄 DOCKER_CONTROL_SERVICE_URL has placeholder value '{current_docker_url}' - configuring...")
        dev_default = "http://host.docker.internal:8002"
        prompt_text = f"🐳 Enter DOCKER_CONTROL_SERVICE_URL{' [default: ' + dev_default + ']' if dev_mode else ' (default: http://host.docker.internal:8002)'}: "
        val = input(prompt_text)
        if not val:
            val = dev_default
        write_env_var("DOCKER_CONTROL_SERVICE_URL", val)
        print("✅ DOCKER_CONTROL_SERVICE_URL saved.")
    else:
        if not easy_mode:
            print(f"✅ DOCKER_CONTROL_SERVICE_URL already configured (keeping existing value).")

    # DOCKER_CONTROL_JWT_SECRET
    current_docker_jwt = get_env_var("DOCKER_CONTROL_JWT_SECRET")
    if easy_mode:
        if should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
            write_env_var("DOCKER_CONTROL_JWT_SECRET", "test-secret-456", quote_value=False)
    elif should_configure_var("DOCKER_CONTROL_JWT_SECRET", current_docker_jwt):
        if is_placeholder(current_docker_jwt):
            print(f"🔄 DOCKER_CONTROL_JWT_SECRET has placeholder value '{current_docker_jwt}' - configuring...")
        dev_default = "dev-docker-jwt-secret-12345-not-for-production" if dev_mode else ""
        prompt_text = f"🔐 Enter DOCKER_CONTROL_JWT_SECRET (for Docker Control Service authentication){' [dev default: ' + dev_default + ']' if dev_mode else ''}: "

        while True:
            val = getpass.getpass(prompt_text)
            if not val and dev_mode:
                val = dev_default
            if val and val.strip():
                write_env_var("DOCKER_CONTROL_JWT_SECRET", val.strip().strip('"\''), quote_value=False)
                print("✅ DOCKER_CONTROL_JWT_SECRET saved.")
                break
            print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
    else:
        if not easy_mode:
            print(f"✅ DOCKER_CONTROL_JWT_SECRET already configured (keeping existing value).")

    # TAVILY_API_KEY (optional)
    current_tavily = get_env_var("TAVILY_API_KEY")
    if easy_mode:
        if should_configure_var("TAVILY_API_KEY", current_tavily):
            write_env_var("TAVILY_API_KEY", "tavily-api-key-not-configured", quote_value=False)
    elif should_configure_var("TAVILY_API_KEY", current_tavily):
        prompt_text = "🔍 Enter TAVILY_API_KEY for search agent (optional; press Enter to skip): "
        val = getpass.getpass(prompt_text)
        write_env_var("TAVILY_API_KEY", (val or "").strip().strip('"\''), quote_value=False)
        print("✅ TAVILY_API_KEY saved.")
    else:
        if not easy_mode:
            print(f"✅ TAVILY_API_KEY already configured (keeping existing value).")

    # HF_TOKEN
    current_hf = get_env_var("HF_TOKEN")
    needs_token = should_configure_var("HF_TOKEN", current_hf)

    if easy_mode and needs_token:
        print(f"\n{C_CYAN}A Hugging Face token is required to download models like Llama.{C_RESET}")
        print(f"{C_CYAN}Get yours at: https://huggingface.co/settings/tokens{C_RESET}\n")

    retrying = False
    while True:
        if needs_token:
            if retrying:
                prompt = "🤗 Enter a new HF_TOKEN (or press Enter to keep the current one and continue later): "
                val = getpass.getpass(prompt)
                if not val or not val.strip():
                    # Keep existing token, continue without access
                    print(f"{C_YELLOW}⚠️  Continuing with existing token. Re-run once you have access.{C_RESET}")
                    break
            else:
                prompt = "🤗 Enter HF_TOKEN: " if easy_mode else "🤗 Enter HF_TOKEN (Hugging Face token): "
                val = getpass.getpass(prompt)
                if not val or not val.strip():
                    print(f"{C_RED}⛔ This value cannot be empty.{C_RESET}")
                    continue
            val = val.strip().strip('"\'')
            write_env_var("HF_TOKEN", val, quote_value=False)
            print("✅ HF_TOKEN saved.")
        else:
            val = current_hf
            if not easy_mode:
                print(f"✅ HF_TOKEN already configured (keeping existing value).")

        ok, msg = check_hf_access(val)
        print(msg)
        if ok is False:
            print()
            print(f"   1. Enter a different token now")
            print(f"   2. Continue with this token once access is granted, then re-run: python run.py")
            while True:
                choice = input("Choose (1 or 2): ").strip()
                if choice in ("1", "2"):
                    break
                print(f"{C_RED}⛔ Enter 1 or 2.{C_RESET}")
            if choice == "1":
                needs_token = True
                retrying = True
                continue
            # choice == "2": continue with current token
        break

    if not easy_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- ⚙️  Application Configuration  ---{C_RESET}")

    # VITE_APP_TITLE
    current_title = get_env_var("VITE_APP_TITLE")
    if easy_mode:
        if should_configure_var("VITE_APP_TITLE", current_title):
            write_env_var("VITE_APP_TITLE", "Tenstorrent | TT Studio")
    elif should_configure_var("VITE_APP_TITLE", current_title):
        dev_default = "TT Studio (Dev)" if dev_mode else "TT Studio"
        val = input(f"📝 Enter application title (default: {dev_default}): ") or dev_default
        write_env_var("VITE_APP_TITLE", val)
        print("✅ VITE_APP_TITLE saved.")
    else:
        if not easy_mode:
            print(f"✅ VITE_APP_TITLE already configured: {current_title}")

    if not easy_mode:
        print(f"\n{C_CYAN}{C_BOLD}------------------ Mode Selection ------------------{C_RESET}")

    # VITE_ENABLE_DEPLOYED
    current_deployed = get_env_var("VITE_ENABLE_DEPLOYED")
    if easy_mode:
        if should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
            write_env_var("VITE_ENABLE_DEPLOYED", "false", quote_value=False)
    elif should_configure_var("VITE_ENABLE_DEPLOYED", current_deployed) or current_deployed not in ["true", "false"]:
        print("Enable AI Playground Mode? (Connects to external cloud models)")
        dev_default = "false" if dev_mode else "false"
        
        while True:
            val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
            if val in ["true", "false"]:
                write_env_var("VITE_ENABLE_DEPLOYED", val, quote_value=False)
                print("✅ VITE_ENABLE_DEPLOYED saved.")
                break
            print(f"{C_RED}⛔ Invalid input. Please enter 'true' or 'false'.{C_RESET}")
    else:
        if not easy_mode:
            print(f"✅ VITE_ENABLE_DEPLOYED already configured: {current_deployed}")

    is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))
    if not easy_mode:
        print(f"🔹 AI Playground Mode is {'ENABLED' if is_deployed_mode else 'DISABLED'}")

    # VITE_ENABLE_RAG_ADMIN
    current_rag = get_env_var("VITE_ENABLE_RAG_ADMIN")
    if easy_mode:
        if should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
            write_env_var("VITE_ENABLE_RAG_ADMIN", "false", quote_value=False)
    elif should_configure_var("VITE_ENABLE_RAG_ADMIN", current_rag) or current_rag not in ["true", "false"]:
        print("\nEnable RAG document management admin page?")
        dev_default = "false" if dev_mode else "false"
        
        while True:
            val = input(f"Enter 'true' or 'false' (default: {dev_default}): ").lower().strip() or dev_default
            if val in ["true", "false"]:
                write_env_var("VITE_ENABLE_RAG_ADMIN", val, quote_value=False)
                print("✅ VITE_ENABLE_RAG_ADMIN saved.")
                break
            print(f"{C_RED}⛔ Invalid input. Please enter 'true' or 'false'.{C_RESET}")
    else:
        if not easy_mode:
            print(f"✅ VITE_ENABLE_RAG_ADMIN already configured: {current_rag}")

    is_rag_admin_enabled = parse_boolean_env(get_env_var("VITE_ENABLE_RAG_ADMIN"))
    if not easy_mode:
        print(f"🔹 RAG Admin Page is {'ENABLED' if is_rag_admin_enabled else 'DISABLED'}")

    # RAG_ADMIN_PASSWORD (only if RAG is enabled, or set default in easy mode)
    current_rag_pass = get_env_var("RAG_ADMIN_PASSWORD")
    if easy_mode:
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            write_env_var("RAG_ADMIN_PASSWORD", "tt-studio-rag-admin-password", quote_value=False)
    elif is_rag_admin_enabled:
        if should_configure_var("RAG_ADMIN_PASSWORD", current_rag_pass):
            dev_default = "dev-admin-123" if dev_mode else ""
            prompt_text = f"Enter RAG_ADMIN_PASSWORD{' [dev default: ' + dev_default + ']' if dev_mode else ''}: "
            
            print("🔒 RAG admin is enabled. You must set a password.")
            while True:
                val = getpass.getpass(prompt_text)
                if not val and dev_mode:
                    val = dev_default
                if val and val.strip():
                    write_env_var("RAG_ADMIN_PASSWORD", val.strip().strip('"\''), quote_value=False)
                    print("✅ RAG_ADMIN_PASSWORD saved.")
                    break
                print(f"{C_RED}⛔ Password cannot be empty.{C_RESET}")
        else:
            print(f"✅ RAG_ADMIN_PASSWORD already configured (keeping existing value).")

    # Cloud/External model configuration
    cloud_vars = [
        ("CLOUD_CHAT_UI_URL", "🦙 Llama Chat UI URL", False),
        ("CLOUD_CHAT_UI_AUTH_TOKEN", "🔑 Llama Chat UI Auth Token", True),
        ("CLOUD_YOLOV4_API_URL", "👁️  YOLOv4 API URL", False),
        ("CLOUD_YOLOV4_API_AUTH_TOKEN", "🔑 YOLOv4 API Auth Token", True),
        ("CLOUD_SPEECH_RECOGNITION_URL", "🎤 Whisper Speech Recognition URL", False),
        ("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN", "🔑 Whisper Speech Recognition Auth Token", True),
        ("CLOUD_STABLE_DIFFUSION_URL", "🎨 Stable Diffusion URL", False),
        ("CLOUD_STABLE_DIFFUSION_AUTH_TOKEN", "🔑 Stable Diffusion Auth Token", True),
    ]
    
    if easy_mode:
        for var_name, _, _ in cloud_vars:
            current_val = get_env_var(var_name)
            if should_configure_var(var_name, current_val):
                write_env_var(var_name, "")
    elif is_deployed_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- ☁️  AI Playground Model Configuration  ---{C_RESET}")
        print(f"{C_YELLOW}Note: These are optional. Press Enter to skip any field.{C_RESET}")
        
        for var_name, prompt, is_secret in cloud_vars:
            current_val = get_env_var(var_name)
            if should_configure_var(var_name, current_val):
                if is_secret:
                    val = getpass.getpass(f"{prompt} (optional): ")
                else:
                    val = input(f"{prompt} (optional): ")
                write_env_var(var_name, val or "")
                status = "saved" if val else "skipped (empty)"
                print(f"✅ {var_name} {status}.")
            else:
                print(f"✅ {var_name} already configured (keeping existing value).")
    else:
        if not easy_mode:
            print(f"\n{C_YELLOW}Skipping cloud model configuration (AI Playground mode is disabled).{C_RESET}")

    # Frontend configuration (always set in easy mode, optional otherwise)
    if easy_mode:
        current_frontend_host = get_env_var("FRONTEND_HOST")
        current_frontend_port = get_env_var("FRONTEND_PORT")
        current_frontend_timeout = get_env_var("FRONTEND_TIMEOUT")

        if should_configure_var("FRONTEND_HOST", current_frontend_host):
            write_env_var("FRONTEND_HOST", "localhost")
        if should_configure_var("FRONTEND_PORT", current_frontend_port):
            write_env_var("FRONTEND_PORT", "3000", quote_value=False)
        if should_configure_var("FRONTEND_TIMEOUT", current_frontend_timeout):
            write_env_var("FRONTEND_TIMEOUT", "60", quote_value=False)

    # TT Inference Server Artifact Configuration
    if not easy_mode:
        print(f"\n{C_TT_PURPLE}{C_BOLD}--- 🔧 TT Inference Server Configuration  ---{C_RESET}")
    configure_inference_server_artifact(dev_mode, easy_mode, force_reconfigure, reconfigure_inference)

    print(f"\n{C_GREEN}✅ Environment configuration complete.{C_RESET}")

def display_welcome_banner():
    """Display welcome banner"""
    # Clear screen for a clean splash screen effect
    os.system('cls' if OS_NAME == 'Windows' else 'clear')
    
    # Simple, clean banner without complex Unicode characters
    print(f"{C_TT_PURPLE}{C_BOLD}")
    print("=" * 68)
    print("                   Welcome to TT Studio")
    print("=" * 68)
    print(f"{C_RESET}")
    
    # Tenstorrent ASCII Art
    print(f"{C_TT_PURPLE}{C_BOLD}")
    print(TENSTORRENT_ASCII_ART)
    print(f"{C_RESET}")
    print()
    
    # TT Studio ASCII Art
    print(f"{C_TT_PURPLE}{C_BOLD}")
    print("████████╗████████╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ ")
    print("╚══██╔══╝╚══██╔══╝    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗")
    print("   ██║      ██║       ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║")
    print("   ██║      ██║       ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║")
    print("   ██║      ██║       ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝")
    print("   ╚═╝      ╚═╝       ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ")
    print(f"{C_RESET}")
    
    # Subtitle
    print(f"{C_CYAN}AI Model Development & Deployment Made Easy{C_RESET}")
    print()
        
    # Bottom line
    print(f"{C_TT_PURPLE}{'=' * 68}{C_RESET}")
    print()

def cleanup_resources(args):
    """Clean up Docker resources"""
    print(f"\n{C_BOLD}🧹 Cleaning up TT Studio...{C_RESET}")

    has_docker_access = check_docker_access()

    # Stop and remove containers
    docker_compose_cmd = build_docker_compose_command(dev_mode=args.dev, show_hardware_info=False)
    docker_compose_cmd.extend(["down", "-v"])
    try:
        sys.stdout.write(f"  Stopping containers...     ")
        sys.stdout.flush()
        run_docker_command(docker_compose_cmd, use_sudo=not has_docker_access, capture_output=True)
        print(f"{C_GREEN}done{C_RESET}")
    except Exception:
        print(f"{C_YELLOW}skipped{C_RESET}")

    # Remove network
    try:
        sys.stdout.write(f"  Removing network...        ")
        sys.stdout.flush()
        run_docker_command(["docker", "network", "rm", "tt_studio_network"],
                            use_sudo=not has_docker_access, capture_output=True)
        print(f"{C_GREEN}done{C_RESET}")
    except Exception:
        print(f"{C_YELLOW}skipped{C_RESET}")

    # Clean up FastAPI server
    sys.stdout.write(f"  Stopping FastAPI server... ")
    sys.stdout.flush()
    cleanup_fastapi_server(no_sudo=args.no_sudo)
    print(f"{C_GREEN}done{C_RESET}")

    # Clean up Docker Control Service
    sys.stdout.write(f"  Stopping Docker Control... ")
    sys.stdout.flush()
    cleanup_docker_control_service(no_sudo=args.no_sudo)
    print(f"{C_GREEN}done{C_RESET}")

    if args.cleanup_all:
        print(f"\n{C_ORANGE}{C_BOLD}🗑️  Performing complete cleanup (--cleanup-all)...{C_RESET}")
        
        # Remove persistent volume
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        if os.path.exists(host_persistent_volume):
            try:
                confirm = input(f"{C_YELLOW}📁 Remove persistent storage at {host_persistent_volume}? (y/N): {C_RESET}")
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}🛑 Cleanup interrupted. Persistent storage kept.{C_RESET}")
                print(f"{C_GREEN}✅ Basic cleanup completed successfully.{C_RESET}")
                return
            
            if confirm.lower() in ['y', 'yes']:
                shutil.rmtree(host_persistent_volume)
                print(f"{C_GREEN}✅ Removed persistent storage.{C_RESET}")
            else:
                print(f"{C_CYAN}📁 Keeping persistent storage.{C_RESET}")
        
        # Remove .env file
        if os.path.exists(ENV_FILE_PATH):
            try:
                confirm = input(f"{C_YELLOW}⚙️  Remove .env configuration file? (y/N): {C_RESET}")
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}🛑 Cleanup interrupted. Configuration file kept.{C_RESET}")
                print(f"{C_GREEN}✅ Partial cleanup completed.{C_RESET}")
                return
            
            if confirm.lower() in ['y', 'yes']:
                os.remove(ENV_FILE_PATH)
                print(f"{C_GREEN}✅ Removed .env file.{C_RESET}")
            else:
                print(f"{C_CYAN}⚙️  Keeping .env file.{C_RESET}")
        
        # Remove artifact directory if it exists
        if os.path.exists(INFERENCE_ARTIFACT_DIR):
            try:
                confirm = input(f"{C_YELLOW}🔧 Remove TT Inference Server artifact directory at {INFERENCE_ARTIFACT_DIR}? (y/N): {C_RESET}")
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}🛑 Cleanup interrupted. Artifact directory kept.{C_RESET}")
                print(f"{C_GREEN}✅ Partial cleanup completed.{C_RESET}")
                return
            
            if confirm.lower() in ['y', 'yes']:
                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                print(f"{C_GREEN}✅ Removed artifact directory.{C_RESET}")
            else:
                print(f"{C_CYAN}🔧 Keeping artifact directory.{C_RESET}")
    
    print(f"\n{C_GREEN}{C_BOLD}✅ Cleanup complete! 🎉{C_RESET}")

def detect_tt_hardware():
    """Detect if Tenstorrent hardware is available."""
    return os.path.exists("/dev/tenstorrent") or os.path.isdir("/dev/tenstorrent")

def build_docker_compose_command(dev_mode=False, show_hardware_info=True, quiet=False):
    """
    Build the Docker Compose command with appropriate override files.

    Args:
        dev_mode (bool): Whether to enable development mode
        show_hardware_info (bool): Whether to show hardware detection messages
        quiet (bool): If True, suppress all output (for startup where output is transient)

    Returns:
        list: Docker Compose command with appropriate files
    """
    compose_files = ["docker", "compose", "-f", DOCKER_COMPOSE_FILE]

    if dev_mode:
        if os.path.exists(DOCKER_COMPOSE_DEV_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_DEV_FILE])
            if not quiet:
                print(f"{C_MAGENTA}🚀 Applying development mode overrides...{C_RESET}")
    else:
        if os.path.exists(DOCKER_COMPOSE_PROD_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_PROD_FILE])
            if not quiet:
                print(f"{C_GREEN}🚀 Applying production mode overrides...{C_RESET}")

    if detect_tt_hardware():
        if os.path.exists(DOCKER_COMPOSE_TT_HARDWARE_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_TT_HARDWARE_FILE])
            if show_hardware_info and not quiet:
                print(f"{C_GREEN}✅ Tenstorrent hardware detected - enabling hardware support{C_RESET}")
        else:
            if show_hardware_info and not quiet:
                print(f"{C_YELLOW}⚠️  TT hardware detected but override file not found: {DOCKER_COMPOSE_TT_HARDWARE_FILE}{C_RESET}")
    else:
        if show_hardware_info and not quiet:
            print(f"{C_YELLOW}⚠️  No Tenstorrent hardware detected{C_RESET}")

    return compose_files

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

def configure_inference_server_artifact(dev_mode=False, easy_mode=False, force_reconfigure=False, reconfigure_inference=False):
    """
    Configure TT Inference Server artifact source (release version or branch).

    Args:
        dev_mode: Development mode flag
        easy_mode: Easy mode flag
        force_reconfigure: Force reconfiguration of all options
        reconfigure_inference: Force reconfiguration of inference server artifact only
    """
    current_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION")
    current_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH")

    # In easy mode with no reconfigure request: silently default to 'latest' if not already set
    if easy_mode and not (force_reconfigure or reconfigure_inference):
        if not (current_version or current_branch):
            write_env_var("TT_INFERENCE_ARTIFACT_VERSION", "latest", quote_value=False)
        return

    # If configuration exists and user didn't request reconfiguration, use it silently
    if (current_version or current_branch) and not (force_reconfigure or reconfigure_inference):
        source_type = "release" if current_version else "branch"
        value = current_version or current_branch
        print(f"\n{C_CYAN}Using existing TT Inference Server configuration: {source_type} '{value}'{C_RESET}")
        print(f"{C_YELLOW}   (Use --reconfigure-inference-server to change){C_RESET}")
        return

    # If reconfiguring, show current config and ask if they want to change
    if (current_version or current_branch) and (force_reconfigure or reconfigure_inference):
        source_type = "release" if current_version else "branch"
        value = current_version or current_branch
        print(f"\n{C_CYAN}Current TT Inference Server configuration: {source_type} '{value}'{C_RESET}")

        # Ask if user wants to change
        while True:
            change_choice = input(f"{C_CYAN}Would you like to change this? (y/n) [default: n]: {C_RESET}").strip().lower() or "n"
            if change_choice in ["y", "yes", "n", "no"]:
                break
            print(f"{C_RED}⛔ Invalid input. Please enter 'y' or 'n'.{C_RESET}")

        if change_choice in ["n", "no"]:
            print(f"✅ Keeping existing configuration: {source_type} '{value}'")
            return
    
    # Ask user for artifact source type
    print(f"\n{C_CYAN}Choose TT Inference Server artifact source:{C_RESET}")
    print(f"  1. Release version (stable, recommended for production)")
    print(f"  2. Branch (latest development code, may have new features)")
    
    if easy_mode:
        # In easy mode, default to latest release but still allow choice
        while True:
            choice = input(f"{C_CYAN}Enter choice (1 or 2) [default: 1]: {C_RESET}").strip() or "1"
            if choice in ["1", "2"]:
                break
            print(f"{C_RED}⛔ Invalid choice. Please enter 1 or 2.{C_RESET}")
    else:
        while True:
            choice = input(f"{C_CYAN}Enter choice (1 or 2) [default: 1]: {C_RESET}").strip() or "1"
            if choice in ["1", "2"]:
                break
            print(f"{C_RED}⛔ Invalid choice. Please enter 1 or 2.{C_RESET}")
    
    if choice == "1":
        # Release version
        if current_branch:
            # Clear branch if switching to release
            write_env_var("TT_INFERENCE_ARTIFACT_BRANCH", "", quote_value=False)

        # Always prompt for version when user chooses option 1
        default_version = "latest"
        if current_version and current_version != "latest":
            default_version = current_version

        prompt_text = f"📦 Enter release version (e.g., 'v0.8.0') or 'latest' [default: {default_version}]: "
        semver_pattern = r"^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"
        while True:
            val = input(prompt_text).strip() or default_version
            if val == "latest" or re.match(semver_pattern, val):
                break

            # Common typo: "v.10.0" or "v.0.10.0" should be "v0.10.0"
            suggested = ""
            if re.match(r"^v\.", val):
                suggested = "v0" + val[1:]

            print(f"{C_RED}⛔ Invalid release version '{val}'.{C_RESET}")
            print(f"   Expected format: vMAJOR.MINOR.PATCH (example: v0.10.0) or 'latest'")
            if suggested:
                print(f"   Did you mean: {suggested}")
        write_env_var("TT_INFERENCE_ARTIFACT_VERSION", val, quote_value=False)
        print(f"✅ TT_INFERENCE_ARTIFACT_VERSION set to '{val}'")

        # If version changed (or switching from branch to version), force re-download
        if current_branch or (current_version != val):
            artifacts_dir = os.path.join(TT_STUDIO_ROOT, ".artifacts")
            if os.path.exists(artifacts_dir):
                try:
                    print(f"{C_CYAN}🗑️  Removing existing artifacts directory...{C_RESET}")
                    shutil.rmtree(artifacts_dir)
                    print(f"{C_GREEN}✅ Removed .artifacts directory{C_RESET}")
                except Exception as e:
                    print(f"{C_YELLOW}⚠️  Could not remove .artifacts directory: {e}{C_RESET}")
                    # Try using sudo to remove the directory
                    print(f"{C_CYAN}   Attempting to remove with sudo...{C_RESET}")
                    if not remove_artifact_with_sudo(artifacts_dir, ".artifacts directory"):
                        print(f"{C_YELLOW}⚠️  Could not remove with sudo either. Will attempt to continue anyway...{C_RESET}")
                print(f"{C_CYAN}📝 Configuration changed - will re-download artifact{C_RESET}")
    else:
        # Branch
        if current_version:
            # Clear version if switching to branch
            write_env_var("TT_INFERENCE_ARTIFACT_VERSION", "", quote_value=False)

        # Always prompt for branch when user chooses option 2
        default_branch = "main"
        if current_branch:
            default_branch = current_branch

        prompt_text = f"🌿 Enter branch name (e.g., 'main', 'dev', 'feature/xyz') [default: {default_branch}]: "
        val = input(prompt_text).strip() or default_branch
        write_env_var("TT_INFERENCE_ARTIFACT_BRANCH", val, quote_value=False)
        print(f"✅ TT_INFERENCE_ARTIFACT_BRANCH set to '{val}'")

        # If branch changed (or switching from version to branch), force re-download
        if current_version or (current_branch != val):
            artifacts_dir = os.path.join(TT_STUDIO_ROOT, ".artifacts")
            if os.path.exists(artifacts_dir):
                try:
                    print(f"{C_CYAN}🗑️  Removing existing artifacts directory...{C_RESET}")
                    shutil.rmtree(artifacts_dir)
                    print(f"{C_GREEN}✅ Removed .artifacts directory{C_RESET}")
                except Exception as e:
                    print(f"{C_YELLOW}⚠️  Could not remove .artifacts directory: {e}{C_RESET}")
                    # Try using sudo to remove the directory
                    print(f"{C_CYAN}   Attempting to remove with sudo...{C_RESET}")
                    if not remove_artifact_with_sudo(artifacts_dir, ".artifacts directory"):
                        print(f"{C_YELLOW}⚠️  Could not remove with sudo either. Will attempt to continue anyway...{C_RESET}")
                print(f"{C_CYAN}📝 Configuration changed - will re-download artifact{C_RESET}")

def _set_artifact_environment_variables(artifact_dir):
    """Set environment variables for artifact directory."""
    os.environ["TT_INFERENCE_ARTIFACT_PATH"] = artifact_dir
    # Set OVERRIDE_BENCHMARK_TARGETS to point to the file in the artifact directory
    benchmark_file = os.path.join(artifact_dir, "benchmarking", "benchmark_targets", "model_performance_reference.json")
    if os.path.exists(benchmark_file):
        os.environ["OVERRIDE_BENCHMARK_TARGETS"] = benchmark_file

def fetch_branch_commit_sha(branch):
    """Fetch the latest commit SHA for a branch from the GitHub API (unauthenticated)."""
    import json
    url = f"https://api.github.com/repos/tenstorrent/tt-inference-server/git/refs/heads/{branch}"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
            if isinstance(data, list):
                return data[0]["object"]["sha"] if data else None
            return data["object"]["sha"]
    except Exception:
        return None


def _write_artifact_info(artifacts_dir, artifact_type, artifact_value, validation_passed=True, sudo_used=False, commit_sha=None):
    """
    Write artifact metadata file outside the inference-server directory.

    Args:
        artifacts_dir: Directory containing artifacts
        artifact_type: "branch" or "version"
        artifact_value: Branch name or version number
        validation_passed: Whether artifact validation succeeded
        sudo_used: Whether sudo was needed during download/cleanup
        commit_sha: Git commit SHA at download time (branches only)
    """
    info_file = os.path.join(artifacts_dir, "artifact-info.txt")
    try:
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with open(info_file, 'w') as f:
            # Write user-friendly header with clear current configuration
            f.write("=" * 80 + "\n")
            f.write("  TT INFERENCE SERVER - ARTIFACT INFORMATION\n")
            f.write("=" * 80 + "\n\n")

            # Highlight the current configuration prominently
            f.write(f"  📌 CURRENT CONFIGURATION:\n")
            if artifact_type == "branch":
                f.write(f"     ✓ BRANCH      : {artifact_value} (ACTIVE)\n")
                f.write(f"     ✗ VERSION     : Not configured (using branch instead)\n")
            else:
                f.write(f"     ✗ BRANCH      : Not configured (using version instead)\n")
                f.write(f"     ✓ VERSION     : {artifact_value} (ACTIVE)\n")

            f.write(f"\n     Last updated: {timestamp}\n")
            f.write("\n" + "-" * 80 + "\n\n")

            # Instructions for changing
            f.write("  💡 To switch to a different artifact:\n")
            f.write("     • Run: python run.py --reconfigure-inference-server\n")
            f.write("     • Or manually edit: app/.env (TT_INFERENCE_ARTIFACT_BRANCH/VERSION)\n")
            f.write("\n" + "-" * 80 + "\n\n")

            # Technical details section
            f.write("  🔍 Technical Details:\n")
            f.write(f"     Artifact Type     : {artifact_type}\n")
            f.write(f"     Artifact Value    : {artifact_value}\n")
            if commit_sha:
                f.write(f"     Commit SHA        : {commit_sha}\n")
            f.write(f"     Download Time     : {timestamp}\n")
            f.write(f"     Validation Status : {'✓ PASSED' if validation_passed else '✗ FAILED'}\n")
            f.write(f"     Validation Checks : workflows_dir, workflows/utils.py, VERSION\n")
            f.write(f"     Sudo Used         : {'Yes' if sudo_used else 'No'}\n")
            # Machine-readable marker lines used by cache invalidation detection
            f.write(f"     artifact_type={artifact_type}\n")
            f.write(f"     artifact_value={artifact_value}\n")
            if commit_sha:
                f.write(f"     commit_sha={commit_sha}\n")
            f.write("\n" + "=" * 80 + "\n")

        print(f"📝 Artifact info written to {info_file}")
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Could not write artifact info file: {e}{C_RESET}")


def get_inference_server_version():
    """Get the version of TT Inference Server from the artifact directory."""
    version_file = os.path.join(INFERENCE_ARTIFACT_DIR, "VERSION")
    if os.path.exists(version_file):
        try:
            with open(version_file, 'r') as f:
                version = f.read().strip()
                return version
        except Exception:
            pass
    
    # Fallback: try to get from environment variable
    # Check for branch first (branches don't have VERSION files typically)
    env_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH") or os.getenv("TT_INFERENCE_ARTIFACT_BRANCH")
    if env_branch:
        return None  # Branches don't have version numbers
    
    env_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION") or os.getenv("TT_INFERENCE_ARTIFACT_VERSION")
    if env_version and env_version != "latest":
        return env_version
    
    return None


def validate_artifact_structure(artifact_dir):
    """
    Validate that the downloaded artifact has the required structure.

    Args:
        artifact_dir (str): Path to the artifact directory to validate

    Returns:
        bool: True if valid, False otherwise
    """
    if not os.path.exists(artifact_dir):
        print(f"{C_RED}⛔ Validation failed: Artifact directory does not exist: {artifact_dir}{C_RESET}")
        return False

    # Check for required workflows directory and utils.py
    workflows_dir = os.path.join(artifact_dir, "workflows")
    if not os.path.exists(workflows_dir):
        print(f"{C_RED}⛔ Validation failed: Missing 'workflows' directory in {artifact_dir}{C_RESET}")
        return False

    workflows_utils = os.path.join(workflows_dir, "utils.py")
    if not os.path.exists(workflows_utils):
        print(f"{C_RED}⛔ Validation failed: Missing 'workflows/utils.py' in {artifact_dir}{C_RESET}")
        print(f"   Directory contents: {os.listdir(artifact_dir)[:10]}...")
        return False

    # Basic check that it's not an empty file
    try:
        file_size = os.path.getsize(workflows_utils)
        if file_size == 0:
            print(f"{C_RED}⛔ Validation failed: workflows/utils.py is empty{C_RESET}")
            return False
    except Exception as e:
        print(f"{C_RED}⛔ Validation failed: Cannot read workflows/utils.py: {e}{C_RESET}")
        return False

    print(f"{C_GREEN}✅ Artifact structure validated successfully{C_RESET}")
    return True


def _sync_model_catalog():
    """
    Sync model catalog from the TT Inference Server artifact.
    Runs sync_models_from_inference_server.py to generate models_from_inference_server.json.
    """
    sync_script = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config",
        "sync_models_from_inference_server.py",
    )

    if not os.path.exists(sync_script):
        print(f"{C_YELLOW}⚠️  Model catalog sync script not found: {sync_script}{C_RESET}")
        return False

    try:
        env = os.environ.copy()
        if os.path.exists(INFERENCE_ARTIFACT_DIR):
            env["TT_INFERENCE_ARTIFACT_PATH"] = INFERENCE_ARTIFACT_DIR

        result = subprocess.run(
            [sys.executable, sync_script],
            capture_output=True, text=True, check=False, env=env,
        )

        if result.returncode == 0:
            print(f"{C_GREEN}✅ Model catalog synced successfully{C_RESET}")
            if result.stdout.strip():
                for line in result.stdout.strip().splitlines():
                    print(f"   {line}")
            return True
        else:
            print(f"{C_YELLOW}⚠️  Model catalog sync returned exit code {result.returncode}{C_RESET}")
            if result.stderr.strip():
                for line in result.stderr.strip().splitlines()[-5:]:
                    print(f"   {line}")
            return False
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Model catalog sync failed: {e}{C_RESET}")
        return False


def setup_tt_inference_server(pull_branch=False):
    """Set up TT Inference Server by downloading/extracting artifact from GitHub release or branch."""
    # Artifact setup — quiet unless downloading or encountering issues

    def suggest_semver(version):
        """Return a likely semantic-version correction for malformed tags."""
        if re.match(r'^v\.', version):
            return "v0" + version[1:]
        return ""

    # Read artifact source from .env file — use EITHER branch OR version, never both
    artifact_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH") or None
    artifact_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION") or None

    if artifact_branch and artifact_version:
        # Both are set — ask the user which to keep and comment out the other
        print(f"\n{C_YELLOW}⚠️  Both TT_INFERENCE_ARTIFACT_BRANCH and TT_INFERENCE_ARTIFACT_VERSION are set in .env:{C_RESET}")
        print(f"   1. Branch: '{artifact_branch}'")
        print(f"   2. Version: '{artifact_version}'")
        while True:
            choice = input(f"{C_CYAN}Which would you like to use? (1 or 2): {C_RESET}").strip()
            if choice in ("1", "2"):
                break
            print(f"{C_RED}⛔ Enter 1 or 2.{C_RESET}")
        if choice == "1":
            comment_out_env_var("TT_INFERENCE_ARTIFACT_VERSION")
            artifact_version = None
            print(f"{C_GREEN}✅ Using branch '{artifact_branch}' — commented out TT_INFERENCE_ARTIFACT_VERSION in .env{C_RESET}")
        else:
            comment_out_env_var("TT_INFERENCE_ARTIFACT_BRANCH")
            artifact_branch = None
            print(f"{C_GREEN}✅ Using version '{artifact_version}' — commented out TT_INFERENCE_ARTIFACT_BRANCH in .env{C_RESET}")
    elif not artifact_branch and not artifact_version:
        artifact_version = "latest"

    # Create artifacts directory early so we can check for local tarballs
    artifacts_dir = os.path.join(TT_STUDIO_ROOT, ".artifacts")
    os.makedirs(artifacts_dir, exist_ok=True)

    # Proactively request sudo authentication early (before any container builds)
    sudo_available = request_sudo_authentication()
    if not sudo_available:
        pass  # Non-fatal — will retry if needed

    # Track if sudo was used during cleanup (for artifact info file)
    sudo_used_for_cleanup = False

    # Check if artifact already exists and is fully downloaded
    # A complete download has: artifact-info.txt (written last on success), workflows/utils.py, and VERSION
    if os.path.exists(INFERENCE_ARTIFACT_DIR):
        info_file_check = os.path.join(artifacts_dir, "artifact-info.txt")
        workflows_utils = os.path.join(INFERENCE_ARTIFACT_DIR, "workflows", "utils.py")
        version_file = os.path.join(INFERENCE_ARTIFACT_DIR, "VERSION")

        missing = [p for p in [info_file_check, workflows_utils, version_file] if not os.path.exists(p)]
        if missing:
            print(f"{C_YELLOW}⚠️  Incomplete artifact detected (missing: {', '.join(os.path.basename(p) for p in missing)}) — re-downloading...{C_RESET}")
            try:
                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
            except Exception:
                pass

        if not missing:
            version = get_inference_server_version()
            version_str = f" (v{version})" if version else ""
            branch_str = f" (branch: {artifact_branch})" if artifact_branch else ""
            
            # If env requests a specific version/branch, verify it matches (if possible)
            version_mismatch = False
            branch_mismatch = False
            
            if artifact_branch:
                # For branches, check if we're switching from a version to a branch
                # Read artifact-info.txt to see what we currently have
                info_file = os.path.join(artifacts_dir, "artifact-info.txt")
                if os.path.exists(info_file):
                    try:
                        with open(info_file, 'r') as f:
                            info_content = f.read()
                            if 'artifact_type=version' in info_content:
                                branch_mismatch = True
                                print(f"{C_YELLOW}⚠️  Switching from version artifact to branch '{artifact_branch}'{C_RESET}")
                            elif 'artifact_type=branch' in info_content:
                                # Check if branch name matches
                                if f"artifact_value={artifact_branch}" not in info_content:
                                    branch_mismatch = True
                                    print(f"{C_YELLOW}⚠️  Branch mismatch: requested '{artifact_branch}' but artifact has different branch{C_RESET}")
                            else:
                                # Old-format or unrecognized artifact-info.txt — force re-download
                                branch_mismatch = True
                                print(f"{C_YELLOW}⚠️  Unrecognized artifact metadata format - re-downloading branch '{artifact_branch}'{C_RESET}")
                    except Exception:
                        pass
                else:
                    # artifact-info.txt is missing - force re-download
                    branch_mismatch = True
                    print(f"{C_YELLOW}⚠️  Artifact metadata missing - will re-download branch '{artifact_branch}'{C_RESET}")
                
                if not branch_mismatch:
                    if pull_branch:
                        # --pull-branch flag: force re-download to pick up new commits on the branch
                        branch_mismatch = True
                        print(f"🔄 --pull-branch: re-fetching latest '{artifact_branch}' from remote...")
                    else:
                        # Check GitHub for new commits via commit SHA comparison
                        stored_sha = None
                        try:
                            with open(info_file_check) as _f:
                                for _line in _f:
                                    if _line.startswith("     commit_sha="):
                                        stored_sha = _line.split("=", 1)[1].strip()
                        except Exception:
                            pass
                        current_sha = fetch_branch_commit_sha(artifact_branch)
                        if current_sha and stored_sha and current_sha != stored_sha:
                            print(f"{C_YELLOW}⚠️  Branch '{artifact_branch}' has new commits ({stored_sha[:7]} → {current_sha[:7]}){C_RESET}")
                            print(f"   Re-downloading latest...")
                            branch_mismatch = True
                        elif current_sha and stored_sha:
                            print(f"{C_GREEN}✅ TT Inference Server (branch: {artifact_branch}) up-to-date (commit: {current_sha[:7]}){C_RESET}")
                        elif current_sha and not stored_sha:
                            # Artifact was downloaded without recording a commit SHA — re-fetch
                            # so we can record the SHA for future freshness checks.
                            print(f"{C_YELLOW}⚠️  No stored commit SHA for '{artifact_branch}' — re-fetching to record current commit ({current_sha[:7]}){C_RESET}")
                            branch_mismatch = True
                        else:
                            # GitHub unreachable and no stored SHA — fall back gracefully
                            print(f"{C_GREEN}✅ TT Inference Server (branch: {artifact_branch}) (cached){C_RESET}")
            elif artifact_version and artifact_version != "latest" and version:
                req = artifact_version.lstrip("v").strip()
                cur = version.lstrip("v").strip()
                if req != cur:
                    version_mismatch = True
                    print(f"{C_YELLOW}⚠️  TT_INFERENCE_ARTIFACT_VERSION={artifact_version} but artifact has VERSION={version}{C_RESET}")
                else:
                    # Check if we're switching from a branch to a version
                    info_file = os.path.join(artifacts_dir, "artifact-info.txt")
                    if os.path.exists(info_file):
                        try:
                            with open(info_file, 'r') as f:
                                info_content = f.read()
                                if 'artifact_type=branch' in info_content:
                                    version_mismatch = True
                                    print(f"{C_YELLOW}⚠️  Switching from branch artifact to version '{artifact_version}'{C_RESET}")
                                elif 'artifact_type=version' not in info_content:
                                    # Old-format or unrecognized artifact-info.txt — force re-download
                                    version_mismatch = True
                                    print(f"{C_YELLOW}⚠️  Unrecognized artifact metadata format - re-downloading version '{artifact_version}'{C_RESET}")
                        except Exception:
                            pass
                    else:
                        # artifact-info.txt is missing - force re-download
                        version_mismatch = True
                        print(f"{C_YELLOW}⚠️  Artifact metadata missing - will re-download version '{artifact_version}'{C_RESET}")
            
            if version_mismatch or branch_mismatch:
                print(f"   Removing existing artifact and downloading {artifact_version or artifact_branch}...")

                # Proactively request sudo authentication since we may need it for cleanup
                print(f"{C_CYAN}   Requesting sudo authentication in case elevated permissions are needed for cleanup...{C_RESET}")
                sudo_available = request_sudo_authentication()
                if not sudo_available:
                    print(f"{C_YELLOW}   Note: sudo authentication failed or unavailable. Will attempt cleanup without it.{C_RESET}")

                try:
                    # Remove the entire .artifacts directory to ensure complete cleanup
                    # Use a more robust deletion method that handles permission errors
                    if os.path.exists(artifacts_dir):
                        def handle_remove_readonly(func, path, exc):
                            """Handle permission errors during deletion by making files writable."""
                            if func in (os.rmdir, os.remove, os.unlink) and exc[1].errno == 13:
                                # Permission denied - try to make file writable and retry
                                try:
                                    os.chmod(path, 0o777)
                                    if os.path.isdir(path):
                                        os.rmdir(path)
                                    else:
                                        os.remove(path)
                                except Exception:
                                    # If we still can't delete it, just skip it
                                    pass
                            else:
                                raise
                        
                        # Try to remove with error handling for permission issues
                        try:
                            shutil.rmtree(artifacts_dir, onerror=handle_remove_readonly)
                            print(f"✅ Removed entire .artifacts directory")
                        except PermissionError as pe:
                            # If there are still permission issues, try using sudo or just remove what we can
                            print(f"{C_YELLOW}⚠️  Some files could not be deleted due to permissions: {pe}{C_RESET}")
                            print(f"   Attempting to remove with elevated permissions...")
                            try:
                                # Try to change permissions recursively first
                                for root, dirs, files in os.walk(artifacts_dir):
                                    for d in dirs:
                                        os.chmod(os.path.join(root, d), 0o777)
                                    for f in files:
                                        os.chmod(os.path.join(root, f), 0o777)
                                # Now try to remove again
                                shutil.rmtree(artifacts_dir, onerror=handle_remove_readonly)
                                print(f"✅ Removed entire .artifacts directory after fixing permissions")
                            except Exception as e2:
                                print(f"{C_YELLOW}⚠️  Could not fully remove directory: {e2}{C_RESET}")
                                print(f"   Attempting to remove just the tt-inference-server subdirectory...")
                                # Fallback: try to remove just the inference server directory
                                if os.path.exists(INFERENCE_ARTIFACT_DIR):
                                    try:
                                        for root, dirs, files in os.walk(INFERENCE_ARTIFACT_DIR):
                                            for d in dirs:
                                                os.chmod(os.path.join(root, d), 0o777)
                                            for f in files:
                                                os.chmod(os.path.join(root, f), 0o777)
                                        shutil.rmtree(INFERENCE_ARTIFACT_DIR, onerror=handle_remove_readonly)
                                        print(f"✅ Removed tt-inference-server directory")
                                    except Exception as e3:
                                        print(f"{C_YELLOW}⚠️  Could not remove directory even after fixing permissions: {e3}{C_RESET}")
                                        print(f"{C_CYAN}   Attempting removal with sudo as final fallback...{C_RESET}")

                                        # Final fallback: try sudo removal
                                        if remove_artifact_with_sudo(INFERENCE_ARTIFACT_DIR, "tt-inference-server artifact"):
                                            print(f"{C_GREEN}✅ Successfully removed artifact directory using sudo{C_RESET}")
                                            sudo_used_for_cleanup = True
                                            # Continue with setup - don't return False
                                        else:
                                            print(f"{C_RED}⛔ Could not remove directory with sudo{C_RESET}")
                                            print(f"   Please manually remove {INFERENCE_ARTIFACT_DIR} and try again")
                                            return False
                    else:
                        # Fallback: just remove the artifact directory if .artifacts doesn't exist
                        if os.path.exists(INFERENCE_ARTIFACT_DIR):
                            shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                            print(f"✅ Removed artifact directory")
                    
                    # Recreate the artifacts directory for the new download
                    os.makedirs(artifacts_dir, exist_ok=True)
                    print(f"✅ Recreated .artifacts directory")
                    print(f"📥 Proceeding to download {artifact_version or artifact_branch}...")
                    # Continue to download logic below - don't return here
                except Exception as e:
                    print(f"{C_YELLOW}⚠️  Failed to remove artifact directory: {e}{C_RESET}")
                    print(f"{C_CYAN}   Attempting removal with sudo as final fallback...{C_RESET}")

                    # Final fallback: try sudo removal
                    if remove_artifact_with_sudo(artifacts_dir, "artifacts directory"):
                        print(f"{C_GREEN}✅ Successfully removed artifacts directory using sudo{C_RESET}")
                        sudo_used_for_cleanup = True
                        # Recreate the directory and continue
                        os.makedirs(artifacts_dir, exist_ok=True)
                        print(f"✅ Recreated .artifacts directory")
                        print(f"📥 Proceeding to download {artifact_version or artifact_branch}...")
                        # Continue to download logic - don't return here
                    else:
                        print(f"{C_RED}⛔ Could not remove directory with sudo{C_RESET}")
                        print(f"   Please manually remove {INFERENCE_ARTIFACT_DIR} and try again")
                        return False
            else:
                if not artifact_branch:
                    print(f"{C_GREEN}✅ TT Inference Server{version_str} (cached){C_RESET}")
                
                # If version matches or no version specified, use existing artifact
                _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                # Write artifact info if not already present
                info_file = os.path.join(artifacts_dir, "artifact-info.txt")
                if not os.path.exists(info_file):
                    if artifact_branch:
                        _sha = fetch_branch_commit_sha(artifact_branch)
                        _write_artifact_info(artifacts_dir, "branch", artifact_branch, sudo_used=sudo_used_for_cleanup, commit_sha=_sha)
                    elif artifact_version:
                        _write_artifact_info(artifacts_dir, "version", artifact_version, sudo_used=sudo_used_for_cleanup)
                return True
            # If version mismatch, fall through to download the correct version below
        else:
            # Directory exists but is invalid (missing workflows), remove it and re-download
            print(f"{C_YELLOW}⚠️  Artifact directory exists but is invalid (missing workflows/). Removing and re-downloading...{C_RESET}")
            try:
                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                print(f"✅ Removed invalid artifact directory")
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Could not remove invalid directory: {e}{C_RESET}")
                # Try using sudo to remove the directory
                print(f"{C_CYAN}   Attempting to remove with sudo...{C_RESET}")
                if remove_artifact_with_sudo(INFERENCE_ARTIFACT_DIR, "invalid artifact directory"):
                    print(f"✅ Successfully removed invalid artifact directory with sudo")
                    sudo_used_for_cleanup = True
                else:
                    print(f"{C_RED}⛔ Failed to remove invalid artifact directory even with sudo{C_RESET}")
                    print(f"   Please manually remove {INFERENCE_ARTIFACT_DIR} and try again")
                    return False

    # Priority: Branch > Version
    if artifact_branch:
        # Download from GitHub branch
        print(f"📥 Downloading TT Inference Server from GitHub branch: {artifact_branch}")
        
        # Sanitize branch name for filename (replace slashes with dashes)
        sanitized_branch = artifact_branch.replace("/", "-")
        
        artifact_file = os.path.join(artifacts_dir, f"tt-inference-server-{sanitized_branch}.tar.gz")
        
        # Use cached tarball only if artifact dir also exists (same snapshot).
        # If user deleted the extracted dir, re-download so we get current branch HEAD (overwrites old tarball).
        use_cached_tarball = (
            os.path.exists(artifact_file) and os.path.exists(INFERENCE_ARTIFACT_DIR)
        )
        if use_cached_tarball:
            print(f"📦 Using existing artifact tarball: {artifact_file}")
        else:
            if os.path.exists(artifact_file) and not os.path.exists(INFERENCE_ARTIFACT_DIR):
                print(f"📦 Artifact directory missing; re-downloading branch to get latest commit...")
            # Download (overwrites existing tarball if present; always gets current HEAD of branch)
            github_url = f"https://github.com/tenstorrent/tt-inference-server/archive/refs/heads/{artifact_branch}.tar.gz"
            try:
                import urllib.request
                print(f"   Downloading from: {github_url}")
                print(f"   This may take a few minutes...")
                urllib.request.urlretrieve(github_url, artifact_file)
            except Exception as e:
                error_str = str(e)
                if "404" in error_str or "Not Found" in error_str:
                    print(f"{C_RED}⛔ Branch '{artifact_branch}' not found on GitHub (HTTP 404).{C_RESET}")
                    print(f"   The branch name you configured does not exist.")
                    print(f"   You entered: TT_INFERENCE_ARTIFACT_BRANCH={artifact_branch}")
                    print(f"   Run: python run.py --reconfigure-inference-server")
                    print(f"   Valid branches: https://github.com/tenstorrent/tt-inference-server/branches")
                else:
                    print(f"{C_RED}⛔ Failed to download from GitHub branch: {e}{C_RESET}")
                    print(f"   Make sure the branch name '{artifact_branch}' exists in the repository")
                if os.path.exists(artifact_file):
                    try:
                        os.remove(artifact_file)
                    except Exception:
                        pass
                return False
            if not os.path.exists(artifact_file):
                print(f"{C_RED}⛔ Download failed: file not found after download{C_RESET}")
                return False
            file_size = os.path.getsize(artifact_file)
            if file_size == 0:
                print(f"{C_RED}⛔ Download failed: file is empty{C_RESET}")
                try:
                    os.remove(artifact_file)
                except Exception:
                    pass
                return False
            print(f"✅ Artifact downloaded to {artifact_file} ({file_size:,} bytes)")
        
        # Extract artifact
        if artifact_file and os.path.exists(artifact_file):
            try:
                print(f"📦 Extracting artifact from {artifact_file}...")
                import tarfile
                with tarfile.open(artifact_file, "r:gz") as tar:
                    # Verify tarball is valid and not empty
                    members = tar.getmembers()
                    if not members:
                        print(f"{C_RED}⛔ Tarball appears to be empty{C_RESET}")
                        return False
                    print(f"   Extracting {len(members)} files...")
                    tar.extractall(artifacts_dir)
                
                print(f"✅ Extraction complete. Searching for extracted directory...")
                
                # GitHub branch archives extract as tt-inference-server-{branch}
                # But branch names with slashes (e.g., feature/xyz) become dashes in the directory name
                # Try multiple possible directory names
                possible_dirs = [
                    os.path.join(artifacts_dir, f"tt-inference-server-{artifact_branch}"),
                    os.path.join(artifacts_dir, f"tt-inference-server-{sanitized_branch}"),
                ]
                
                # Also check what was actually extracted
                extracted_dir = None
                for possible_dir in possible_dirs:
                    if os.path.exists(possible_dir):
                        extracted_dir = possible_dir
                        print(f"📁 Found extracted directory: {extracted_dir}")
                        break
                
                # If not found, list directories in artifacts_dir to find the actual name
                if not extracted_dir:
                    try:
                        print(f"   Searching for directories starting with 'tt-inference-server'...")
                        for item in os.listdir(artifacts_dir):
                            item_path = os.path.join(artifacts_dir, item)
                            if os.path.isdir(item_path) and item.startswith("tt-inference-server"):
                                extracted_dir = item_path
                                print(f"📁 Found extracted directory: {extracted_dir}")
                                break
                    except Exception as e:
                        print(f"{C_YELLOW}⚠️  Could not list artifacts directory: {e}{C_RESET}")
                
                if extracted_dir and os.path.exists(extracted_dir):
                    # Validate the extracted directory has required structure
                    if not validate_artifact_structure(extracted_dir):
                        return False

                    # Rename to final location
                    if extracted_dir != INFERENCE_ARTIFACT_DIR:
                        if os.path.exists(INFERENCE_ARTIFACT_DIR):
                            print(f"🗑️  Removing existing {INFERENCE_ARTIFACT_DIR}...")
                            shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                        print(f"📦 Moving {extracted_dir} to {INFERENCE_ARTIFACT_DIR}...")
                        os.rename(extracted_dir, INFERENCE_ARTIFACT_DIR)
                        print(f"✅ Renamed {extracted_dir} to {INFERENCE_ARTIFACT_DIR}")
                    
                    # Final verification that everything is in place
                    if not validate_artifact_structure(INFERENCE_ARTIFACT_DIR):
                        return False

                    _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                    commit_sha = fetch_branch_commit_sha(artifact_branch)
                    _write_artifact_info(artifacts_dir, "branch", artifact_branch, sudo_used=sudo_used_for_cleanup, commit_sha=commit_sha)
                    return True
                else:
                    print(f"{C_RED}⛔ Extracted directory not found in {artifacts_dir}{C_RESET}")
                    print(f"   Expected one of: {possible_dirs}")
                    # List what's actually in artifacts_dir for debugging
                    try:
                        contents = os.listdir(artifacts_dir)
                        print(f"   Actual contents: {contents}")
                    except Exception:
                        pass
                    return False
            except Exception as e:
                print(f"{C_RED}⛔ Failed to extract artifact: {e}{C_RESET}")
                import traceback
                traceback.print_exc()
                return False
    elif artifact_version:
        # Handle "latest" by using the main branch, or download a specific version
        if artifact_version == "latest":
            print(f"{C_YELLOW}⚠️  'latest' version specified. Using 'main' branch as fallback.{C_RESET}")
            print(f"   To use a specific release version, set TT_INFERENCE_ARTIFACT_VERSION to a tag like 'v0.8.0'")
            artifact_branch = "main"
            artifact_version = None
            # Re-run the branch download logic
            artifact_file = os.path.join(artifacts_dir, f"tt-inference-server-main.tar.gz")
            if os.path.exists(artifact_file):
                print(f"📦 Using existing artifact tarball: {artifact_file}")
            else:
                github_url = f"https://github.com/tenstorrent/tt-inference-server/archive/refs/heads/main.tar.gz"
                try:
                    import urllib.request
                    print(f"   Downloading from: {github_url}")
                    print(f"   This may take a few minutes...")
                    urllib.request.urlretrieve(github_url, artifact_file)
                    file_size = os.path.getsize(artifact_file)
                    if file_size == 0:
                        print(f"{C_RED}⛔ Download failed: file is empty{C_RESET}")
                        os.remove(artifact_file)
                        return False
                    print(f"✅ Artifact downloaded to {artifact_file} ({file_size:,} bytes)")
                except Exception as e:
                    print(f"{C_RED}⛔ Failed to download from GitHub branch: {e}{C_RESET}")
                    return False
            
            # Extract using the same logic as branch extraction
            if artifact_file and os.path.exists(artifact_file):
                try:
                    print(f"📦 Extracting artifact from {artifact_file}...")
                    import tarfile
                    with tarfile.open(artifact_file, "r:gz") as tar:
                        members = tar.getmembers()
                        if not members:
                            print(f"{C_RED}⛔ Tarball appears to be empty{C_RESET}")
                            return False
                        print(f"   Extracting {len(members)} files...")
                        tar.extractall(artifacts_dir)
                    
                    print(f"✅ Extraction complete. Searching for extracted directory...")
                    extracted_dir = os.path.join(artifacts_dir, "tt-inference-server-main")
                    if not os.path.exists(extracted_dir):
                        for item in os.listdir(artifacts_dir):
                            item_path = os.path.join(artifacts_dir, item)
                            if os.path.isdir(item_path) and item.startswith("tt-inference-server"):
                                extracted_dir = item_path
                                print(f"📁 Found extracted directory: {extracted_dir}")
                                break
                    
                    if extracted_dir and os.path.exists(extracted_dir):
                        # Validate the extracted directory has required structure
                        if not validate_artifact_structure(extracted_dir):
                            return False

                        if extracted_dir != INFERENCE_ARTIFACT_DIR:
                            if os.path.exists(INFERENCE_ARTIFACT_DIR):
                                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                            os.rename(extracted_dir, INFERENCE_ARTIFACT_DIR)
                            print(f"✅ Renamed {extracted_dir} to {INFERENCE_ARTIFACT_DIR}")

                        # Final verification after rename
                        if not validate_artifact_structure(INFERENCE_ARTIFACT_DIR):
                            return False

                        _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                        # "latest" used main branch, so record branch not version
                        commit_sha = fetch_branch_commit_sha(artifact_branch)
                        _write_artifact_info(artifacts_dir, "branch", artifact_branch, sudo_used=sudo_used_for_cleanup, commit_sha=commit_sha)
                        return True
                    else:
                        print(f"{C_RED}⛔ Extracted directory not found{C_RESET}")
                        return False
                except Exception as e:
                    print(f"{C_RED}⛔ Failed to extract artifact: {e}{C_RESET}")
                    import traceback
                    traceback.print_exc()
                    return False
        else:
            # Download from GitHub release (existing logic)
            # Prefer local tarball if present (e.g. .artifacts/tt-inference-server-v0.8.0.tar.gz)
            version_without_v = artifact_version.lstrip("v").strip()
            possible_tarballs = [
                os.path.join(artifacts_dir, f"tt-inference-server-{artifact_version}.tar.gz"),
                os.path.join(artifacts_dir, f"tt-inference-server-{version_without_v}.tar.gz"),
            ]
            artifact_file = None
            for candidate in possible_tarballs:
                if os.path.exists(candidate):
                    artifact_file = candidate
                    print(f"📦 Using existing artifact tarball: {artifact_file}")
                    break

            if not artifact_file:
                # Download from GitHub release
                print(f"📥 Downloading TT Inference Server from GitHub release: {artifact_version}")
                github_url = f"https://github.com/tenstorrent/tt-inference-server/archive/refs/tags/{artifact_version}.tar.gz"
                artifact_file = os.path.join(artifacts_dir, f"tt-inference-server-{artifact_version}.tar.gz")
                try:
                    import urllib.request
                    print(f"   Downloading from: {github_url}")
                    print(f"   This may take a few minutes...")
                    urllib.request.urlretrieve(github_url, artifact_file)
                    
                    # Verify download completed successfully
                    if not os.path.exists(artifact_file):
                        print(f"{C_RED}⛔ Download failed: file not found after download{C_RESET}")
                        return False
                    
                    file_size = os.path.getsize(artifact_file)
                    if file_size == 0:
                        print(f"{C_RED}⛔ Download failed: file is empty{C_RESET}")
                        os.remove(artifact_file)
                        return False
                    
                    print(f"✅ Artifact downloaded to {artifact_file} ({file_size:,} bytes)")
                except Exception as e:
                    error_str = str(e)
                    if "404" in error_str or "Not Found" in error_str:
                        print(f"{C_RED}⛔ Version '{artifact_version}' not found on GitHub (HTTP 404).{C_RESET}")
                        print(f"   The release tag you configured does not exist.")
                        print(f"   You entered: TT_INFERENCE_ARTIFACT_VERSION={artifact_version}")
                        suggested = suggest_semver(artifact_version)
                        if suggested:
                            print(f"   Did you mean: {suggested} (semantic versioning uses vMAJOR.MINOR.PATCH)")
                        print(f"   Run: python run.py --reconfigure-inference-server")
                        print(f"   Valid releases: https://github.com/tenstorrent/tt-inference-server/releases")
                    else:
                        print(f"{C_RED}⛔ Failed to download from GitHub release: {e}{C_RESET}")
                    if os.path.exists(artifact_file):
                        try:
                            os.remove(artifact_file)
                        except Exception:
                            pass
                    return False

            if artifact_file and os.path.exists(artifact_file):
                try:
                    print(f"📦 Extracting artifact from {artifact_file}...")
                    import tarfile
                    with tarfile.open(artifact_file, "r:gz") as tar:
                        members = tar.getmembers()
                        if not members:
                            print(f"{C_RED}⛔ Tarball appears to be empty{C_RESET}")
                            return False
                        print(f"   Extracting {len(members)} files...")
                        tar.extractall(artifacts_dir)
                    
                    print(f"✅ Extraction complete. Searching for extracted directory...")
                    version_without_v = artifact_version.lstrip("v")
                    possible_dirs = [
                        os.path.join(artifacts_dir, f"tt-inference-server-{artifact_version}"),
                        os.path.join(artifacts_dir, f"tt-inference-server-{version_without_v}"),
                    ]
                    extracted_dir = None
                    for possible_dir in possible_dirs:
                        if os.path.exists(possible_dir):
                            extracted_dir = possible_dir
                            print(f"📁 Found extracted directory: {extracted_dir}")
                            break
                    
                    # If not found, search for any tt-inference-server directory
                    if not extracted_dir:
                        for item in os.listdir(artifacts_dir):
                            item_path = os.path.join(artifacts_dir, item)
                            if os.path.isdir(item_path) and item.startswith("tt-inference-server"):
                                extracted_dir = item_path
                                print(f"📁 Found extracted directory: {extracted_dir}")
                                break
                    
                    if extracted_dir and os.path.exists(extracted_dir):
                        # Validate the extracted directory has required structure
                        if not validate_artifact_structure(extracted_dir):
                            return False

                        # Rename to final location
                        if extracted_dir != INFERENCE_ARTIFACT_DIR:
                            if os.path.exists(INFERENCE_ARTIFACT_DIR):
                                print(f"🗑️  Removing existing {INFERENCE_ARTIFACT_DIR}...")
                                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                            print(f"📦 Moving {extracted_dir} to {INFERENCE_ARTIFACT_DIR}...")
                            os.rename(extracted_dir, INFERENCE_ARTIFACT_DIR)
                            print(f"✅ Renamed {extracted_dir} to {INFERENCE_ARTIFACT_DIR}")

                        # Final verification after rename
                        if not validate_artifact_structure(INFERENCE_ARTIFACT_DIR):
                            return False

                        _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                        _write_artifact_info(artifacts_dir, "version", artifact_version, sudo_used=sudo_used_for_cleanup)
                        return True
                    else:
                        print(f"{C_RED}⛔ Extracted directory not found{C_RESET}")
                        return False
                except Exception as e:
                    print(f"{C_RED}⛔ Failed to extract artifact: {e}{C_RESET}")
                    import traceback
                    traceback.print_exc()
                    return False

    # Fallback: check if artifact directory exists
    if os.path.exists(INFERENCE_ARTIFACT_DIR):
        _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
        return True
    else:
        print(f"{C_RED}⛔ Error: Artifact directory not found{C_RESET}")
        print(f"   Options:")
        print(f"   1. Set TT_INFERENCE_ARTIFACT_VERSION to a release tag (e.g., 'v0.8.0')")
        print(f"   2. Set TT_INFERENCE_ARTIFACT_BRANCH to a branch name (e.g., 'main', 'dev')")
        print(f"   3. Extract the artifact manually to: {INFERENCE_ARTIFACT_DIR}")
        print(f"   See: https://github.com/tenstorrent/tt-inference-server/releases")
        return False

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

def request_sudo_authentication(force_prompt=False):
    """
    Request sudo authentication upfront and cache it for later use.
    
    Args:
        force_prompt (bool): If True, always prompt even if sudo is already authenticated
    
    Returns:
        bool: True if authenticated, False otherwise
    """
    # Check if sudo is available
    if not shutil.which("sudo"):
        print(f"{C_RED}⛔ Error: sudo is not available on this system.{C_RESET}")
        return False
    
    # First, check if sudo is already authenticated (non-interactive mode)
    if not force_prompt:
        check_result = subprocess.run(["sudo", "-n", "-v"], capture_output=True, text=True)
        if check_result.returncode == 0:
            return True
    
    print(f"🔐 TT Inference Server setup requires sudo privileges. Please enter your password:")
    try:
        # Test sudo access - this will prompt for password if needed
        result = subprocess.run(["sudo", "-v"], check=True, capture_output=True, text=True)
        print(f"✅ Sudo authentication successful.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"{C_RED}⛔ Error: Failed to authenticate with sudo{C_RESET}")
        if e.returncode == 1:
            print(f"{C_YELLOW}   This usually means the password was incorrect or sudo access was denied.{C_RESET}")
        return False
    except FileNotFoundError:
        print(f"{C_RED}⛔ Error: sudo command not found{C_RESET}")
        return False

def remove_artifact_with_sudo(directory_path, description="artifact directory"):
    """
    Attempt to remove a directory using sudo after user confirmation.

    Args:
        directory_path (str): Absolute path to directory to remove
        description (str): Human-readable description for user prompt

    Returns:
        bool: True if successfully removed, False if user declined or removal failed
    """
    # Check if directory exists
    if not os.path.exists(directory_path):
        return True

    # Check if sudo is available
    if not shutil.which("sudo"):
        print(f"{C_RED}⛔ Error: sudo is not available on this system.{C_RESET}")
        return False

    # Explain to user why sudo is needed
    print()
    print(f"{C_YELLOW}🔐 Permission issues prevent normal removal of {description}{C_RESET}")
    print(f"   Directory: {directory_path}")
    print(f"   Sudo access is required to remove files with restricted permissions.")

    # Prompt for confirmation
    try:
        user_input = input(f"   Use sudo to remove {description}? (y/N): ").strip().lower()
        if user_input not in ['y', 'yes']:
            print(f"{C_YELLOW}   Sudo removal declined by user.{C_RESET}")
            return False
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}   Sudo removal cancelled by user.{C_RESET}")
        return False

    # Request sudo authentication first
    print(f"   Requesting sudo authentication...")
    if not request_sudo_authentication():
        return False

    # Attempt sudo removal
    print(f"   Removing {description} with sudo...")
    try:
        result = subprocess.run(
            ["sudo", "rm", "-rf", directory_path],
            capture_output=True,
            text=True,
            check=True
        )

        # Verify directory was removed
        if not os.path.exists(directory_path):
            return True
        else:
            print(f"{C_RED}⛔ Directory still exists after sudo removal{C_RESET}")
            return False

    except subprocess.CalledProcessError as e:
        print(f"{C_RED}⛔ Error: Sudo removal failed: {e}{C_RESET}")
        if e.stderr:
            print(f"   {e.stderr}")
        return False
    except FileNotFoundError:
        print(f"{C_RED}⛔ Error: sudo or rm command not found{C_RESET}")
        return False
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}   Sudo removal cancelled by user.{C_RESET}")
        return False

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

def get_spdx_header_type(file_path):
    """
    Determines the appropriate SPDX header type based on file extension.
    """
    suffix = file_path.suffix.lower()
    name = file_path.name
    
    if suffix in ('.py', '.sh') or name == 'Dockerfile':
        return 'hash'
    elif suffix in ('.ts', '.tsx', '.js', '.jsx'):
        return 'double_slash'
    elif suffix == '.css':
        return 'css'
    elif suffix in ('.html', '.htm'):
        return 'html'
    else:
        return None

def get_spdx_headers():
    """
    Returns SPDX header templates for different file types.
    """
    current_year = datetime.now().year
    
    return {
        # Python, Bash, Dockerfile
        'hash': f"""# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
        # TypeScript, JavaScript
        'double_slash': f"""// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
        # CSS
        'css': f"""/* SPDX-License-Identifier: Apache-2.0
 *
 * SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
 */
""",
        # HTML
        'html': f"""<!-- SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC -->
"""
    }

def should_skip_spdx_directory(directory_path):
    """
    Determines if a directory should be skipped during SPDX processing.
    """
    directory_name = directory_path.name
    
    # Skip common directories that shouldn't have SPDX headers
    skip_dirs = {
        'node_modules',
        '.git',
        '.venv',
        '__pycache__',
        '.pytest_cache',
        'dist',
        'build',
        '.next',
        'coverage',
        '.nyc_output',
        'frontend',  # Explicitly exclude frontend directory
        'tt-inference-server',  # Exclude (no longer used, replaced by artifact)
        'tt_studio_persistent_volume',  # Exclude runtime data
    }
    
    return directory_name in skip_dirs

def add_spdx_header_to_file(file_path, headers):
    """
    Adds the SPDX header to the file if it doesn't already contain it.
    """
    header_type = get_spdx_header_type(file_path)
    if header_type is None:
        return False
    
    header = headers[header_type]
    
    try:
        with open(file_path, "r+", encoding='utf-8') as file:
            content = file.read()
            if "SPDX-License-Identifier" not in content:
                file.seek(0, 0)
                file.write(header + "\n" + content)
                print(f"{C_GREEN}✅ Added SPDX header to: {file_path}{C_RESET}")
                return True
            else:
                return False
    except Exception as e:
        print(f"{C_RED}❌ Error processing {file_path}: {e}{C_RESET}")
        return False

def check_spdx_headers():
    """
    Check for missing SPDX headers in the codebase (excluding frontend).
    """
    print(f"{C_BLUE}{C_BOLD}🔍 Checking for missing SPDX license headers...{C_RESET}")
    
    repo_root = Path(TT_STUDIO_ROOT)
    directories_to_process = [
        repo_root / "app" / "backend",
        repo_root / "app" / "agent", 
        repo_root / "app" / "frontend",
        repo_root / "dev-tools",
        repo_root / "models",
        repo_root / "docs",
        repo_root,  # Root level files (like run.py, startup.sh)
    ]
    
    missing_headers = []
    total_files_checked = 0
    
    for directory in directories_to_process:
        if not directory.exists():
            print(f"{C_YELLOW}⚠️  Directory does not exist: {directory}{C_RESET}")
            continue
            
        print(f"{C_CYAN}📁 Checking directory: {directory}{C_RESET}")
        for file_path in directory.rglob("*"):
            if file_path.is_file():
                # Skip files in excluded directories
                if any(should_skip_spdx_directory(parent) for parent in file_path.parents):
                    continue
                    
                # Check if the file is a supported type
                if get_spdx_header_type(file_path) is not None:
                    total_files_checked += 1
                    try:
                        with open(file_path, "r", encoding='utf-8') as file:
                            content = file.read()
                            if "SPDX-License-Identifier" not in content:
                                missing_headers.append(str(file_path))
                    except Exception as e:
                        print(f"{C_YELLOW}⚠️  Could not read {file_path}: {e}{C_RESET}")
    
    print(f"\n{C_BLUE}📊 SPDX Header Check Results:{C_RESET}")
    print(f"  Total files checked: {total_files_checked}")
    print(f"  Files with missing headers: {len(missing_headers)}")
    
    if missing_headers:
        print(f"\n{C_RED}{C_BOLD}❌ Files missing SPDX headers:{C_RESET}")
        for file_path in missing_headers:
            print(f"  {C_RED}• {file_path}{C_RESET}")
        print(f"\n{C_CYAN}💡 To add missing headers, run: {C_WHITE}python run.py --add-headers{C_RESET}")
        print(f"   {C_CYAN}or alternatively:{C_RESET}")
        print(f"   {C_CYAN}python3 run.py --add-headers{C_RESET}")
        return False
    else:
        print(f"\n{C_GREEN}{C_BOLD}✅ All files have proper SPDX license headers!{C_RESET}")
        return True

def add_spdx_headers():
    """
    Add missing SPDX headers to all source files (excluding frontend).
    """
    print(f"{C_BLUE}{C_BOLD}📝 Adding missing SPDX license headers...{C_RESET}")
    
    repo_root = Path(TT_STUDIO_ROOT)
    directories_to_process = [
        repo_root / "app" / "backend",
        repo_root / "app" / "agent", 
        repo_root / "dev-tools",
        repo_root / "models",
        repo_root / "docs",
        repo_root,  # Root level files (like run.py, startup.sh)
    ]
    
    headers = get_spdx_headers()
    files_modified = 0
    total_files_checked = 0
    
    for directory in directories_to_process:
        if not directory.exists():
            print(f"{C_YELLOW}⚠️  Directory does not exist: {directory}{C_RESET}")
            continue
            
        print(f"{C_CYAN}📁 Processing directory: {directory}{C_RESET}")
        for file_path in directory.rglob("*"):
            if file_path.is_file():
                # Skip files in excluded directories
                if any(should_skip_spdx_directory(parent) for parent in file_path.parents):
                    continue
                    
                # Check if the file is a supported type
                if get_spdx_header_type(file_path) is not None:
                    total_files_checked += 1
                    if add_spdx_header_to_file(file_path, headers):
                        files_modified += 1
    
    print(f"\n{C_BLUE}📊 SPDX Header Addition Results:{C_RESET}")
    print(f"  Total files checked: {total_files_checked}")
    print(f"  Files modified: {files_modified}")
    
    if files_modified > 0:
        print(f"\n{C_GREEN}{C_BOLD}✅ Successfully added SPDX headers to {files_modified} files!{C_RESET}")
    else:
        print(f"\n{C_GREEN}{C_BOLD}✅ All files already have proper SPDX license headers!{C_RESET}")

def fix_docker_issues():
    """Automatically fix common Docker service and permission issues."""
    print(f"\n{C_TT_PURPLE}{C_BOLD}🔧 TT Studio Docker Fix Utility{C_RESET}")
    print(f"{C_YELLOW}{'=' * 60}{C_RESET}")

    try:
        # Step 1: Start Docker service
        print(f"\n{C_BLUE}🚀 Starting Docker service...{C_RESET}")
        result = subprocess.run(["sudo", "service", "docker", "start"],
                              capture_output=True, text=True, check=False)

        if result.returncode == 0:
            print(f"{C_GREEN}✅ Docker service started successfully{C_RESET}")
        else:
            print(f"{C_YELLOW}⚠️  Docker service start returned code {result.returncode}{C_RESET}")
            if result.stderr:
                print(f"{C_YELLOW}   {result.stderr.strip()}{C_RESET}")

        # Step 2: Determine socket group and provide guidance
        print(f"\n{C_BLUE}🔒 Checking Docker socket permissions...{C_RESET}")
        try:
            import grp
            socket_stat = os.stat("/var/run/docker.sock")
            socket_group = grp.getgrgid(socket_stat.st_gid).gr_name
            current_user = getpass.getuser()

            print(f"{C_CYAN}Docker socket group: {socket_group}{C_RESET}")
            print(f"\n{C_YELLOW}Choose permission fix method:{C_RESET}")
            print(f"  {C_GREEN}1){C_RESET} Add user to {socket_group} group (recommended, secure)")
            print(f"  {C_GREEN}2){C_RESET} Set socket to 666 (quick fix, less secure)")
            print(f"  {C_GREEN}3){C_RESET} Keep current permissions and use sudo for Docker commands")

            try:
                choice = input(f"\n{C_CYAN}Enter choice (1-3) [1]: {C_RESET}").strip() or "1"
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}⚠️  Cancelled by user{C_RESET}")
                return False

            if choice == "1":
                print(f"\n{C_BLUE}Adding user '{current_user}' to '{socket_group}' group...{C_RESET}")
                group_result = subprocess.run(["sudo", "usermod", "-aG", socket_group, current_user],
                                            capture_output=True, text=True, check=False)

                if group_result.returncode == 0:
                    print(f"{C_GREEN}✅ User added to {socket_group} group{C_RESET}")
                    print(f"\n{C_YELLOW}⚠️  IMPORTANT: You need to log out and log back in for group changes to take effect{C_RESET}")
                    print(f"{C_CYAN}Or run this command to apply changes in current session:{C_RESET}")
                    print(f"   {C_WHITE}newgrp {socket_group}{C_RESET}")
                else:
                    print(f"{C_RED}❌ Failed to add user to group: {group_result.stderr.strip() if group_result.stderr else 'Unknown error'}{C_RESET}")
                    return False

            elif choice == "2":
                print(f"\n{C_YELLOW}⚠️  Setting socket permissions to 666 (less secure){C_RESET}")
                socket_result = subprocess.run(["sudo", "chmod", "666", "/var/run/docker.sock"],
                                             capture_output=True, text=True, check=False)

                if socket_result.returncode == 0:
                    print(f"{C_GREEN}✅ Docker socket permissions set to 666{C_RESET}")
                    print(f"{C_YELLOW}Note: To reset to secure 660, run: sudo chmod 660 /var/run/docker.sock{C_RESET}")
                else:
                    print(f"{C_RED}❌ Failed to set permissions: {socket_result.stderr.strip() if socket_result.stderr else 'Unknown error'}{C_RESET}")
                    return False

            elif choice == "3":
                print(f"\n{C_CYAN}✅ Keeping current permissions{C_RESET}")
                print(f"{C_YELLOW}TT Studio will use sudo for Docker commands when needed{C_RESET}")

            else:
                print(f"{C_RED}❌ Invalid choice{C_RESET}")
                return False

        except Exception as e:
            print(f"{C_YELLOW}⚠️  Could not check socket permissions: {e}{C_RESET}")
            print(f"{C_YELLOW}Defaulting to 666 permissions...{C_RESET}")
            socket_result = subprocess.run(["sudo", "chmod", "666", "/var/run/docker.sock"],
                                         capture_output=True, text=True, check=False)
            if socket_result.returncode == 0:
                print(f"{C_GREEN}✅ Docker socket permissions set to 666{C_RESET}")

        # Step 3: Test Docker connectivity
        print(f"\n{C_BLUE}🔍 Testing Docker connectivity...{C_RESET}")
        test_result = subprocess.run(["docker", "info"],
                                   capture_output=True, text=True, check=False)

        if test_result.returncode == 0:
            print(f"{C_GREEN}✅ Docker is working correctly!{C_RESET}")
            print(f"\n{C_GREEN}{C_BOLD}🎉 Docker fix completed successfully!{C_RESET}")
            print(f"{C_CYAN}You can now run: {C_WHITE}python run.py{C_RESET}")
        else:
            print(f"{C_RED}❌ Docker connectivity test failed{C_RESET}")
            if test_result.stderr:
                print(f"{C_YELLOW}Error: {test_result.stderr.strip()}{C_RESET}")
            print(f"\n{C_YELLOW}You may need to manually troubleshoot Docker installation.{C_RESET}")
            return False

    except FileNotFoundError:
        print(f"{C_RED}❌ Error: 'sudo' or 'docker' command not found{C_RESET}")
        print(f"{C_YELLOW}Please ensure Docker is installed and sudo is available.{C_RESET}")
        return False
    except Exception as e:
        print(f"{C_RED}❌ Unexpected error during Docker fix: {e}{C_RESET}")
        return False

    print(f"{C_YELLOW}{'=' * 60}{C_RESET}")
    return True

def main():
    """Main function to orchestrate the script."""
    try:
        parser = argparse.ArgumentParser(
            description=f"""
{C_TT_PURPLE}{C_BOLD}🚀 TT Studio Setup Script{C_RESET}

{C_CYAN}A comprehensive setup tool for Tenstorrent TT Studio that handles:{C_RESET}
• Environment configuration with interactive prompts
• Frontend dependencies installation (node_modules)
• Docker services orchestration  
• TT Inference Server FastAPI setup
• Hardware detection and optimization

{C_YELLOW}For detailed environment variable help, use: {C_CYAN}--help-env{C_RESET}
        """,
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog=f"""
{C_GREEN}{C_BOLD}Examples:{C_RESET}
  {C_CYAN}python run.py{C_RESET}                        🚀 Default: minimal setup, only prompts for HF_TOKEN
  {C_CYAN}python run.py --dev{C_RESET}                  🛠️  Dev mode with minimal setup (same defaults)
  {C_CYAN}python run.py --configure-env{C_RESET}        ⚙️  Full interactive setup for secrets/modes
  {C_CYAN}python run.py --dev --configure-env{C_RESET}  ⚙️  Full interactive setup in dev mode
  {C_CYAN}python run.py --reconfigure{C_RESET}          🔄 Reset preferences + full interactive setup
  {C_CYAN}python run.py --reconfigure-inference-server{C_RESET} 🔄 Change TT Inference Server artifact (branch/version)
  {C_CYAN}python run.py --resync{C_RESET}         🔄 Force model catalog resync
  {C_CYAN}python run.py --cleanup{C_RESET}              🧹 Clean up containers and networks only
  {C_CYAN}python run.py --cleanup-all{C_RESET}          🗑️  Complete cleanup including data and config
  {C_CYAN}python run.py --skip-fastapi{C_RESET}         ⏭️  Skip FastAPI server setup (auto-skipped in AI Playground mode)
  {C_CYAN}python run.py --no-browser{C_RESET}           🚫 Skip automatic browser opening
  {C_CYAN}python run.py --wait-for-services{C_RESET}    ⏳ Wait for all services to be healthy before completing
  {C_CYAN}python run.py --check-headers{C_RESET}        🔍 Check for missing SPDX license headers
  {C_CYAN}python run.py --add-headers{C_RESET}          📝 Add missing SPDX license headers (excludes frontend)
  {C_CYAN}python run.py --fix-docker{C_RESET}           🔧 Automatically fix Docker service and permission issues
  {C_CYAN}python run.py --help-env{C_RESET}             📚 Show detailed environment variables help

{C_MAGENTA}For more information, visit: https://github.com/tenstorrent/tt-studio{C_RESET}
        """
        )
        parser.add_argument("--dev", action="store_true", 
                           help="🛠️  Development mode - show suggested defaults but still prompt for all values")
        parser.add_argument("--cleanup", action="store_true", 
                           help="🧹 Clean up Docker containers and networks")
        parser.add_argument("--cleanup-all", action="store_true", 
                           help="🗑️  Clean up everything including persistent data and .env file")
        parser.add_argument("--help-env", action="store_true", 
                           help="📚 Show detailed help for environment variables")
        parser.add_argument("--reconfigure", action="store_true",
                           help="🔄 Reset preferences and reconfigure all options")
        parser.add_argument("--reconfigure-inference-server", action="store_true",
                           help="🔄 Reconfigure TT Inference Server artifact (branch/version)")
        parser.add_argument("--resync", action="store_true",
                           help="🔄 Force resync of model catalog from TT Inference Server artifact")
        parser.add_argument("--pull-branch", action="store_true",
                           help="🔄 Re-download the inference server artifact from the configured branch to pick up new commits")
        parser.add_argument("--skip-fastapi", action="store_true",
                           help="⏭️  Skip TT Inference Server FastAPI setup (auto-skipped in AI Playground mode)")
        parser.add_argument("--skip-docker-control", action="store_true",
                           help="⏭️  Skip Docker Control Service setup")
        parser.add_argument("--no-sudo", action="store_true",
                           help="🚫 Skip sudo usage for FastAPI setup (may limit functionality)")
        parser.add_argument("--no-browser", action="store_true", 
                           help="🚫 Skip automatic browser opening")
        parser.add_argument("--wait-for-services", action="store_true", 
                           help="⏳ Wait for all services to be healthy before completing")
        parser.add_argument("--browser-timeout", type=int, default=60,
                   help="⏳ Timeout in seconds for waiting for frontend before opening browser")
        parser.add_argument("--add-headers", action="store_true",
                   help="📝 Add missing SPDX license headers to all source files (excludes frontend)")
        parser.add_argument("--check-headers", action="store_true",
                   help="🔍 Check for missing SPDX license headers without adding them")
        parser.add_argument("--auto-deploy", type=str, metavar="MODEL_NAME",
                   help="🤖 Automatically deploy the specified model after startup (e.g., 'Llama-3.2-1B-Instruct')")
        parser.add_argument("--device-id", type=int, default=0, metavar="CHIP_ID",
                   help="🔌 Chip slot index (0-7) to use when auto-deploying a model (default: 0)")
        parser.add_argument("--fix-docker", action="store_true",
                   help="🔧 Automatically fix Docker service and permission issues")
        parser.add_argument("--configure-env", action="store_true",
                   help="⚙️  Interactively configure all environment variables (secrets, modes, cloud endpoints)")
        
        args = parser.parse_args()
        
        if args.help_env:
            print(f"""
{C_TT_PURPLE}{C_BOLD}TT Studio Environment Variables Help{C_RESET}

{C_CYAN}{C_BOLD}Core Configuration:{C_RESET}
{'=' * 80}
  {C_YELLOW}TT_STUDIO_ROOT{C_RESET}                      Root directory of the repository
  {C_YELLOW}HOST_PERSISTENT_STORAGE_VOLUME{C_RESET}      Host path for persistent storage
  {C_YELLOW}INTERNAL_PERSISTENT_STORAGE_VOLUME{C_RESET}  Container path for persistent storage
  {C_YELLOW}BACKEND_API_HOSTNAME{C_RESET}                Backend API hostname

{C_RED}{C_BOLD}Security (Required):{C_RESET}
{'=' * 80}
  {C_YELLOW}JWT_SECRET{C_RESET}                          JWT authentication secret
  {C_YELLOW}DJANGO_SECRET_KEY{C_RESET}                   Django application secret key
  {C_YELLOW}HF_TOKEN{C_RESET}                            Hugging Face API token

{C_YELLOW}{C_BOLD}Optional Services:{C_RESET}
{'=' * 80}
  {C_YELLOW}TAVILY_API_KEY{C_RESET}                      Tavily search API key (optional)

{C_GREEN}{C_BOLD}Application Modes:{C_RESET}
{'=' * 80}
  {C_YELLOW}VITE_APP_TITLE{C_RESET}                      Application title
  {C_YELLOW}VITE_ENABLE_DEPLOYED{C_RESET}                Enable AI Playground mode (true/false)
  {C_YELLOW}VITE_ENABLE_RAG_ADMIN{C_RESET}               Enable RAG admin interface (true/false)
  {C_YELLOW}RAG_ADMIN_PASSWORD{C_RESET}                  RAG admin password (required if RAG enabled)

{C_BLUE}{C_BOLD}Cloud Models (Only when AI Playground is enabled):{C_RESET}
{'=' * 80}
  {C_YELLOW}CLOUD_CHAT_UI_URL{C_RESET}                   Llama Chat UI endpoint
  {C_YELLOW}CLOUD_CHAT_UI_AUTH_TOKEN{C_RESET}            Llama Chat UI authentication token
  {C_YELLOW}CLOUD_YOLOV4_API_URL{C_RESET}                YOLOv4 API endpoint
  {C_YELLOW}CLOUD_YOLOV4_API_AUTH_TOKEN{C_RESET}         YOLOv4 API authentication token
  {C_YELLOW}CLOUD_SPEECH_RECOGNITION_URL{C_RESET}        Whisper API endpoint
  {C_YELLOW}CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN{C_RESET} Whisper API authentication token
  {C_YELLOW}CLOUD_STABLE_DIFFUSION_URL{C_RESET}          Stable Diffusion API endpoint
  {C_YELLOW}CLOUD_STABLE_DIFFUSION_AUTH_TOKEN{C_RESET}   Stable Diffusion API authentication token

{C_MAGENTA}{C_BOLD}Usage Examples:{C_RESET}
{'=' * 80}
  {C_CYAN}python run.py{C_RESET}                        Normal setup with prompts
  {C_CYAN}python run.py --easy{C_RESET}                 Easy setup - minimal prompts, only HF_TOKEN required
  {C_CYAN}python run.py --dev{C_RESET}                  Development mode with defaults
  {C_CYAN}python run.py --reconfigure{C_RESET}          Reset preferences and reconfigure
  {C_CYAN}python run.py --cleanup{C_RESET}              Clean up containers only
  {C_CYAN}python run.py --cleanup-all{C_RESET}          Complete cleanup (data + config)
  {C_CYAN}python run.py --skip-fastapi{C_RESET}         Skip FastAPI server setup
  {C_CYAN}python run.py --no-sudo{C_RESET}              Skip sudo usage (may limit functionality)
  {C_CYAN}python run.py --check-headers{C_RESET}        Check for missing SPDX license headers
  {C_CYAN}python run.py --add-headers{C_RESET}          Add missing SPDX license headers

{'=' * 80}
{C_WHITE}For more information, visit: {C_CYAN}https://github.com/tenstorrent/tt-studio{C_RESET}
        """)
            return
        
        if args.cleanup or args.cleanup_all:
            cleanup_resources(args)
            return
        
        if args.check_headers:
            check_spdx_headers()
            return
        
        if args.fix_docker:
            success = fix_docker_issues()
            sys.exit(0 if success else 1)
        
        if args.add_headers:
            add_spdx_headers()
            return
        
        display_welcome_banner()
        freshness = check_startup_freshness(TT_STUDIO_ROOT, get_env_var)

        # Block startup if the local tt-studio branch is behind its remote.
        if freshness.get("tt_studio_behind"):
            print(f"\n{C_YELLOW}⚠️  tt-studio is behind its remote branch.{C_RESET}")
            try:
                resp = input("   Run 'git pull' now? [Y/n]: ").strip().lower()
            except EOFError:
                resp = "n"
            if resp in ("", "y", "yes"):
                print(f"{C_CYAN}   Running git pull...{C_RESET}")
                pull_result = subprocess.run(
                    ["git", "-C", TT_STUDIO_ROOT, "pull"],
                    check=False,
                )
                if pull_result.returncode == 0:
                    print(f"\n{C_GREEN}✅ tt-studio updated. Please re-run 'python run.py' to start with the updated code.{C_RESET}")
                else:
                    print(f"\n{C_RED}⛔ git pull failed. Please resolve any issues and re-run 'python run.py'.{C_RESET}")
            else:
                print(f"\n{C_RED}⛔ Please run 'git pull' before starting tt-studio.{C_RESET}")
            startup_log.summary(exit_code=1)
            startup_log.close()
            sys.exit(1)

        # If the inference-server artifact is outdated, auto-fetch the latest.
        if freshness.get("artifact_behind") and not args.pull_branch:
            artifact_branch = freshness.get("artifact_branch", "")
            print(f"{C_CYAN}ℹ️  Artifact '{artifact_branch}' is outdated — auto-fetching latest.{C_RESET}")
            args.pull_branch = True

        # Get git hash for startup log
        try:
            _git_hash = subprocess.run(
                ["git", "-C", TT_STUDIO_ROOT, "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, check=False,
            ).stdout.strip() or "unknown"
        except Exception:
            _git_hash = "unknown"
        startup_log.header(f"git:{_git_hash}")

        # Pre-flight system checks
        startup_log.step("preflight_checks", "START")
        run_preflight_checks()
        startup_log.step("preflight_checks", "OK")

        startup_log.step("docker_install_check", "START")
        check_docker_installation()
        startup_log.step("docker_install_check", "OK")

        startup_log.step("configure_environment", "START")
        configure_environment_sequentially(dev_mode=args.dev, force_reconfigure=args.reconfigure, easy_mode=not args.configure_env, reconfigure_inference=args.reconfigure_inference_server)
        startup_log.step("configure_environment", "OK")

        # Save easy mode configuration to JSON if not in --configure-env mode
        if not args.configure_env:
            easy_config = {
                "mode": "easy",
                "setup_timestamp": datetime.now().isoformat(),
                "jwt_secret_default": "test-secret-456",
                "django_secret_key_default": "django-insecure-default",
                "hf_token_provided": True,
                "tt_studio_mode": True,
                "ai_playground_mode": False,
                "vite_app_title": "Tenstorrent | TT Studio",
                "vite_enable_deployed": "false",
                "vite_enable_rag_admin": "false"
            }
            save_easy_config(easy_config)

        # Create persistent storage directory
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        if host_persistent_volume:
            if not os.path.isdir(host_persistent_volume):
                print(f"\n{C_BLUE}📁 Creating persistent storage directory at: {host_persistent_volume}{C_RESET}")
                os.makedirs(host_persistent_volume, exist_ok=True)
                # Only set permissions on newly created directory (we own it)
                # Existing subdirectories will be handled by Docker containers via docker-entrypoint.sh
                try:
                    os.chmod(host_persistent_volume, 0o777)
                except (OSError, PermissionError) as e:
                    print(f"{C_YELLOW}⚠️  Could not set permissions on persistent volume: {e}{C_RESET}")
                    print(f"{C_YELLOW}   Docker containers will handle permissions via docker-entrypoint.sh{C_RESET}")

        # Create Docker network
        has_docker_access = check_docker_access()
        if not has_docker_access:
            print(f"{C_YELLOW}⚠️  Docker permission issue detected - will use sudo for Docker commands (password may be required){C_RESET}")

        try:
            # For network ls, we need to capture output to check if network exists
            # First try without sudo to check if we can access Docker
            result = subprocess.run(["docker", "network", "ls"], capture_output=True, text=True, check=False)

            if result.returncode != 0 and "permission denied" in result.stderr.lower():
                # Permission denied, try with sudo (without capturing output for password prompt)
                print(f"{C_YELLOW}⚠️  Permission denied, using sudo (you may be prompted for password)...{C_RESET}")
                # First authenticate with a simple sudo command
                subprocess.run(["sudo", "-v"], check=False)
                # Now run the network ls command with sudo and capture output
                result = subprocess.run(["sudo", "docker", "network", "ls"], capture_output=True, text=True, check=True)
            elif result.returncode != 0:
                raise subprocess.CalledProcessError(result.returncode, ["docker", "network", "ls"], result.stdout, result.stderr)

            if "tt_studio_network" not in result.stdout:
                try:
                    if has_docker_access:
                        result = subprocess.run(["docker", "network", "create", "tt_studio_network"],
                                              capture_output=True, text=True, check=True)
                    else:
                        result = subprocess.run(["sudo", "docker", "network", "create", "tt_studio_network"],
                                              capture_output=True, text=True, check=True)
                except subprocess.CalledProcessError as e:
                    error_output = e.stderr.lower() if e.stderr else ""
                    print(f"{C_RED}⛔ Error: Failed to create Docker network.{C_RESET}")

                    if "cannot connect" in error_output or "connection refused" in error_output:
                        print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
                        print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                        print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
                        print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
                        print()
                        print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
                        print(f"   {C_CYAN}sudo service docker start{C_RESET}")
                        print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
                        print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                    else:
                        print(f"{C_YELLOW}Docker network creation failed: {e.stderr if e.stderr else 'Unknown error'}{C_RESET}")
                        print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")

                    sys.exit(1)
            else:
                pass  # Network already exists
        except subprocess.CalledProcessError as e:
            error_output = e.stderr.lower() if e.stderr else ""
            print(f"{C_RED}⛔ Error: Failed to list Docker networks.{C_RESET}")

            if "cannot connect" in error_output or "connection refused" in error_output:
                print(f"\n{C_YELLOW}🚫 Docker Daemon Not Running{C_RESET}")
                print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
                print(f"{C_GREEN}🔧 Easy fix - run the Docker fix utility:{C_RESET}")
                print(f"   {C_CYAN}python run.py --fix-docker{C_RESET}")
                print()
                print(f"{C_GREEN}🚀 Or manually start Docker with one of these:{C_RESET}")
                print(f"   {C_CYAN}sudo service docker start{C_RESET}")
                print(f"   {C_CYAN}sudo systemctl start docker{C_RESET}")
                print(f"{C_YELLOW}{'─' * 50}{C_RESET}")
            else:
                print(f"{C_YELLOW}Docker network listing failed: {e.stderr if e.stderr else 'Unknown error'}{C_RESET}")
                print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")

            sys.exit(1)

        # Ensure frontend dependencies are installed
        ensure_frontend_dependencies(force_prompt=args.reconfigure, easy_mode=not args.configure_env)

        # Check if all required ports are available

        # Define ports based on mode
        required_ports = [
            (3000, "Frontend"),
            (8000, "Backend API"),
            (8080, "Agent Service"),
            (8111, "ChromaDB"),
        ]

        ports_ok, failed_ports = check_and_free_ports(required_ports, no_sudo=args.no_sudo)

        if not ports_ok:
            print(f"\n{C_RED}{C_BOLD}❌ ERROR: The following ports are not available:{C_RESET}")
            print()
            for port, service_name in failed_ports:
                print(f"  {C_RED}• Port {port} - {service_name}{C_RESET}")
            print()
            print(f"{C_YELLOW}These ports are required for TT Studio to run.{C_RESET}")
            print()
            print(f"{C_CYAN}{C_BOLD}To resolve this issue:{C_RESET}")
            print(f"  1. Find processes using these ports:")
            for port, _ in failed_ports:
                print(f"     {C_WHITE}lsof -i :{port}{C_RESET}")
            print()
            print(f"  2. Stop the processes manually:")
            print(f"     {C_WHITE}kill -9 <PID>{C_RESET}")
            print()
            print(f"  3. Or run with sudo to automatically free ports:")
            print(f"     {C_WHITE}python run.py{C_RESET} (without --no-sudo)")
            print()
            sys.exit(1)

        # Ensure workflow_logs directory exists with correct permissions before Docker mounts it
        # This prevents Docker from creating it as root (which causes permission issues)
        workflow_logs_dir = os.path.join(INFERENCE_ARTIFACT_DIR, "workflow_logs")
        if not os.path.exists(workflow_logs_dir):
            try:
                os.makedirs(workflow_logs_dir, mode=0o755, exist_ok=True)
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Could not create workflow_logs directory: {e}{C_RESET}")
        else:
            # Ensure existing directory has correct permissions (Unix/Linux only)
            if OS_NAME != "Windows":
                current_stat = os.stat(workflow_logs_dir)
                current_uid = current_stat.st_uid
                current_user_uid = os.getuid()
                if current_uid != current_user_uid and current_uid == 0:  # Owned by root
                    print(f"{C_YELLOW}⚠️  The workflow_logs directory is owned by root:{C_RESET}")
                    print(f"   {C_WHITE}{workflow_logs_dir}{C_RESET}")
                    print()
                    print(f"{C_YELLOW}This was likely created by Docker and will prevent deployment logs from being written.{C_RESET}")
                    print(f"{C_YELLOW}TT Studio needs to run the following command to fix it:{C_RESET}")
                    print(f"   {C_WHITE}sudo chown -R $USER:$USER {workflow_logs_dir}{C_RESET}")
                    print()
                    answer = input(f"{C_CYAN}Allow TT Studio to run this automatically? [y/N]: {C_RESET}").strip().lower()
                    print()
                    if answer in ("y", "yes"):
                        try:
                            import subprocess as _sp
                            _sp.run(
                                ["sudo", "chown", "-R", f"{current_user_uid}:{os.getgid()}", workflow_logs_dir],
                                check=True,
                            )
                            print(f"{C_GREEN}✅ Fixed workflow_logs directory ownership{C_RESET}")
                        except Exception as e:
                            print(f"{C_RED}⛔ sudo chown failed: {e}{C_RESET}")
                            print(f"{C_YELLOW}Please run the command above manually and restart TT Studio.{C_RESET}")
                            sys.exit(1)
                    else:
                        print(f"{C_YELLOW}Please run the following command and restart TT Studio:{C_RESET}")
                        print(f"   {C_WHITE}sudo chown -R $USER:$USER {workflow_logs_dir}{C_RESET}")
                        print()
                        sys.exit(1)

        # Start Docker Control Service BEFORE starting Docker containers
        # This ensures the backend can connect to it when it starts
        startup_log.step("docker_control_service", "START")
        if not args.skip_docker_control:
            if not start_docker_control_service(no_sudo=args.no_sudo, dev_mode=args.dev):
                startup_log.step("docker_control_service", "WARN", "failed, continuing without it")
                print(f"{C_RED}⛔ Failed to start Docker Control Service. Continuing without it.{C_RESET}")
                print(f"{C_YELLOW}Note: Backend will not be able to manage Docker containers.{C_RESET}")
            else:
                startup_log.step("docker_control_service", "OK")
        else:
            startup_log.step("docker_control_service", "SKIP", "--skip-docker-control")
            print(f"\n{C_YELLOW}⚠️  Skipping Docker Control Service setup (--skip-docker-control flag used){C_RESET}")

        # Check if AI Playground mode is enabled
        is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))

        # Check and download TT Inference Server artifact BEFORE building containers
        # so any version/branch changes are visible to the user early and failures stop startup immediately
        if not args.skip_fastapi and not is_deployed_mode:
            startup_log.step("fastapi_server", "START")
            print(f"\n{C_CYAN}🔍 Checking TT Inference Server artifact...{C_RESET}")
            original_dir = os.getcwd()
            try:
                if not setup_tt_inference_server(pull_branch=args.pull_branch):
                    startup_log.step("fastapi_server", "FAIL", "inference server setup failed")
                    print(f"{C_RED}⛔ Cannot start TT Studio: TT Inference Server setup failed. Exiting.{C_RESET}")
                    startup_log.summary(exit_code=1)
                    startup_log.close()
                    sys.exit(1)

                # Sync model catalog from artifact
                models_json_path = os.path.join(TT_STUDIO_ROOT, "app", "backend", "shared_config", "models_from_inference_server.json")
                should_sync = (
                    args.resync or
                    args.reconfigure_inference_server or
                    args.pull_branch or
                    not os.path.exists(models_json_path)
                )
                if should_sync:
                    print(f"\n{C_CYAN}🔄 Syncing model catalog from artifact...{C_RESET}")
                    _sync_model_catalog()
                else:
                    print(f"\n{C_YELLOW}ℹ️  Skipping model catalog sync (use --resync to force){C_RESET}")
            finally:
                os.chdir(original_dir)
        elif args.skip_fastapi:
            startup_log.step("fastapi_server", "SKIP", "--skip-fastapi")
            print(f"\n{C_YELLOW}⚠️  Skipping TT Inference Server FastAPI setup (--skip-fastapi flag used){C_RESET}")
        elif is_deployed_mode:
            startup_log.step("fastapi_server", "SKIP", "AI Playground mode")
            print(f"\n{C_GREEN}✅ Skipping TT Inference Server FastAPI setup (AI Playground mode enabled){C_RESET}")
            print(f"{C_CYAN}   Note: AI Playground mode uses cloud models, so local FastAPI server is not needed{C_RESET}")

        # Pre-create workflow_logs before docker compose up.
        # docker-compose.yml bind-mounts this directory; if Docker creates it first, it
        # does so as root, which blocks the FastAPI server (running as the current user)
        # from writing logs on the first deploy. Also fix ownership if already root-owned
        # from a previous run.
        for _subdir in ["workflow_logs", os.path.join("workflow_logs", "run_logs")]:
            _log_dir = os.path.join(INFERENCE_ARTIFACT_DIR, _subdir)
            try:
                os.makedirs(_log_dir, exist_ok=True)
            except PermissionError:
                subprocess.run(["sudo", "chown", f"{os.getuid()}:{os.getgid()}", _log_dir], check=False)
                os.makedirs(_log_dir, exist_ok=True)

        # Start Docker services with streaming output and comprehensive error reporting
        startup_log.step("docker_compose_up", "START")
        print(f"\n{C_CYAN}🔨 Building containers (backend, frontend, agent, chroma)...{C_RESET}")
        _docker_transient_lines = 1  # track lines to clear on success

        # Check Docker access to determine if sudo is needed
        has_docker_access = check_docker_access()
        use_sudo = not has_docker_access

        # Set up the Docker Compose command (quiet — build progress is transient)
        docker_compose_cmd = build_docker_compose_command(dev_mode=args.dev, quiet=True)
        docker_compose_cmd.extend(["up", "--build", "-d"])

        # Run with streaming output
        compose_cmd = (["sudo"] + docker_compose_cmd) if use_sudo else docker_compose_cmd
        returncode, full_output = run_docker_compose_with_progress(
            compose_cmd,
            cwd=os.path.join(TT_STUDIO_ROOT, "app"),
        )

        if not handle_docker_compose_result(returncode, full_output, use_sudo=use_sudo):
            startup_log.step("docker_compose_up", "FAIL", f"exit={returncode}")
            startup_log.summary(exit_code=1)
            startup_log.close()
            sys.exit(1)

        # Clear the "Building containers..." line (build progress was already cleared by run_docker_compose_with_progress)
        clear_lines(_docker_transient_lines)
        print(f"{C_GREEN}✅ Docker containers built and running{C_RESET}")
        startup_log.step("docker_compose_up", "OK")

        # Start FastAPI server now that containers are up
        if not args.skip_fastapi and not is_deployed_mode:
            original_dir = os.getcwd()
            try:
                if not setup_fastapi_environment():
                    startup_log.step("fastapi_server", "FAIL", "environment setup failed")
                    print(f"{C_RED}⛔ Cannot start TT Studio: FastAPI environment setup failed. Exiting.{C_RESET}")
                    suggest_pip_fixes()
                    startup_log.summary(exit_code=1)
                    startup_log.close()
                    sys.exit(1)

                if not start_fastapi_server(no_sudo=args.no_sudo, dev_mode=args.dev):
                    startup_log.step("fastapi_server", "FAIL", f"see {FASTAPI_LOG_FILE}")
                    print(f"{C_RED}⛔ Cannot start TT Studio: FastAPI server failed to start. Exiting.{C_RESET}")
                    print(f"   Check logs: tail -50 {FASTAPI_LOG_FILE}")
                    startup_log.summary(exit_code=1)
                    startup_log.close()
                    sys.exit(1)
                startup_log.step("fastapi_server", "OK")
            finally:
                os.chdir(original_dir)

        fastapi_enabled = not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_PID_FILE)
        docker_control_enabled = not args.skip_docker_control and os.path.exists(DOCKER_CONTROL_PID_FILE)

        print()
        print(f"{C_GREEN}{'=' * 60}{C_RESET}")
        print(f"{C_GREEN}🚀 TT Studio is ready!{C_RESET}")
        print(f"{C_GREEN}{'=' * 60}{C_RESET}")
        print(f"  URL:             {C_CYAN}http://localhost:3000{C_RESET}")
        if fastapi_enabled:
            print(f"  FastAPI:         {C_CYAN}http://localhost:8001{C_RESET}")
        if docker_control_enabled:
            print(f"  Docker Control:  {C_CYAN}http://localhost:8002{C_RESET}")

        # Active modes
        mode_parts = []
        if is_deployed_mode:
            mode_parts.append("AI Playground")
        else:
            mode_parts.append("Local")
        if args.dev:
            mode_parts.append("Dev")
        if detect_tt_hardware():
            mode_parts.append("TT Hardware")
        print(f"  Mode:            {' + '.join(mode_parts)}")

        print()
        print(f"{C_CYAN}📋 Logs:{C_RESET}")
        print(f"  Docker containers: cd app && docker compose logs -f")
        if fastapi_enabled:
            print(f"  FastAPI server:    tail -f {FASTAPI_LOG_FILE}")
        if docker_control_enabled:
            print(f"  Docker Control:    tail -f {DOCKER_CONTROL_LOG_FILE}")
        print()
        print(f"{C_YELLOW}🧹 Stop: python run.py --cleanup{C_RESET}")
        print(f"{C_GREEN}{'=' * 60}{C_RESET}")
        print()

        startup_log.step("startup_complete", "OK")
        startup_log.summary(exit_code=0)
        startup_log.close()

        # Wait for services if requested
        if args.wait_for_services:
            all_services_healthy = wait_for_all_services(
                skip_fastapi=args.skip_fastapi,
                is_deployed_mode=is_deployed_mode,
                skip_docker_control=args.skip_docker_control,
            )
            if not all_services_healthy:
                print(f"\n{C_RED}⛔ Not all services became healthy{C_RESET}")
                print(f"{C_CYAN}   Review logs above. Try: python run.py --cleanup && python run.py{C_RESET}")
                sys.exit(1)
        
        
        # Control browser open only if service is healthy
        if not args.no_browser:
            # Get configurable frontend settings
            host, port, timeout = get_frontend_config()
            
            # Use the new function that reuses existing infrastructure
            device_id_val = getattr(args, "device_id", 0)
            if not wait_for_frontend_and_open_browser(host, port, timeout, args.auto_deploy, device_id=device_id_val):
                auto_deploy_param = f"?auto-deploy={args.auto_deploy}&device-id={device_id_val}" if args.auto_deploy else ""
                print(f"\n{C_YELLOW}⚠️  Could not reach frontend at http://{host}:{port}{auto_deploy_param}{C_RESET}")
                print(f"{C_CYAN}💡 Run: {C_WHITE}python run.py --cleanup && python run.py{C_RESET}")
        else:
            host, port, _ = get_frontend_config()
            device_id_val = getattr(args, "device_id", 0)
            auto_deploy_param = f"?auto-deploy={args.auto_deploy}&device-id={device_id_val}" if args.auto_deploy else ""
            print(f"{C_BLUE}🌐 Automatic browser opening disabled. Access TT-Studio at: {C_CYAN}http://{host}:{port}{auto_deploy_param}{C_RESET}")
        
        # If in dev mode, show logs similar to startup.sh
        if args.dev:
            print(f"\n{C_YELLOW}📜 Tailing logs in development mode. Press Ctrl+C to stop.{C_RESET}")
            
            # Build the same Docker Compose command for logs
            docker_logs_cmd = build_docker_compose_command(dev_mode=args.dev)
            docker_logs_cmd.extend(["logs", "-f"])
            
            # Start Docker Compose logs in background
            docker_logs_process = subprocess.Popen(
                docker_logs_cmd,
                cwd=os.path.join(TT_STUDIO_ROOT, "app")
            )
            
            # Also check for FastAPI server logs
            fastapi_logs_process = None
            if not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_LOG_FILE):
                fastapi_logs_process = subprocess.Popen(["tail", "-f", FASTAPI_LOG_FILE])
            
            try:
                # Wait for Ctrl+C
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                print(f"\n{C_YELLOW}📜 Stopping log tailing...{C_RESET}")
            finally:
                # Clean up processes
                if docker_logs_process:
                    docker_logs_process.terminate()
                if fastapi_logs_process:
                    fastapi_logs_process.terminate()

    except KeyboardInterrupt:
        print(f"\n\n{C_YELLOW}🛑 Setup interrupted by user (Ctrl+C){C_RESET}")

        startup_log.step("interrupted", "FAIL", "Ctrl+C")
        startup_log.summary(exit_code=130)
        startup_log.close()

        # Build the original command with flags for resume suggestion
        original_cmd = "python run.py"
        if 'args' in locals():
            if args.dev:
                original_cmd += " --dev"
            if args.skip_fastapi:
                original_cmd += " --skip-fastapi"
            if args.no_sudo:
                original_cmd += " --no-sudo"
            if args.resync:
                original_cmd += " --resync"
        
        print(f"{C_CYAN}🔄 To resume setup later, run: {C_WHITE}{original_cmd}{C_RESET}")
        print(f"{C_CYAN}🧹 To clean up any partial setup: {C_WHITE}python run.py --cleanup{C_RESET}")
        print(f"{C_CYAN}❓ For help: {C_WHITE}python run.py --help{C_RESET}")
        sys.exit(130)
    except Exception as e:
        print(f"\n{C_RED}❌ An unexpected error occurred: {type(e).__name__}{C_RESET}")
        print(f"{C_RED}   {e}{C_RESET}")

        import traceback
        print(f"\n{C_YELLOW}Full error details:{C_RESET}")
        traceback.print_exc()

        startup_log.step("unhandled_exception", "FAIL", f"{type(e).__name__}: {e}")
        startup_log.summary(exit_code=1)
        startup_log.close()

        print(f"\n{C_CYAN}💡 Next steps:{C_RESET}")
        print(f"  • Check the error details above")
        print(f"  • Startup log: {STARTUP_LOG_FILE}")
        print(f"  • For help: python run.py --help")
        print(f"  • To clean up: python run.py --cleanup")
        print(f"  • Report bugs: https://github.com/tenstorrent/tt-studio/issues")
        sys.exit(1)

if __name__ == "__main__":
    main()
