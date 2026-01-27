# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Docker Control Service Configuration
"""

import os
from typing import List


class Settings:
    """Configuration settings for Docker Control Service"""

    # Server configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8002
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


# Global settings instance
settings = Settings()
