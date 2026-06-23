# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared constants: ANSI colors, filesystem paths, and cleanup identifiers."""

import os
import platform

# --- Color definitions ---
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

# --- Environment / platform ---
TT_STUDIO_ROOT = os.getcwd()
OS_NAME = platform.system()

TENSTORRENT_ASCII_ART = r"""   __                  __                             __
  / /____  ____  _____/ /_____  _____________  ____  / /_
 / __/ _ \/ __ \/ ___/ __/ __ \/ ___/ ___/ _ \/ __ \/ __/
/ /_/  __/ / / (__  ) /_/ /_/ / /  / /  /  __/ / / / /_
\__/\___/_/ /_/____/\__/\____/_/  /_/   \___/_/ /_/\__/"""

# --- Filesystem paths ---
DOCKER_COMPOSE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.yml")
DOCKER_COMPOSE_DEV_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.dev-mode.yml")
DOCKER_COMPOSE_PROD_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.prod.yml")
DOCKER_COMPOSE_TT_HARDWARE_FILE = os.path.join(TT_STUDIO_ROOT, "app", "docker-compose.tt-hardware.yml")
ENV_FILE_PATH = os.path.join(TT_STUDIO_ROOT, "app", ".env")
ENV_FILE_DEFAULT = os.path.join(TT_STUDIO_ROOT, "app", ".env.default")
INFERENCE_API_DIR = os.path.join(TT_STUDIO_ROOT, "inference-api")
INFERENCE_ARTIFACT_DIR = os.path.join(TT_STUDIO_ROOT, ".artifacts", "tt-inference-server")
INFERENCE_ARTIFACT_VERSION = None  # Will be set after get_env_var is defined
INFERENCE_ARTIFACT_URL = None  # Will be set after get_env_var is defined
# All host-side runtime logs and PID files live under a single logs/ directory so
# they don't clutter the repo root. Created eagerly because StartupLogger opens
# startup.log at import time (in tt_setup.logging).
LOGS_DIR = os.path.join(TT_STUDIO_ROOT, "logs")
try:
    os.makedirs(LOGS_DIR, exist_ok=True)
except OSError:
    # Keep the package importable even if logs/ can't be created.
    LOGS_DIR = TT_STUDIO_ROOT

FASTAPI_PID_FILE = os.path.join(LOGS_DIR, "fastapi.pid")
MODEL_RUN_LOG_FILE = os.path.join(LOGS_DIR, "model_run.log")
MODEL_RUN_LOGS_DIR = os.path.join(LOGS_DIR, "model_run_logs")
DOCKER_CONTROL_SERVICE_DIR = os.path.join(TT_STUDIO_ROOT, "docker-control-service")
DOCKER_CONTROL_PID_FILE = os.path.join(LOGS_DIR, "docker-control-service.pid")
DOCKER_CONTROL_LOG_FILE = os.path.join(LOGS_DIR, "docker-control-service.log")
PREFS_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_preferences.json")
SETUP_CONFIG_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_setup_config.json")
LEGACY_SETUP_CONFIG_FILE_PATH = os.path.join(TT_STUDIO_ROOT, ".tt_studio_easy_config.json")
STARTUP_LOG_FILE = os.path.join(LOGS_DIR, "startup.log")

# Maps a service health-check URL to the Docker container name prefix that serves it.
SERVICE_CONTAINER_PREFIX_MAP = {
    "http://localhost:8000/up/": "tt_studio_backend",
    "http://localhost:3000/": "tt_studio_frontend",
    "http://localhost:8080/": "tt_studio_agent",
    "http://localhost:8111/api/v1/heartbeat": "tt_studio_chroma",
}

# --- Cleanup identifiers ---
_CLEANUP_IMAGE_REFS = (
    "ghcr.io/tenstorrent/tt-studio/*",
    "ghcr.io/tenstorrent/tt-inference-server/*",
    "ghcr.io/tenstorrent/tt-media-inference-server",
    "chromadb/chroma",
)
_CLEANUP_VOLUME_PREFIX = "volume_id_"

BROWSER_CLEANUP_SENTINEL = os.path.join(
    TT_STUDIO_ROOT, "app", "frontend", "public", ".cleanup-pending"
)
