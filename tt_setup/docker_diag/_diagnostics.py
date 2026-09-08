# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker/compose failure parsing and diagnostics."""

import subprocess
import time
import re
from datetime import datetime
from rich.table import Table
from tt_setup.constants import *
from tt_setup.constants import _COMPOSE_SERVICE_LABEL
from tt_setup.shell import copy_to_clipboard
from tt_setup.console import console, events, notice_panel, show_detail


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
    console.print("\n[info]💡 Common solutions:[/info]")

    ctx = error_context.lower()
    if "build" in ctx:
        console.print("[muted]  • Check Dockerfile syntax and COPY/ADD source files[/muted]")
        console.print("[muted]  • Rebuild without cache: cd app && docker compose build --no-cache[/muted]")

    if "permission" in ctx or "denied" in ctx:
        console.print("[muted]  • Add user to docker group: sudo usermod -aG docker $USER[/muted]")
        console.print("[muted]  • Or run: python run.py --fix-docker[/muted]")

    if "port" in ctx or "address already in use" in ctx:
        console.print("[muted]  • Check port usage: lsof -i :8000[/muted]")
        console.print("[muted]  • Free ports: python run.py --stop[/muted]")

    # Always show these
    console.print("[muted]  • Check Docker is running: docker info[/muted]")
    console.print("[muted]  • Clean up and retry: python run.py --stop && python run.py[/muted]")


def suggest_pip_fixes():
    """Provide suggestions for pip installation errors."""
    console.print("\n[info]💡 Common solutions:[/info]")
    console.print("[muted]  • Check internet connectivity: ping pypi.org[/muted]")
    console.print("[muted]  • Upgrade pip: pip3 install --upgrade pip[/muted]")
    console.print("[muted]  • Clear pip cache: pip3 cache purge[/muted]")
    console.print("[muted]  • Check Python version compatibility[/muted]")


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


def classify_pull_failure(output):
    """Why `docker compose pull` failed, from its output.

    Returns one of 'unreachable' (no route to the registry), 'auth' (the
    registry wants a login), 'unpublished' (the tag simply isn't there — the
    normal case on an unmerged branch), or 'unknown'. Network trouble is checked
    first: an offline machine can also report a missing manifest, and "you're
    offline" is the more useful thing to say.
    """
    text = (output or "").lower()
    if not text.strip():
        return "unknown"
    if any(k in text for k in (
        "dial tcp", "no such host", "connection refused", "network is unreachable",
        "i/o timeout", "timeout exceeded", "tls handshake", "temporary failure in name resolution",
        "server misbehaving", "certificate", "proxyconnect",
    )):
        return "unreachable"
    if any(k in text for k in (
        "unauthorized", "authentication required", "denied", "forbidden",
        "login prior to", "insufficient_scope",
    )):
        return "auth"
    if any(k in text for k in (
        "not found", "manifest unknown", "no such manifest", "does not exist",
        "name unknown", "notfound",
    )):
        return "unpublished"
    return "unknown"


def verify_docker_containers(use_sudo=False):
    """
    Verify that the Compose stack started successfully.

    Returns dict {container_name: {'status': str, 'running': bool,
    'service': str}} or empty dict on error.
    """
    try:
        # The label filter excludes marketplace apps and model deployments (started
        # outside Compose); the name filter excludes any other Compose project on the
        # same host. The label's value rides along so diagnostics can name the service.
        cmd = ["docker", "ps", "-a",
               "--filter", "name=tt_studio",
               "--filter", f"label={_COMPOSE_SERVICE_LABEL}",
               "--format", f'{{{{.Names}}}}\t{{{{.Label "{_COMPOSE_SERVICE_LABEL}"}}}}\t{{{{.Status}}}}']
        if use_sudo:
            cmd = ["sudo"] + cmd

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            console.print("[error]⛔ Error: Failed to list Docker containers[/error]")
            if result.stderr:
                console.print(f"[muted]   {result.stderr}[/muted]")
            return {}

        containers = {}
        for line in result.stdout.strip().split('\n'):
            parts = line.split('\t')
            if len(parts) == 3:
                name, service, status = parts
                containers[name] = {
                    'status': status,
                    'running': status.startswith('Up'),
                    'service': service,
                }

        if not containers:
            console.print("[warning]⚠️  No tt_studio containers found[/warning]")

        return containers

    except FileNotFoundError:
        console.print("[error]⛔ Error: Could not check containers. Ensure Docker is installed and in PATH[/error]")
        return {}
    except Exception as e:
        console.print(f"[error]⛔ Error verifying containers: {type(e).__name__}: {e}[/error]")
        return {}


