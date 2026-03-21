# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import re
import socket
import subprocess
import shutil
import time

from _runner.constants import (
    C_RESET, C_RED, C_GREEN, C_YELLOW, C_BLUE, C_CYAN,
)
from _runner.utils import run_command


class PortManager:
    def __init__(self, ctx):
        self.ctx = ctx

    def check_port_available(self, port):
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

    def check_and_free_ports(self, ports, no_sudo=False):
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
            print(f"{C_BLUE}🔍 Checking if port {port} is available for {service_name}...{C_RESET}")
            if not self.check_port_available(port):
                print(f"{C_YELLOW}⚠️  Port {port} is already in use. Attempting to free the port...{C_RESET}")
                if not self.kill_process_on_port(port, no_sudo=no_sudo):
                    print(f"{C_RED}❌ Failed to free port {port} for {service_name}{C_RESET}")
                    failed_ports.append((port, service_name))
                else:
                    print(f"{C_GREEN}✅ Port {port} is now available{C_RESET}")
            else:
                print(f"{C_GREEN}✅ Port {port} is available{C_RESET}")

        return (len(failed_ports) == 0, failed_ports)

    def kill_process_on_port(self, port, no_sudo=False):
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

            # Run command but don't exit on failure
            result = run_command(cmd_to_run, check=False, capture_output=True)

            if result.returncode == 0 and result.stdout.strip():
                if "ss" in base_cmd[0]: # ss needs parsing
                    match = re.search(r'pid=(\d+)', result.stdout.strip())
                    return match.group(1) if match else None
                else: # lsof directly returns PID
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
            print(f"{C_YELLOW}⚠️  Could not find a specific process using port {port}. This is likely okay.{C_RESET}")
            return True

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
            run_command(kill_cmd_graceful, check=False)
            time.sleep(2)

            result = run_command(check_alive_cmd, check=False, capture_output=True)
            if result.returncode == 0:
                print(f"⚠️  Process {pid} still alive. Forcing termination...")
                run_command(kill_cmd_force, check=True)
                print(f"{C_GREEN}✅ Process {pid} terminated by force.{C_RESET}")
            else:
                print(f"{C_GREEN}✅ Process {pid} terminated gracefully.{C_RESET}")

        except Exception as e:
            print(f"{C_RED}⛔ Failed to kill process {pid}: {e}{C_RESET}")
            print(f"{C_YELLOW}   You may need to stop it manually. Try: {' '.join(kill_cmd_force)}{C_RESET}")
            return False

        return True
