# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Port availability checks + freeing the process holding a port (Docker-safe)."""

import os
import sys
import subprocess
import time
import shutil
import re
import socket
from tt_setup.constants import *
from tt_setup.shell import run_command
from tt_setup.console import console, in_phase, is_verbose


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