def diagnose_container_failure(container_name, exit_code, logs):
    """
    Analyze a container failure and return structured diagnosis.
    Returns dict with keys: severity, cause, detail, action.
    """
    # Exit code classification
    if exit_code == 0:
        return {
            'severity': 'warning',
            'cause': 'Exited cleanly',
            'detail': f"{container_name} stopped on its own without an error (exit 0), so the stack is incomplete.",
            'action': f"Run: docker logs {container_name} --tail 50\n  Then: python run.py --stop && python run.py",
        }
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
            'action': f"Run: lsof -i{port_hint or ''}\n  Or: python run.py --stop && python run.py",
        }

    if "modulenotfounderror" in log_lower or "importerror" in log_lower:
        module_match = re.search(r"No module named '([^']+)'", logs or "")
        module_hint = f" ({module_match.group(1)})" if module_match else ""
        return {
            'severity': 'critical',
            'cause': f'Missing Python module{module_hint}',
            'detail': f"{container_name} failed to import a required module. Docker image may be stale.",
            'action': "Rebuild: python run.py --stop && python run.py",
        }

    if "keyerror" in log_lower:
        key_match = re.search(r"KeyError: '?([^'\n]+)'?", logs or "")
        key_hint = f" (key: {key_match.group(1)})" if key_match else ""
        return {
            'severity': 'critical',
            'cause': f'Configuration key missing{key_hint}',
            'detail': f"{container_name} encountered a missing env var or config key.",
            'action': "Check .env for missing variables. Run: python run.py --reconfigure",
        }

    if "permission denied" in log_lower or "permissionerror" in log_lower:
        return {
            'severity': 'critical',
            'cause': 'Permission denied',
            'detail': f"{container_name} was denied file/socket access. Common: persistent volume owned by root.",
            'action': "Fix ownership: sudo chown -R $USER:$USER tt_studio_persistent_volume\n  Or: python run.py --purge-all && python run.py",
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


_SERVICE_FRIENDLY_NAMES = {
    'tt_studio_backend': 'Backend',
    'tt_studio_frontend': 'Frontend',
    'tt_studio_agent': 'Agent',
    'tt_studio_chroma': 'ChromaDB',
    'tt_studio_litellm': 'LiteLLM gateway',
}


def _friendly_container_name(name, info=None):
    """Human label for a container, keyed on its Compose *service* name.

    The table is keyed on service names, but every container name carries a mode
    suffix (`tt_studio_frontend_dev`/`_prod`), so the previous raw-name lookup
    matched nothing in any mode and always fell through to the container name.
    Falls back to the service name, then the container name.
    """
    service = (info or {}).get('service') or ''
    return _SERVICE_FRIENDLY_NAMES.get(service) or service or name


def print_container_diagnostics(containers):
    """Print diagnostic info for failed containers with smart diagnosis."""
    failed = {name: info for name, info in containers.items() if not info['running']}
    if not failed:
        return

    console.print("\n[error]⚠️  Some containers failed to start:[/error]")
    failed_table = Table(box=None, show_header=True, header_style="bold")
    failed_table.add_column("Container")
    failed_table.add_column("Status")
    for name, info in failed.items():
        friendly = _friendly_container_name(name, info)
        failed_table.add_row(f"[warning]{friendly} ({name})[/warning]", info['status'])
    console.print(failed_table)

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
        style = "error" if diagnosis['severity'] == 'critical' else "warning"
        friendly = _friendly_container_name(name, failed[name])
        lines = [
            f"[{style}]{diagnosis['detail']}[/{style}]",
            "",
            "[info]Recommended:[/info]",
        ]
        lines.extend(f"[muted]  {action_line}[/muted]" for action_line in diagnosis['action'].splitlines())
        console.print(notice_panel(
            f"[bold {style}]Diagnosis for {friendly}: {diagnosis['cause']}[/bold {style}]",
            lines,
            border_style="error",
        ))
        events.emit_error(f"{friendly} container failed: {diagnosis['cause']}",
                          remediation=diagnosis['action'], container=name)


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
            console.print("[error]⛔ Could not verify container status[/error]")
            suggest_docker_fixes("Container verification")
            return False

        failed_any = any(not info['running'] for info in containers.values())
        if failed_any:
            console.print(notice_panel(
                "[error]⛔ CONTAINER STARTUP FAILED[/error]",
                ["[error]One or more containers failed to start.[/error]"],
                border_style="error",
            ))
            print_container_diagnostics(containers)
            suggest_docker_fixes("Container startup")

            failed_names = [n for n, i in containers.items() if not i['running']]
            error_log = f"TT STUDIO CONTAINER FAILURE\nTimestamp: {datetime.now().isoformat()}\nFailed: {', '.join(failed_names)}\n"
            copy_to_clipboard(error_log)
            return False

        if show_detail():   # the collapsed Build phase line is the done signal
            console.print("[success]✅ All containers built and running[/success]")
        return True

    # Build failed
    container_name, friendly_name, error_section = parse_docker_build_failure(full_output)

    if friendly_name:
        header_title = f"[error]⛔ BUILD FAILED: {friendly_name} Container ({container_name})[/error]"
    else:
        header_title = "[error]⛔ DOCKER COMPOSE BUILD FAILED[/error]"

    header_lines = []
    if error_section:
        header_lines.append("[error]Error details:[/error]")
        header_lines.append(f"[muted]{error_section}[/muted]")
    else:
        header_lines.append("[muted]The docker compose build did not complete.[/muted]")
    console.print(notice_panel(header_title, header_lines, border_style="error"))
    events.emit_error(
        f"docker compose build failed ({friendly_name or container_name or 'unknown container'})",
        remediation="cd app && docker compose build --no-cache, then re-run python run.py",
        exit_code=returncode)

    # Check which containers exist/failed
    containers = verify_docker_containers(use_sudo=use_sudo)
    if containers:
        console.print("\n[warning]Container status:[/warning]")
        status_table = Table(box=None, show_header=True, header_style="bold")
        status_table.add_column("Container")
        status_table.add_column("Status")
        for name, info in containers.items():
            if info['running']:
                status_table.add_row(f"[success]✓ {name}[/success]", f"[success]{info['status']}[/success]")
            else:
                status_table.add_row(f"[error]❌ {name}[/error]", f"[error]{info['status']}[/error]")
        console.print(status_table)

    suggest_docker_fixes("Docker build")

    sudo_prefix = "sudo " if use_sudo else ""
    console.print("\n[info]📋 Debug commands:[/info]")
    console.print(f"[muted]  {sudo_prefix}cd app && docker compose build --no-cache[/muted]")
    if container_name:
        console.print(f"[muted]  {sudo_prefix}docker logs {container_name}[/muted]")

    # Clipboard
    error_log = f"TT STUDIO BUILD FAILURE\nTimestamp: {datetime.now().isoformat()}\nFailed: {container_name or 'unknown'}\nExit: {returncode}\n"
    if error_section:
        error_log += f"\n{error_section}\n"
    if copy_to_clipboard(error_log):
        console.print("\n[success]📋 Error log copied to clipboard[/success]")

    return False
