# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Docker Control Service Configuration
"""

import os
from typing import List


class Settings:
    """Configuration settings for Docker Control Service"""

    # Server configuration
    # Host-mode/manual runs are loopback-only.  The Compose service overrides
    # this to 0.0.0.0 inside its private bridge network; it has no published
    # host port, so that does not expose the API on the host LAN.
    HOST: str = os.getenv("DOCKER_CONTROL_HOST", "127.0.0.1")
    PORT: int = int(os.getenv("DOCKER_CONTROL_PORT", "8002"))
    DEV_MODE: bool = os.getenv("DEV_MODE", "false").lower() == "true"

    # Security configuration
    JWT_SECRET: str = os.getenv("DOCKER_CONTROL_JWT_SECRET", "change-me-in-production")

    # Operation whitelisting - Security policies
    ALLOWED_IMAGES: List[str] = [
        "ghcr.io/tenstorrent/",
        "tenstorrent/",
        "alpine:",
        "ubuntu:",
        "python:",
        "face-recognition-api:",
        # Marketplace apps (shared_config/marketplace_config.py)
        "ghcr.io/open-webui/",
        "mintplexlabs/",
        "itzcrazykns1337/",
    ]

    ALLOWED_NETWORKS: List[str] = [
        "tt_studio_network",
        "bridge",
        "host",
    ]

    # Resource limits
    MAX_MEMORY: str = "16g"
    MAX_CPUS: int = 8

    # Timeout settings (seconds)
    CONTAINER_START_TIMEOUT: int = 300
    CONTAINER_STOP_TIMEOUT: int = 30
    IMAGE_PULL_TIMEOUT: int = 600

    # Host log file paths (passed in as env vars from run.py)
    SERVICE_LOG_FILE: str = os.getenv("DOCKER_CONTROL_LOG_FILE", "")
    STARTUP_LOG_FILE: str = os.getenv("STARTUP_LOG_FILE", "")
    MODEL_RUN_LOG_FILE: str = os.getenv("MODEL_RUN_LOG_FILE", "")


# Global settings instance
settings = Settings()
