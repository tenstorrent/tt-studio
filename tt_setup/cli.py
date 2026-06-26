# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Argument parsing and main() orchestration entrypoint."""

import os
import shutil
import sys
import subprocess
import time
import typer
from types import SimpleNamespace
from datetime import datetime
from tt_setup.startup_checks import check_startup_freshness
from tt_setup.console import begin_phase, console, end_phase, is_verbose, notice_panel, ready_panel, set_verbose, show_detail, step, stop_active_phase
from tt_setup.constants import *
from tt_setup.logging import startup_log
from tt_setup.shell import check_tt_smi, clear_lines, display_welcome_banner, run_preflight_checks
from tt_setup.docker_diag import handle_docker_compose_result, run_docker_compose_with_progress, suggest_pip_fixes
from tt_setup.docker import build_docker_compose_command, check_docker_access, check_docker_installation, detect_tt_hardware, fix_docker_issues
from tt_setup.env_config import configure_environment_sequentially, get_env_var, parse_boolean_env, save_setup_config, set_app_version_env
from tt_setup.cleanup import cleanup_resources
from tt_setup.services import check_and_free_ports, ensure_frontend_dependencies, get_frontend_config, setup_fastapi_environment, start_docker_control_service, start_fastapi_server, wait_for_all_services, wait_for_frontend_and_open_browser
from tt_setup.inference_server import _sync_model_catalog, setup_tt_inference_server
from tt_setup.spdx import add_spdx_headers, check_spdx_headers


app = typer.Typer(
    add_completion=True,
    rich_markup_mode="rich",
    context_settings={"help_option_names": ["-h", "--help"]},
    help="🚀 TT Studio Setup Script — environment, Docker services, and TT Inference Server.",
)


