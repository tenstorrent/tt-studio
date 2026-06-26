# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker installation, access, command execution, and compose-command building."""

import os
import sys
import subprocess
import shutil
import getpass
from tt_setup.constants import *
from tt_setup.console import console, step, notice_panel


# Official docs we point users to — we link rather than try to fix Docker for
# them or print shell commands (which are platform-specific and often wrong).
DOCKER_INSTALL_URL = "https://docs.docker.com/get-docker/"
DOCKER_COMPOSE_URL = "https://docs.docker.com/compose/install/"
DOCKER_DESKTOP_URL = "https://docs.docker.com/desktop/"
DOCKER_DAEMON_URL = "https://docs.docker.com/config/daemon/start/"


def _docker_compose_v2_available():
    """True if the `docker compose` (v2) plugin runs — with a sudo fallback for
    660 sockets. The space form (`docker compose`) only succeeds on v2; legacy
    `docker-compose` (v1) is a separate binary and intentionally not accepted.

    We additionally assert a major version of >= 2 from `--short` so that a
    podman/compatibility shim which answers the subcommand with a non-v2 banner
    is rejected rather than mistaken for genuine Compose v2."""
    res = subprocess.run(["docker", "compose", "version", "--short"], capture_output=True, text=True, check=False)
    if res.returncode != 0 and "permission denied" in res.stderr.lower():
        res = subprocess.run(["sudo", "docker", "compose", "version", "--short"], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        return False
    # `--short` prints a bare semver like "2.27.0" (sometimes "v2.27.0").
    token = res.stdout.strip().lstrip("vV").split()[-1] if res.stdout.strip() else ""
    head = token.split(".", 1)[0]
    if head.isdigit():
        return int(head) >= 2
    # Couldn't parse a version (unexpected output): fall back to the original,
    # looser contract (subcommand resolved) to avoid false negatives on genuine
    # Docker whose `--short` formatting we didn't anticipate.
    return True


def _detect_podman_as_docker():
    """Detect whether the `docker` command is actually podman (the
    `podman-docker` shim), using only *positive* podman signals so that genuine
    Docker and its drop-in replacements (Docker Desktop, Colima, OrbStack,
    Rancher Desktop in dockerd/moby mode) are never flagged.

    Signal 1 (cheapest, daemon-independent): `docker --version` — capture both
    stdout and stderr. The podman binary prints `podman version X.Y.Z` and the
    `podman-docker` wrapper prints `Emulate Docker CLI using podman.` to stderr.
    Genuine Docker prints `Docker version ...` and nothing on stderr.

    Signal 2 (daemon-dependent, robust): `docker info` — podman's server reports
    a `Podman Engine` / `PodmanAPIVersion:` block that genuine Docker never has,
    and `--format '{{.ServerVersion}}'` returns the podman version. We reuse the
    permission-denied sudo fallback used elsewhere.

    Returns True only on a positive podman signal; never on the mere *absence*
    of a Docker signal."""
    # Signal 1: version string / emulate banner.
    res = subprocess.run(["docker", "--version"], capture_output=True, text=True, check=False)
    blob = f"{res.stdout}\n{res.stderr}".lower()
    if "podman" in blob:
        return True

    # Signal 2: server engine identity (needs a reachable daemon).
    info = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
    if info.returncode != 0 and "permission denied" in info.stderr.lower():
        info = subprocess.run(["sudo", "docker", "info"], capture_output=True, text=True, check=False)
    info_blob = f"{info.stdout}\n{info.stderr}".lower()
    # Match only the unique `PodmanAPIVersion` field, not a bare "podman"
    # substring — the latter can appear in a genuine-Docker host's name or a
    # configured registry mirror and would false-positive. Signal 1 already
    # catches the binary/wrapper banner.
    if "podmanapiversion" in info_blob:
        return True

    return False


def check_docker_installation():
    """Gate startup on Docker + Docker Compose v2 being present and the daemon
    running. On any failure we point to the official docs and exit — we do not
    attempt to fix Docker or print start commands for the user."""
    # 1. Docker CLI installed?
    if not shutil.which("docker"):
        console.print("[error]⛔ Docker is not installed.[/error]")
        console.print("[warning]   Docker (with Compose v2) is required to run TT Studio.[/warning]")
        console.print(f"[info]   Install: {DOCKER_INSTALL_URL}[/info]")
        sys.exit(1)

    # 1b. Is `docker` actually podman (the podman-docker shim)? This is a strong
    #     WARNING, not fatal — the podman path may limp along, so we let the user
    #     proceed at their own risk rather than blocking them. Run before the
    #     daemon gate so the version/banner signal still fires when it's down.
    if _detect_podman_as_docker():
        console.print()
        console.print(notice_panel(
            "[warning]⚠️  Podman detected — TT Studio needs genuine Docker[/warning]",
            [
                "[info]Your 'docker' command is provided by Podman (podman-docker), not Docker Engine.[/info]",
                "[info]TT Studio relies on Docker (Moby/dockerd) + the Docker Compose v2 plugin; the[/info]",
                "[info]podman / podman-compose shim is not fully compatible and causes confusing failures.[/info]",
                "",
                f"[info]Install genuine Docker + Compose v2:  {DOCKER_INSTALL_URL}[/info]",
                f"[info]Compose v2 plugin:                    {DOCKER_COMPOSE_URL}[/info]",
                "",
                "[muted]Compatible alternatives that ARE genuine Docker: Docker Desktop, Colima,[/muted]",
                "[muted]OrbStack, Rancher Desktop in dockerd/moby mode.[/muted]",
                "",
                "[warning]Continuing anyway — proceed at your own risk.[/warning]",
            ],
            border_style="warning",
        ))
        console.print()

    # 2. Docker Compose v2 plugin present? (does not need the daemon, so it's
    #    validated up front regardless of daemon state).
    if not _docker_compose_v2_available():
        console.print("[error]⛔ Docker Compose v2 is not available.[/error]")
        console.print("[warning]   TT Studio requires the `docker compose` (v2) plugin, not legacy `docker-compose`.[/warning]")
        console.print(f"[info]   Install / upgrade: {DOCKER_COMPOSE_URL}[/info]")
        sys.exit(1)

    # 3. Docker daemon running / reachable? (retry with sudo for 660 sockets).
    result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
    if result.returncode == 0:
        return  # daemon reachable without sudo

    if "permission denied" in result.stderr.lower():
        if subprocess.run(["sudo", "docker", "info"], capture_output=True, text=True, check=False).returncode == 0:
            return  # daemon reachable with sudo; TT Studio will use sudo when needed

    console.print("[error]⛔ Docker is installed but its daemon isn't running.[/error]")
    console.print("[warning]   Start Docker, then re-run TT Studio.[/warning]")
    console.print(f"[info]   Docker Desktop: {DOCKER_DESKTOP_URL}[/info]")
    console.print(f"[info]   Daemon docs:    {DOCKER_DAEMON_URL}[/info]")
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
            console.print("[warning]⚠️  Permission denied, retrying with sudo (you may be prompted for password)...[/warning]")
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

        console.print()
        console.print(notice_panel(
            "[warning]🔒 Docker Socket Access Issue[/warning]",
            [
                f"[info]The Docker socket requires group membership: {socket_group}[/info]",
                "",
                "[success]To fix this, run:[/success]",
                f"   [info]sudo usermod -aG {socket_group} $USER[/info]",
                f"   [info]newgrp {socket_group}[/info]",
                "",
                "[warning]Or continue with sudo access (commands will prompt for password)[/warning]",
            ],
            border_style="warning",
        ))
        console.print()

        return False
    except Exception as e:
        console.print(f"[warning]⚠️  Could not check Docker socket permissions: {e}[/warning]")
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
                console.print("[muted]🚀 Applying development mode overrides...[/muted]")
    else:
        if os.path.exists(DOCKER_COMPOSE_PROD_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_PROD_FILE])
            if not quiet:
                console.print("[success]🚀 Applying production mode overrides...[/success]")

    if detect_tt_hardware():
        if os.path.exists(DOCKER_COMPOSE_TT_HARDWARE_FILE):
            compose_files.extend(["-f", DOCKER_COMPOSE_TT_HARDWARE_FILE])
            if show_hardware_info and not quiet:
                console.print("[success]✅ Tenstorrent hardware detected - enabling hardware support[/success]")
        else:
            if show_hardware_info and not quiet:
                console.print(f"[warning]⚠️  TT hardware detected but override file not found: {DOCKER_COMPOSE_TT_HARDWARE_FILE}[/warning]")
    else:
        if show_hardware_info and not quiet:
            console.print("[warning]⚠️  No Tenstorrent hardware detected[/warning]")

    return compose_files


