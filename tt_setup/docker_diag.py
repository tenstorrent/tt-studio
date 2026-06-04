# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker/compose failure parsing and diagnostics."""

import sys
import subprocess
import time
import re
from datetime import datetime
from tt_setup.constants import *
from tt_setup.shell import clear_lines, copy_to_clipboard


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
