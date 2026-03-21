# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import argparse

from _runner.constants import (
    C_RESET, C_TT_PURPLE, C_BOLD, C_CYAN, C_YELLOW, C_GREEN,
    C_MAGENTA, C_WHITE, C_RED, C_BLUE, C_ORANGE,
)


def build_parser() -> argparse.ArgumentParser:
    """Build and return the argument parser for run.py."""
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
  {C_CYAN}python run.py{C_RESET}                   🚀 Normal interactive setup
  {C_CYAN}python run.py --easy{C_RESET}            ⚡ Easy setup - minimal prompts, only HF_TOKEN required
  {C_CYAN}python run.py --dev{C_RESET}             🛠️  Development mode with suggested defaults
  {C_CYAN}python run.py --reconfigure{C_RESET}      🔄 Reset preferences and reconfigure all options
  {C_CYAN}python run.py --cleanup{C_RESET}         🧹 Clean up containers and networks only
  {C_CYAN}python run.py --cleanup-all{C_RESET}     🗑️  Complete cleanup including data and config
  {C_CYAN}python run.py --skip-fastapi{C_RESET}    ⏭️  Skip FastAPI server setup (auto-skipped in AI Playground mode)
  {C_CYAN}python run.py --no-browser{C_RESET}      🚫 Skip automatic browser opening
  {C_CYAN}python run.py --wait-for-services{C_RESET} ⏳ Wait for all services to be healthy before completing
  {C_CYAN}python run.py --check-headers{C_RESET} 🔍 Check for missing SPDX license headers
  {C_CYAN}python run.py --add-headers{C_RESET} 📝 Add missing SPDX license headers (excludes frontend)
  {C_CYAN}python run.py --fix-docker{C_RESET}   🔧 Automatically fix Docker service and permission issues
  {C_CYAN}python run.py --help-env{C_RESET}        📚 Show detailed environment variables help

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
    parser.add_argument("--fix-docker", action="store_true",
               help="🔧 Automatically fix Docker service and permission issues")
    parser.add_argument("--easy", action="store_true",
               help="🚀 Easy setup mode - only prompts for HF_TOKEN, uses defaults for everything else")
    return parser


def print_help_env() -> None:
    """Print detailed environment variables help."""
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