def fix_docker_issues():
    """Automatically fix common Docker service and permission issues."""
    console.print("\n[bold accent]🔧 Docker fix utility[/bold accent]")

    try:
        # Step 1: Start Docker service
        with step("Starting Docker service", spinner=False) as s:
            result = subprocess.run(["sudo", "service", "docker", "start"],
                                  capture_output=True, text=True, check=False)

            if result.returncode == 0:
                s.detail("started successfully")
            else:
                detail = f"returned code {result.returncode}"
                if result.stderr:
                    detail += f" — {result.stderr.strip()}"
                s.detail(detail)

        # Step 2: Determine socket group and provide guidance
        console.print("\n[info]🔒 Checking Docker socket permissions...[/info]")
        try:
            import grp
            socket_stat = os.stat("/var/run/docker.sock")
            socket_group = grp.getgrgid(socket_stat.st_gid).gr_name
            current_user = getpass.getuser()

            console.print(f"[info]Docker socket group: {socket_group}[/info]")
            console.print("\n[warning]Choose permission fix method:[/warning]")
            console.print(f"  [success]1)[/success] Add user to {socket_group} group (recommended, secure)")
            console.print("  [success]2)[/success] Set socket to 666 (quick fix, less secure)")
            console.print("  [success]3)[/success] Keep current permissions and use sudo for Docker commands")

            console.print()
            try:
                choice = input("Enter choice (1-3) [1]: ").strip() or "1"
            except KeyboardInterrupt:
                console.print("\n[warning]⚠️  Cancelled by user[/warning]")
                return False

            if choice == "1":
                console.print(f"\n[info]Adding user '{current_user}' to '{socket_group}' group...[/info]")
                group_result = subprocess.run(["sudo", "usermod", "-aG", socket_group, current_user],
                                            capture_output=True, text=True, check=False)

                if group_result.returncode == 0:
                    console.print(f"[success]✅ User added to {socket_group} group[/success]")
                    console.print("\n[warning]⚠️  IMPORTANT: You need to log out and log back in for group changes to take effect[/warning]")
                    console.print("[info]Or run this command to apply changes in current session:[/info]")
                    console.print(f"   [bold]newgrp {socket_group}[/bold]")
                else:
                    console.print(f"[error]❌ Failed to add user to group: {group_result.stderr.strip() if group_result.stderr else 'Unknown error'}[/error]")
                    return False

            elif choice == "2":
                console.print("\n[warning]⚠️  Setting socket permissions to 666 (less secure)[/warning]")
                socket_result = subprocess.run(["sudo", "chmod", "666", "/var/run/docker.sock"],
                                             capture_output=True, text=True, check=False)

                if socket_result.returncode == 0:
                    console.print("[success]✅ Docker socket permissions set to 666[/success]")
                    console.print("[warning]Note: To reset to secure 660, run: sudo chmod 660 /var/run/docker.sock[/warning]")
                else:
                    console.print(f"[error]❌ Failed to set permissions: {socket_result.stderr.strip() if socket_result.stderr else 'Unknown error'}[/error]")
                    return False

            elif choice == "3":
                console.print("\n[success]✅ Keeping current permissions[/success]")
                console.print("[warning]TT Studio will use sudo for Docker commands when needed[/warning]")

            else:
                console.print("[error]❌ Invalid choice[/error]")
                return False

        except Exception as e:
            console.print(f"[warning]⚠️  Could not check socket permissions: {e}[/warning]")
            console.print("[warning]Defaulting to 666 permissions...[/warning]")
            socket_result = subprocess.run(["sudo", "chmod", "666", "/var/run/docker.sock"],
                                         capture_output=True, text=True, check=False)
            if socket_result.returncode == 0:
                console.print("[success]✅ Docker socket permissions set to 666[/success]")

        # Step 3: Test Docker connectivity
        with step("Testing Docker connectivity", spinner=False) as s:
            test_result = subprocess.run(["docker", "info"],
                                       capture_output=True, text=True, check=False)
            if test_result.returncode != 0:
                s.fail()

        if test_result.returncode != 0:
            console.print(notice_panel(
                "[error]❌ Docker connectivity test failed[/error]",
                [
                    f"[warning]Error: {test_result.stderr.strip()}[/warning]" if test_result.stderr else "[warning]No additional error output.[/warning]",
                    "",
                    "[warning]You may need to manually troubleshoot Docker installation.[/warning]",
                ],
                border_style="error",
            ))
            return False

    except FileNotFoundError:
        console.print(notice_panel(
            "[error]❌ Docker fix failed[/error]",
            [
                "[error]'sudo' or 'docker' command not found[/error]",
                "[warning]Please ensure Docker is installed and sudo is available.[/warning]",
            ],
            border_style="error",
        ))
        return False
    except Exception as e:
        console.print(notice_panel(
            "[error]❌ Docker fix failed[/error]",
            [f"[error]Unexpected error during Docker fix: {e}[/error]"],
            border_style="error",
        ))
        return False

    console.print(notice_panel(
        "[bold success]🎉 Docker fix completed successfully![/bold success]",
        [
            "[success]✅ Docker is working correctly![/success]",
            "[info]You can now run: [bold]python run.py[/bold][/info]",
        ],
        border_style="success",
    ))
    return True
