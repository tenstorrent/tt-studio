# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker installation, access, command execution, and compose-command building."""

import os
import sys
import subprocess
import shutil
import getpass
from tt_setup.constants import *


# Official docs we point users to — we link rather than try to fix Docker for
# them or print shell commands (which are platform-specific and often wrong).
DOCKER_INSTALL_URL = "https://docs.docker.com/get-docker/"
DOCKER_COMPOSE_URL = "https://docs.docker.com/compose/install/"
DOCKER_DESKTOP_URL = "https://docs.docker.com/desktop/"
DOCKER_DAEMON_URL = "https://docs.docker.com/config/daemon/start/"


def _docker_compose_v2_available():
    """True if the `docker compose` (v2) plugin runs — with a sudo fallback for
    660 sockets. The space form (`docker compose`) only succeeds on v2; legacy
    `docker-compose` (v1) is a separate binary and intentionally not accepted."""
    res = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True, check=False)
    if res.returncode != 0 and "permission denied" in res.stderr.lower():
        res = subprocess.run(["sudo", "docker", "compose", "version"], capture_output=True, text=True, check=False)
    return res.returncode == 0


def check_docker_installation():
    """Gate startup on Docker + Docker Compose v2 being present and the daemon
    running. On any failure we point to the official docs and exit — we do not
    attempt to fix Docker or print start commands for the user."""
    # 1. Docker CLI installed?
    if not shutil.which("docker"):
        print(f"{C_RED}⛔ Docker is not installed.{C_RESET}")
        print(f"{C_YELLOW}   Docker (with Compose v2) is required to run TT Studio.{C_RESET}")
        print(f"{C_CYAN}   Install: {DOCKER_INSTALL_URL}{C_RESET}")
        sys.exit(1)

    # 2. Docker Compose v2 plugin present? (does not need the daemon, so it's
    #    validated up front regardless of daemon state).
    if not _docker_compose_v2_available():
        print(f"{C_RED}⛔ Docker Compose v2 is not available.{C_RESET}")
        print(f"{C_YELLOW}   TT Studio requires the `docker compose` (v2) plugin, not legacy `docker-compose`.{C_RESET}")
        print(f"{C_CYAN}   Install / upgrade: {DOCKER_COMPOSE_URL}{C_RESET}")
        sys.exit(1)

    # 3. Docker daemon running / reachable? (retry with sudo for 660 sockets).
    result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
    if result.returncode == 0:
        return  # daemon reachable without sudo

    if "permission denied" in result.stderr.lower():
        if subprocess.run(["sudo", "docker", "info"], capture_output=True, text=True, check=False).returncode == 0:
            return  # daemon reachable with sudo; TT Studio will use sudo when needed

    print(f"{C_RED}⛔ Docker is installed but its daemon isn't running.{C_RESET}")
    print(f"{C_YELLOW}   Start Docker, then re-run TT Studio.{C_RESET}")
    print(f"{C_CYAN}   Docker Desktop: {DOCKER_DESKTOP_URL}{C_RESET}")
    print(f"{C_CYAN}   Daemon docs:    {DOCKER_DAEMON_URL}{C_RESET}")
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
    compose_files = ["docker", "compose"]
    # Explicitly pass app/.env so the environment is loaded regardless of the
    # working directory (rather than relying on compose's implicit cwd auto-load).
    if os.path.exists(ENV_FILE_PATH):
        compose_files += ["--env-file", ENV_FILE_PATH]
    compose_files += ["-f", DOCKER_COMPOSE_FILE]

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
