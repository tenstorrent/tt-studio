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

from _runner.cli import build_parser, print_help_env
from _runner.constants import STARTUP_LOG_FILE, TT_STUDIO_ROOT
from _runner.context import RunContext, StartupLogger
from _runner.spdx import SpdxManager
from _runner.docker_manager import DockerManager
from _runner import startup as _startup


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.help_env:
        print_help_env()
        return

    if args.check_headers:
        SpdxManager().check_spdx_headers()
        return

    if args.add_headers:
        SpdxManager().add_spdx_headers()
        return

    log = StartupLogger(STARTUP_LOG_FILE)
    ctx = RunContext(args=args, startup_log=log, root=TT_STUDIO_ROOT)

    if args.fix_docker:
        success = DockerManager(ctx).fix_docker_issues()
        sys.exit(0 if success else 1)

    if args.cleanup or args.cleanup_all:
        DockerManager(ctx).cleanup(args)
        return

    _startup.orchestrate_startup(ctx)


if __name__ == "__main__":
    main()
