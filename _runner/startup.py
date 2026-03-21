# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import sys
import subprocess
from datetime import datetime

from _runner import (constants, context, utils, preflight, env_config,
                     docker_manager, artifact_manager, service_manager,
                     health_monitor, port_manager)
from _runner.constants import (
    C_RESET, C_RED, C_GREEN, C_YELLOW, C_BLUE, C_CYAN, C_WHITE,
    C_BOLD, C_ORANGE, C_TT_PURPLE, C_MAGENTA,
    TT_STUDIO_ROOT, OS_NAME,
    FASTAPI_PID_FILE, FASTAPI_LOG_FILE,
    DOCKER_CONTROL_PID_FILE,
)
from _runner.utils import parse_boolean_env


def orchestrate_startup(ctx):
    """Replaces main() body. Same logic, calls managers."""
    args = ctx.args
    dev_mode = args.dev

    # Construct managers
    env_mgr = env_config.EnvManager(ctx)
    docker_mgr = docker_manager.DockerManager(ctx)
    artifact_mgr = artifact_manager.ArtifactManager(ctx, env_mgr)
    svc_mgr = service_manager.ServiceManager(ctx, env_mgr)
    health_mon = health_monitor.HealthMonitor(ctx)
    port_mgr = port_manager.PortManager(ctx)

    try:
        # Phase 1: Welcome banner
        env_mgr.display_welcome_banner()

        # Phase 2: Docker installation check
        docker_mgr.check_docker_installation()

        # Phase 3: Environment configuration
        env_mgr.configure_environment_sequentially(
            dev_mode=dev_mode,
            force_reconfigure=args.reconfigure,
            easy_mode=args.easy
        )

        # Save easy mode configuration to JSON if --easy flag was used
        if args.easy:
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
            env_mgr.save_easy_config(easy_config)

        # Phase 4: Create persistent storage directory
        host_persistent_volume = env_mgr.get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
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

        # Phase 5: Ensure Docker network
        docker_mgr.ensure_network()

        # Phase 6: Ensure frontend dependencies
        svc_mgr.ensure_frontend_dependencies(force_prompt=args.reconfigure, easy_mode=args.easy)

        # Phase 7: Check port availability
        print(f"\n{C_BOLD}{C_BLUE}🔍 Checking port availability for all services...{C_RESET}")
        print(f"{C_CYAN}The following ports will be checked and freed if needed:{C_RESET}")
        print(f"  • Port 3000 - Frontend (Vite dev server)")
        print(f"  • Port 8000 - Backend API (Django/Gunicorn)")
        print(f"  • Port 8080 - Agent Service")
        print(f"  • Port 8111 - ChromaDB (Vector Database)")
        print(f"{C_YELLOW}⚠️  If any of these ports are in use, we will attempt to free them.{C_RESET}\n")

        # Define ports based on mode
        required_ports = [
            (3000, "Frontend"),
            (8000, "Backend API"),
            (8080, "Agent Service"),
            (8111, "ChromaDB"),
        ]

        ports_ok, failed_ports = port_mgr.check_and_free_ports(required_ports, no_sudo=args.no_sudo)

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

        print(f"{C_GREEN}✅ All required ports are available{C_RESET}\n")

        # Phase 8: Ensure workflow_logs directory exists with correct permissions before Docker mounts it
        # This prevents Docker from creating it as root (which causes permission issues)
        workflow_logs_dir = os.path.join(TT_STUDIO_ROOT, "tt-inference-server", "workflow_logs")
        if not os.path.exists(workflow_logs_dir):
            print(f"{C_BLUE}📁 Creating workflow_logs directory with correct permissions...{C_RESET}")
            try:
                os.makedirs(workflow_logs_dir, mode=0o755, exist_ok=True)
                print(f"{C_GREEN}✅ Created workflow_logs directory{C_RESET}")
            except Exception as e:
                print(f"{C_YELLOW}⚠️  Warning: Could not create workflow_logs directory: {e}{C_RESET}")
                print(f"   Docker will create it, but it may have incorrect permissions")
        else:
            # Ensure existing directory has correct permissions (Unix/Linux only)
            if OS_NAME != "Windows":
                try:
                    current_stat = os.stat(workflow_logs_dir)
                    current_uid = current_stat.st_uid
                    current_user_uid = os.getuid()
                    if current_uid != current_user_uid and current_uid == 0:  # Owned by root
                        print(f"{C_YELLOW}⚠️  workflow_logs directory is owned by root, fixing permissions...{C_RESET}")
                        os.chown(workflow_logs_dir, current_user_uid, os.getgid())
                        print(f"{C_GREEN}✅ Fixed workflow_logs directory ownership{C_RESET}")
                except (OSError, PermissionError, AttributeError) as e:
                    # If we don't have permission or chown is not available, warn user
                    print(f"{C_YELLOW}⚠️  Warning: Could not fix workflow_logs permissions: {e}{C_RESET}")
                    print(f"   You may need to run: sudo chown -R $USER:$USER {workflow_logs_dir}")

        # Phase 9: Start Docker Control Service BEFORE starting Docker containers
        # This ensures the backend can connect to it when it starts
        if not args.skip_docker_control:
            print(f"\n{C_BLUE}{'='*60}{C_RESET}")
            print(f"{C_BLUE}Step 7: Starting Docker Control Service{C_RESET}")
            print(f"{C_BLUE}{'='*60}{C_RESET}")

            if not svc_mgr.start_docker_control_service(no_sudo=args.no_sudo):
                print(f"{C_RED}⛔ Failed to start Docker Control Service. Continuing without it.{C_RESET}")
                print(f"{C_YELLOW}Note: Backend will not be able to manage Docker containers.{C_RESET}")
        else:
            print(f"\n{C_YELLOW}⚠️  Skipping Docker Control Service setup (--skip-docker-control flag used){C_RESET}")

        # Phase 10: Start Docker services
        print(f"\n{C_BOLD}{C_BLUE}🚀 Starting Docker services...{C_RESET}")

        # Check Docker access to determine if sudo is needed
        has_docker_access = docker_mgr.check_docker_access()
        if not has_docker_access:
            print(f"{C_YELLOW}⚠️  Using sudo for docker-compose (you may be prompted for password)...{C_RESET}")

        # Set up the Docker Compose command
        docker_compose_cmd = docker_mgr.build_docker_compose_command(dev_mode=dev_mode)

        # Add the up command and flags
        docker_compose_cmd.extend(["up", "--build", "-d"])

        # Run the Docker Compose command with sudo if needed
        if has_docker_access:
            utils.run_command(docker_compose_cmd, cwd=os.path.join(TT_STUDIO_ROOT, "app"))
        else:
            # Need sudo for docker-compose
            sudo_cmd = ["sudo"] + docker_compose_cmd
            subprocess.run(sudo_cmd, cwd=os.path.join(TT_STUDIO_ROOT, "app"), check=True)

        # Phase 11: Check if AI Playground mode is enabled
        is_deployed_mode = parse_boolean_env(env_mgr.get_env_var("VITE_ENABLE_DEPLOYED"))

        # Phase 12: Setup TT Inference Server FastAPI (unless skipped or AI Playground mode is enabled)
        if not args.skip_fastapi and not is_deployed_mode:
            print(f"\n{C_TT_PURPLE}{C_BOLD}🔧 Setting up TT Inference Server FastAPI (Local Mode){C_RESET}")
            print(f"{C_CYAN}   Note: FastAPI server is only needed for local model inference{C_RESET}")

            # Store original directory to return to later
            original_dir = os.getcwd()

            # Note: sudo is no longer required by default for FastAPI (port 8001 is non-privileged)
            # The --no-sudo flag is kept for backward compatibility
            try:
                # Setup TT Inference Server
                if not svc_mgr.setup_tt_inference_server():
                    print(f"{C_RED}⛔ Failed to setup TT Inference Server. Continuing without FastAPI server.{C_RESET}")
                else:
                    # Setup FastAPI environment
                    if not svc_mgr.setup_fastapi_environment():
                        print(f"{C_RED}⛔ Failed to setup FastAPI environment. Continuing without FastAPI server.{C_RESET}")
                    else:
                        # Start FastAPI server
                        if not svc_mgr.start_fastapi_server(no_sudo=args.no_sudo):
                            print(f"{C_RED}⛔ Failed to start FastAPI server. Continuing without FastAPI server.{C_RESET}")
            finally:
                # Return to original directory
                os.chdir(original_dir)
        elif args.skip_fastapi:
            print(f"\n{C_YELLOW}⚠️  Skipping TT Inference Server FastAPI setup (--skip-fastapi flag used){C_RESET}")
        elif is_deployed_mode:
            print(f"\n{C_GREEN}✅ Skipping TT Inference Server FastAPI setup (AI Playground mode enabled){C_RESET}")
            print(f"{C_CYAN}   Note: AI Playground mode uses cloud models, so local FastAPI server is not needed{C_RESET}")

        # Phase 13: Startup summary
        print(f"\n{C_GREEN}✔ Setup Complete!{C_RESET}")
        print()

        # Simple, clean output without complex formatting
        print("=" * 60)
        print("🚀 Tenstorrent TT Studio is ready!")
        print("=" * 60)
        print(f"Access it at: {C_CYAN}http://localhost:3000{C_RESET}")

        if not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_PID_FILE):
            print(f"FastAPI server: {C_CYAN}http://localhost:8001{C_RESET}")
            print(f"Health check: curl http://localhost:8001/")

        if not args.skip_docker_control and os.path.exists(DOCKER_CONTROL_PID_FILE):
            print(f"Docker Control Service: {C_CYAN}http://localhost:8002{C_RESET}")
            print(f"API docs: http://localhost:8002/api/v1/docs")

        if OS_NAME == "Darwin":
            print("(Cmd+Click the link to open in browser)")
        else:
            print("(Ctrl+Click the link to open in browser)")

        print("=" * 60)
        print()

        # Display info about special modes if they are enabled
        active_modes = []
        if dev_mode:
            active_modes.append("💻 Development Mode: ENABLED")
        if docker_mgr.detect_tt_hardware():
            active_modes.append("🔧 Tenstorrent Device: MOUNTED")
        if is_deployed_mode:
            active_modes.append("☁️ AI Playground Mode: ENABLED")

        if active_modes:
            print(f"{C_YELLOW}Active Modes:{C_RESET}")
            for mode in active_modes:
                print(f"  {mode}")
            print()

        print(f"{C_YELLOW}🧹 To stop all services, run:{C_RESET}")
        print(f"  {C_MAGENTA}python run.py --cleanup{C_RESET}")
        print()
        print()

        # Display final summary
        is_rag_admin_enabled = parse_boolean_env(env_mgr.get_env_var("VITE_ENABLE_RAG_ADMIN"))

        print(f"{C_BOLD}📋 Configuration Summary:{C_RESET}")
        if is_deployed_mode:
            print(f"  • {C_GREEN}☁️ AI Playground Mode: ✅ ENABLED{C_RESET}")
            print(f"    {C_CYAN}   → Using cloud models for inference{C_RESET}")
        else:
            print(f"  • {C_YELLOW}🏠 Local Mode: ✅ ENABLED{C_RESET}")
            print(f"    {C_CYAN}   → Using local FastAPI server for inference{C_RESET}")
        print(f"  • RAG Admin Interface: {'✅ Enabled' if is_rag_admin_enabled else '❌ Disabled'}")
        print(f"  • Persistent Storage: {host_persistent_volume}")
        print(f"  • Development Mode: {'✅ Enabled' if dev_mode else '❌ Disabled'}")
        print(f"  • TT Hardware Support: {'✅ Enabled' if docker_mgr.detect_tt_hardware() else '❌ Disabled'}")
        print(f"  • FastAPI Server: {'✅ Enabled' if not args.skip_fastapi and not is_deployed_mode and os.path.exists(FASTAPI_PID_FILE) else '❌ Disabled'}")

        if is_deployed_mode:
            print(f"\n{C_BLUE}🌐 Your TT Studio is running in AI Playground mode with cloud model integrations.{C_RESET}")
            print(f"{C_CYAN}   You can access cloud models through the AI Playground interface.{C_RESET}")
        else:
            print(f"\n{C_BLUE}🏠 Your TT Studio is running in Local Mode with local model inference.{C_RESET}")
            print(f"{C_CYAN}   You can deploy and manage local models through the interface.{C_RESET}")

        # Phase 14: Wait for services if requested
        if args.wait_for_services:
            health_mon.wait_for_all_services(skip_fastapi=args.skip_fastapi, is_deployed_mode=is_deployed_mode)

        # Phase 15: Control browser open only if service is healthy
        if not args.no_browser:
            # Get configurable frontend settings
            host, port, timeout = health_mon.get_frontend_config()

            # Use the new function that reuses existing infrastructure
            if not health_mon.wait_for_frontend_and_open_browser(host, port, timeout, args.auto_deploy):
                auto_deploy_param = f"?auto-deploy={args.auto_deploy}" if args.auto_deploy else ""
                print(f"{C_YELLOW}⚠️  Browser opening failed. Please manually navigate to http://{host}:{port}{auto_deploy_param}{C_RESET}")
        else:
            host, port, _ = health_mon.get_frontend_config()
            auto_deploy_param = f"?auto-deploy={args.auto_deploy}" if args.auto_deploy else ""
            print(f"{C_BLUE}🌐 Automatic browser opening disabled. Access TT-Studio at: {C_CYAN}http://{host}:{port}{auto_deploy_param}{C_RESET}")

        # Phase 16: If in dev mode, show logs similar to startup.sh
        if dev_mode:
            print(f"\n{C_YELLOW}📜 Tailing logs in development mode. Press Ctrl+C to stop.{C_RESET}")

            # Build the same Docker Compose command for logs
            docker_logs_cmd = docker_mgr.build_docker_compose_command(dev_mode=dev_mode)
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
                import time
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

        # Build the original command with flags for resume suggestion
        original_cmd = "python run.py"
        if args.dev:
            original_cmd += " --dev"
        if args.skip_fastapi:
            original_cmd += " --skip-fastapi"
        if args.no_sudo:
            original_cmd += " --no-sudo"

        print(f"{C_CYAN}🔄 To resume setup later, run: {C_WHITE}{original_cmd}{C_RESET}")
        print(f"{C_CYAN}🧹 To clean up any partial setup: {C_WHITE}python run.py --cleanup{C_RESET}")
        print(f"{C_CYAN}❓ For help: {C_WHITE}python run.py --help{C_RESET}")
        sys.exit(0)
    except Exception as e:
        print(f"\n{C_RED}❌ An unexpected error occurred: {e}{C_RESET}")
        print(f"{C_CYAN}💡 For help: {C_WHITE}python run.py --help{C_RESET}")
        print(f"{C_CYAN}💡 To clean up: {C_WHITE}python run.py --cleanup{C_RESET}")
        sys.exit(1)