@app.callback(invoke_without_command=True)
def _entry(
    dev: bool = typer.Option(False, "--dev", help="Development mode (hot-reload, suggested defaults)."),
    stop: bool = typer.Option(False, "--stop", help="Stop TT Studio: tear down Docker containers and networks."),
    purge_all: bool = typer.Option(False, "--purge-all", help="Stop and wipe everything incl. persistent data and .env."),
    cleanup: bool = typer.Option(False, "--cleanup", hidden=True, help="Deprecated alias for --stop."),
    cleanup_all: bool = typer.Option(False, "--cleanup-all", hidden=True, help="Deprecated alias for --purge-all."),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip the --purge-all confirmation prompt."),
    help_env: bool = typer.Option(False, "--help-env", help="Show detailed environment-variables help."),
    reconfigure: bool = typer.Option(False, "--reconfigure", help="Reset preferences and reconfigure all options."),
    reconfigure_inference_server: bool = typer.Option(False, "--reconfigure-inference-server", help="Reconfigure the TT Inference Server artifact."),
    resync: bool = typer.Option(False, "--resync", help="Force resync of the model catalog."),
    pull_branch: bool = typer.Option(False, "--pull-branch", help="Re-download the inference artifact from its branch."),
    skip_fastapi: bool = typer.Option(False, "--skip-fastapi", help="Skip TT Inference Server FastAPI setup."),
    skip_docker_control: bool = typer.Option(False, "--skip-docker-control", help="Skip the Docker Control Service."),
    no_sudo: bool = typer.Option(False, "--no-sudo", help="Skip sudo usage (may limit functionality)."),
    no_browser: bool = typer.Option(False, "--no-browser", help="Skip automatic browser opening."),
    wait_for_services: bool = typer.Option(False, "--wait-for-services", help="Wait for all services to be healthy."),
    browser_timeout: int = typer.Option(60, "--browser-timeout", help="Seconds to wait for frontend before opening browser."),
    add_headers: bool = typer.Option(False, "--add-headers", help="Add missing SPDX license headers (excludes frontend)."),
    check_headers: bool = typer.Option(False, "--check-headers", help="Check for missing SPDX license headers."),
    auto_deploy: str = typer.Option(None, "--auto-deploy", metavar="MODEL_NAME", help="Auto-deploy the given model after startup."),
    device_id: int = typer.Option(0, "--device-id", metavar="CHIP_ID", help="Chip slot index (0-7) for --auto-deploy."),
    fix_docker: bool = typer.Option(False, "--fix-docker", help="Automatically fix Docker service/permission issues."),
    configure_env: bool = typer.Option(False, "--configure-env", help="Interactively configure all environment variables."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show full per-phase output instead of the calm summary."),
):
    """Set up and launch TT Studio. With no flags, runs the default minimal setup."""
    set_verbose(verbose)

    # --cleanup/--cleanup-all are deprecated aliases for --stop/--purge-all.
    # Warn, then normalize all four onto the internal cleanup/cleanup_all flags.
    if cleanup or cleanup_all:
        legacy = "--cleanup-all" if cleanup_all else "--cleanup"
        replacement = "--purge-all" if cleanup_all else "--stop"
        console.print(f"[warning]⚠  {legacy} is deprecated; use {replacement} instead.[/warning]")
    full_teardown = purge_all or cleanup_all
    stop_requested = stop or cleanup or full_teardown

    args = SimpleNamespace(
        dev=dev, cleanup=stop_requested, cleanup_all=full_teardown, yes=yes, help_env=help_env,
        reconfigure=reconfigure, reconfigure_inference_server=reconfigure_inference_server,
        resync=resync, pull_branch=pull_branch, skip_fastapi=skip_fastapi,
        skip_docker_control=skip_docker_control, no_sudo=no_sudo, no_browser=no_browser,
        wait_for_services=wait_for_services, browser_timeout=browser_timeout,
        add_headers=add_headers, check_headers=check_headers, auto_deploy=auto_deploy,
        device_id=device_id, fix_docker=fix_docker, configure_env=configure_env,
    )
    _run(args)


def _run(args):
    """Orchestrate setup for the parsed arguments."""
    try:
        
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
  {C_CYAN}python run.py{C_RESET}                        Default setup - minimal prompts, only HF_TOKEN required
  {C_CYAN}python run.py --configure-env{C_RESET}        Interactively configure all environment variables
  {C_CYAN}python run.py --dev{C_RESET}                  Development mode with defaults
  {C_CYAN}python run.py --reconfigure{C_RESET}          Reset preferences and reconfigure
  {C_CYAN}python run.py --stop{C_RESET}                 Stop containers only (keeps your data)
  {C_CYAN}python run.py --purge-all{C_RESET}            Full teardown (wipe data + config)
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
        
        display_welcome_banner(dev_mode=args.dev)
        freshness = check_startup_freshness(TT_STUDIO_ROOT, get_env_var)

        # Block startup only on release branches (main/dev/tt_qb2_launch_branch/
        # rc-*/release-*). Feature branches just warn and continue so dev work
        # isn't interrupted by stale remote tracking.
        # Hard-stop on release branches that are behind origin. The warning
        # itself (with the git pull hint) is already printed by startup_checks.
        if freshness.get("tt_studio_behind") and freshness.get("tt_studio_branch_is_release"):
            print(f"\n{C_RED}⛔ Stopping: release branch must be in sync with origin.{C_RESET}")
            startup_log.summary(exit_code=1)
            startup_log.close()
            sys.exit(1)

        # Outdated artifact: warning + "auto-fetching" hint are already in
        # startup_checks; just flip the flag so the download runs.
        if freshness.get("artifact_behind") and not args.pull_branch:
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

        # ── Phase 1 · Checks ─────────────────────────────────────────────────
        ph = begin_phase(1, 5, "Checks")

        ph.set("system checks")
        startup_log.step("preflight_checks", "START")
        run_preflight_checks()
        startup_log.step("preflight_checks", "OK")

        # tt-smi health probe — non-fatal. Skips silently when tt-smi isn't on
        # PATH (e.g. a Mac dev box with no TT tooling).
        if shutil.which("tt-smi"):
            ph.set("tt-smi")
            startup_log.step("tt_smi_check", "START")
            tt_status, tt_detail = check_tt_smi()
            if tt_status == "ok":
                startup_log.step("tt_smi_check", "OK", tt_detail)
            else:
                startup_log.step("tt_smi_check", "WARN", tt_detail)
                with ph.pause():  # surface the warning panel without the spinner
                    console.print(notice_panel(
                        "[bold]⚠  tt-smi may not be working[/bold]",
                        ["Couldn't read Tenstorrent devices via tt-smi — your TT tooling or board may need attention.",
                         "Support: https://docs.tenstorrent.com/systems/quietbox/quietbox-bh-2/support-bh-2.html"],
                        border_style="warning"))

        ph.set("Docker")
        startup_log.step("docker_install_check", "START")
        check_docker_installation()
        startup_log.step("docker_install_check", "OK")
        end_phase(ph)

        # ── Phase 2 · Configure ──────────────────────────────────────────────
        ph = begin_phase(2, 5, "Configure")
        ph.set("environment")
        startup_log.step("configure_environment", "START")
        with ph.pause():  # interactive: secret prompts + HF-access output must show live
            configure_environment_sequentially(dev_mode=args.dev, force_reconfigure=args.reconfigure, quick_setup=not args.configure_env, reconfigure_inference=args.reconfigure_inference_server)
        startup_log.step("configure_environment", "OK")

        # Save quick-setup configuration snapshot to JSON if not in --configure-env mode
        if not args.configure_env:
            setup_config = {
                "mode": "quick",
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
            save_setup_config(setup_config)

        # Create persistent storage directory
        host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
        ph.set("persistent storage")
        if host_persistent_volume and not os.path.isdir(host_persistent_volume):
            os.makedirs(host_persistent_volume, exist_ok=True)
            # Only set permissions on newly created directory (we own it).
            # Existing subdirectories are handled by Docker via docker-entrypoint.sh.
            try:
                os.chmod(host_persistent_volume, 0o777)
            except (OSError, PermissionError) as e:
                with ph.pause():
                    console.print(f"[warning]⚠️  Could not set permissions on persistent volume: {e}[/warning]")
                    console.print("[muted]   Docker containers will handle permissions via docker-entrypoint.sh[/muted]")

        # Create Docker network. Suspend the phase spinner: this may prompt for a
        # sudo password and prints its own status/errors.
        ph.set("Docker network")
        ph.suspend()
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
                        print(f"{C_YELLOW}   Docker is installed but its daemon isn't running. Start Docker, then re-run.{C_RESET}")
                        print(f"{C_CYAN}   Docker Desktop: https://docs.docker.com/desktop/{C_RESET}")
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
                print(f"{C_YELLOW}   Docker is installed but its daemon isn't running. Start Docker, then re-run.{C_RESET}")
                print(f"{C_CYAN}   Docker Desktop: https://docs.docker.com/desktop/{C_RESET}")
            else:
                print(f"{C_YELLOW}Docker network listing failed: {e.stderr if e.stderr else 'Unknown error'}{C_RESET}")
                print(f"{C_YELLOW}Please check your Docker installation and try again.{C_RESET}")

            sys.exit(1)
        ph.resume()

        # Ensure frontend dependencies are installed (may prompt for npm install)
        ph.set("frontend dependencies")
        ph.suspend()
        ensure_frontend_dependencies(force_prompt=args.reconfigure, quick_setup=not args.configure_env)

        # The rest of Set up (ports, permission fixes, services, artifact) is
        # interactive / sudo-prone and prints its own status — keep the spinner
        # suspended through it. The phase still collapses to one ✓ line at the end.
        ph.set("ports & permissions")
        # (spinner stays suspended from the frontend-deps step above)

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

        # Ensure model_run_logs/ exists and is owned by the invoking user before
        # inference-api writes per-deployment log files into it. If a prior
        # sudo'd process created this dir, writes from the non-root uvicorn
        # process will fail with EACCES (see inference-api/api.py:get_model_run_logs_dir).
        model_run_logs_dir = MODEL_RUN_LOGS_DIR
        if not os.path.exists(model_run_logs_dir):
            try:
                os.makedirs(model_run_logs_dir, mode=0o755, exist_ok=True)
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Could not create model_run_logs directory: {e}{C_RESET}")
        elif OS_NAME != "Windows":
            current_user_uid = os.getuid()
            if os.stat(model_run_logs_dir).st_uid != current_user_uid:
                print(f"{C_YELLOW}⚠️  model_run_logs directory is owned by another user, fixing permissions...{C_RESET}")
                try:
                    os.chown(model_run_logs_dir, current_user_uid, os.getgid())
                    print(f"{C_GREEN}✅ Fixed model_run_logs directory ownership{C_RESET}")
                except (OSError, PermissionError) as e:
                    print(f"{C_RED}⛔ Could not fix model_run_logs permissions: {e}{C_RESET}")
                    print(f"{C_YELLOW}Please run the following in another terminal, then press Enter:{C_RESET}")
                    print(f"   {C_WHITE}sudo chown -R $USER:$USER {model_run_logs_dir}{C_RESET}")
                    input("Press Enter once you've run the command above to continue...")

        end_phase(ph)  # ── end Phase 2 · Configure

        # ── Phase 3 · Services ───────────────────────────────────────────────
        # docker-control / inference-server start here; they print their own
        # status and may sudo, so keep the spinner suspended through them.
        ph = begin_phase(3, 5, "Services")
        ph.suspend()

        # Start Docker Control Service BEFORE starting Docker containers
        # This ensures the backend can connect to it when it starts
        ph.set("Docker Control service")
        startup_log.step("docker_control_service", "START")
        if not args.skip_docker_control:
            if not start_docker_control_service(no_sudo=args.no_sudo, dev_mode=args.dev):
                startup_log.step("docker_control_service", "WARN", "failed, continuing without it")
                console.print("[warning]Note: Backend will not be able to manage Docker containers.[/warning]")
            else:
                startup_log.step("docker_control_service", "OK")
        else:
            startup_log.step("docker_control_service", "SKIP", "--skip-docker-control")
            console.print("[warning]⚠️  Skipping Docker Control Service setup (--skip-docker-control flag used)[/warning]")

        # Check if AI Playground mode is enabled
        is_deployed_mode = parse_boolean_env(get_env_var("VITE_ENABLE_DEPLOYED"))

        # Check and download TT Inference Server artifact BEFORE building containers
        # so any version/branch changes are visible to the user early and failures stop startup immediately
        if not args.skip_fastapi and not is_deployed_mode:
            startup_log.step("fastapi_server", "START")
            original_dir = os.getcwd()
            try:
                ph.set("TT Inference Server")
                if not setup_tt_inference_server(pull_branch=args.pull_branch):
                    startup_log.step("fastapi_server", "FAIL", "inference server setup failed")
                    console.print("[error]⛔ Cannot start TT Studio: TT Inference Server setup failed. Exiting.[/error]")
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
                    ph.set("model catalog")
                    _sync_model_catalog()
                elif show_detail():
                    console.print("[muted]Skipping model catalog sync (use --resync to force)[/muted]")
            finally:
                os.chdir(original_dir)
        elif args.skip_fastapi:
            startup_log.step("fastapi_server", "SKIP", "--skip-fastapi")
            console.print("[warning]⚠️  Skipping TT Inference Server setup (--skip-fastapi)[/warning]")
        elif is_deployed_mode:
            startup_log.step("fastapi_server", "SKIP", "AI Playground mode")
            console.print("[muted]AI Playground mode — using cloud models; local inference server not needed[/muted]")

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

        # Stamp the frontend build with the current git version (official tag or
        # branch name) so the footer shows what's actually running.
        set_app_version_env()

        end_phase(ph)  # ── end Phase 3 · Services

        # ── Phase 4 · Build ──────────────────────────────────────────────────
        # Start Docker services with streaming output and comprehensive error reporting
        ph = begin_phase(4, 5, "Build")
        startup_log.step("docker_compose_up", "START")
        # The compose build renders its own Rich progress, so suspend the phase
        # spinner around it (only one live display at a time).
        ph.suspend()
        console.print("[info]🔨 Building containers[/info] [muted](backend, frontend, agent, chroma)…[/muted]")
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

        # build progress already cleared by run_docker_compose_with_progress
        clear_lines(_docker_transient_lines)
        startup_log.step("docker_compose_up", "OK")
        end_phase(ph)  # ── end Phase 4 · Build

        # ── Phase 5 · Launch ─────────────────────────────────────────────────
        # Inference-server env/start may prompt or sudo and print their own
        # status, so keep the phase spinner suspended through them.
        ph = begin_phase(5, 5, "Launch")
        ph.suspend()
        if not args.skip_fastapi and not is_deployed_mode:
            original_dir = os.getcwd()
            try:
                ph.set("inference server environment")
                if not setup_fastapi_environment():
                    startup_log.step("fastapi_server", "FAIL", "environment setup failed")
                    console.print("[error]⛔ Cannot start TT Studio: inference server environment setup failed. Exiting.[/error]")
                    suggest_pip_fixes()
                    startup_log.summary(exit_code=1)
                    startup_log.close()
                    sys.exit(1)

                ph.set("starting inference server")
                if not start_fastapi_server(no_sudo=args.no_sudo, dev_mode=args.dev):
                    startup_log.step("fastapi_server", "FAIL", f"see {MODEL_RUN_LOG_FILE}")
                    console.print("[error]⛔ Cannot start TT Studio: inference server failed to start. Exiting.[/error]")
                    console.print(f"[muted]   Check logs: tail -50 {MODEL_RUN_LOG_FILE}[/muted]")
                    startup_log.summary(exit_code=1)
                    startup_log.close()
                    sys.exit(1)
                startup_log.step("fastapi_server", "OK")
            finally:
                os.chdir(original_dir)

        end_phase(ph)  # ── end Phase 5 · Launch

        fastapi_enabled = not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_PID_FILE)
        docker_control_enabled = not args.skip_docker_control and os.path.exists(DOCKER_CONTROL_PID_FILE)

        # Endpoints + mode go in the ready card; stop/logs hints sit beneath it.
        rows = [("URL", "http://localhost:3000")]
        if fastapi_enabled:
            rows.append(("FastAPI", "http://localhost:8001"))
        if docker_control_enabled:
            rows.append(("Docker Control", "http://localhost:8002"))

        mode_parts = []
        if is_deployed_mode:
            mode_parts.append("AI Playground")
        else:
            mode_parts.append("Local")
        if args.dev:
            mode_parts.append("Dev")
        if detect_tt_hardware():
            mode_parts.append("TT Hardware")
        rows.append(("Mode", " + ".join(mode_parts)))

        # Full log paths only with --verbose; otherwise one compact hint.
        footer = ["[muted]Stop · python run.py --stop[/muted]"]
        if is_verbose():
            footer.append("[muted]Logs · cd app && docker compose logs -f[/muted]")
            if fastapi_enabled:
                footer.append(f"[muted]     · tail -f {MODEL_RUN_LOG_FILE}[/muted]")
            if docker_control_enabled:
                footer.append(f"[muted]     · tail -f {DOCKER_CONTROL_LOG_FILE}[/muted]")
        else:
            footer.append("[muted]Logs · cd app && docker compose logs -f   (-v for paths)[/muted]")

        console.print()
        console.print(ready_panel("TT Studio is ready", rows, footer))
        console.print()

        startup_log.step("startup_complete", "OK")
        startup_log.summary(exit_code=0)
        startup_log.close()

        # Wait for services if requested
        if args.wait_for_services:
            with step("Waiting for services") as s:
                if not wait_for_all_services(
                    skip_fastapi=args.skip_fastapi,
                    is_deployed_mode=is_deployed_mode,
                    skip_docker_control=args.skip_docker_control,
                ):
                    s.fail()
            if s.failed:
                print(f"\n{C_RED}⛔ Not all services became healthy{C_RESET}")
                print(f"{C_CYAN}   Review logs above. Try: python run.py --stop && python run.py{C_RESET}")
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
                print(f"{C_CYAN}💡 Run: {C_WHITE}python run.py --stop && python run.py{C_RESET}")
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
            
            # Also check for model run logs
            model_run_logs_process = None
            if not args.skip_fastapi and not is_deployed_mode and os.path.exists(MODEL_RUN_LOG_FILE):
                model_run_logs_process = subprocess.Popen(["tail", "-f", MODEL_RUN_LOG_FILE])
            
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
                if model_run_logs_process:
                    model_run_logs_process.terminate()

    except SystemExit:
        # A phase step called sys.exit() — stop any live phase spinner so it
        # doesn't corrupt the terminal on the way out, then exit as intended.
        stop_active_phase()
        raise
    except KeyboardInterrupt:
        stop_active_phase()
        startup_log.step("interrupted", "FAIL", "Ctrl+C")
        startup_log.summary(exit_code=130)
        startup_log.close()

        # Build the original command with flags for the resume hint.
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

        console.print(notice_panel(
            "[bold]🛑 Setup interrupted (Ctrl+C)[/bold]",
            [
                f"[muted]Resume     →[/muted]  {original_cmd}",
                "[muted]Clean up   →[/muted]  python run.py --stop",
                "[muted]Help       →[/muted]  python run.py --help",
            ],
            border_style="warning",
        ))
        sys.exit(130)
    except Exception as e:
        stop_active_phase()
        console.print(f"\n[error]❌ An unexpected error occurred: {type(e).__name__}[/error]")
        console.print(f"   {e}", style="error", markup=False)

        console.print("\n[warning]Full error details:[/warning]")
        # Rich-rendered traceback (syntax-highlighted, locals on the failing frame).
        console.print_exception(show_locals=False)

        startup_log.step("unhandled_exception", "FAIL", f"{type(e).__name__}: {e}")
        startup_log.summary(exit_code=1)
        startup_log.close()

        console.print(notice_panel(
            "[bold]💡 Next steps[/bold]",
            [
                "[muted]Check the error details above[/muted]",
                f"[muted]Startup log →[/muted]  {STARTUP_LOG_FILE}",
                "[muted]Help        →[/muted]  python run.py --help",
                "[muted]Clean up    →[/muted]  python run.py --stop",
                "[muted]Report bugs →[/muted]  https://github.com/tenstorrent/tt-studio/issues",
            ],
            border_style="error",
        ))
        sys.exit(1)


def main():
    """Entry point: run the Typer app."""
    app()
