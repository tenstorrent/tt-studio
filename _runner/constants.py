# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import platform

# --- Color Definitions ---
C_RESET = '\033[0m'
C_RED = '\033[0;31m'
C_GREEN = '\033[0;32m'
C_YELLOW = '\033[0;33m'
C_BLUE = '\033[0;34m'
C_MAGENTA = '\033[0;35m'
C_CYAN = '\033[0;36m'
C_WHITE = '\033[0;37m'
C_BOLD = '\033[1m'
C_ORANGE = '\033[38;5;208m'
C_TT_PURPLE = '\033[38;5;99m'

# --- Global Paths and Constants ---
TT_STUDIO_ROOT = os.getcwd()
# INFERENCE_SERVER_BRANCH = "anirud/v0.0.5-fast-api-for-tt-studio"
# switch to this tmp branch for running models on qb-ge
INFERENCE_SERVER_BRANCH = "anirud/feat-qb-ge-tt-studio-link"
OS_NAME = platform.system()

# --- ASCII Art Constants ---
# Credit: figlet font slant by Glenn Chappell
TENSTORRENT_ASCII_ART = r"""   __                  __                             __
  / /____  ____  _____/ /_____  _____________  ____  / /_
 / __/ _ \/ __ \/ ___/ __/ __ \/ ___/ ___/ _ \/ __ \/ __/
/ /_/  __/ / / (__  ) /_/ /_/ / /  / /  /  __/ / / / /_
\__/\___/_/ /_/____/\__/\____/_/  /_/   \___/_/ /_/\__/"""

# --- File Paths ---
DOCKER_COMPOSE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.yml")
DOCKER_COMPOSE_DEV_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.dev-mode.yml")
DOCKER_COMPOSE_PROD_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.prod.yml")
DOCKER_COMPOSE_TT_HARDWARE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.tt-hardware.yml")
ENV_FILE_PATH = os.path.join(TT_STUDIO_ROOT, "app", ".env")
ENV_FILE_DEFAULT = os.path.join(TT_STUDIO_ROOT, "app", ".env.default")
INFERENCE_SERVER_DIR = os.path.join(TT_STUDIO_ROOT, "tt-inference-server")
FASTAPI_PID_FILE = os.path.join(TT_STUDIO_ROOT, "fastapi.pid")
FASTAPI_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "fastapi.log")
DOCKER_CONTROL_SERVICE_DIR = os.path.join(TT_STUDIO_ROOT, "docker-control-service")
DOCKER_CONTROL_PID_FILE = os.path.join(TT_STUDIO_ROOT, "docker-control-service.pid")
DOCKER_CONTROL_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "docker-control-service.log")
PREFS_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_preferences.json")
EASY_CONFIG_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_easy_config.json")

# Startup log file (used by StartupLogger)
STARTUP_LOG_FILE = os.path.join(TT_STUDIO_ROOT, "tt_studio_startup.log")

# Service container prefix map (for health monitoring / container resolution)
SERVICE_CONTAINER_PREFIX_MAP = {
    "backend": "tt-studio-backend",
    "frontend": "tt-studio-frontend",
    "chromadb": "tt-studio-chromadb",
    "agent": "tt-studio-agent",
}
