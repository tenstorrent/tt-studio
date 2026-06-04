# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Validated configuration model for TT Studio's app/.env.

A single, typed schema for the environment TT Studio reads. Loading goes through
Pydantic so values are coerced (bools), placeholders are treated as unset, and
required-but-missing values surface as clear validation errors. The interactive
setup flow still WRITES individual keys via tt_setup.env_config.write_env_var;
this model is the READ / validation side (used by `doctor` / config checks).
"""

from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from tt_setup.constants import ENV_FILE_PATH

# Known placeholder values from app/.env.default that mean "not configured yet".
PLACEHOLDERS = frozenset({
    "django-insecure-default", "tvly-xxx", "hf_***",
    "tt-studio-rag-admin-password", "cloud llama chat ui url",
    "cloud llama chat ui auth token", "test-456",
    "<PATH_TO_ROOT_OF_REPO>", "true or false to enable deployed mode",
    "true or false to enable RAG admin",
})


def is_placeholder_value(value) -> bool:
    """True for empty/whitespace or a known .env.default placeholder."""
    if value is None or str(value).strip() == "":
        return True
    return str(value).strip().strip('"\'') in PLACEHOLDERS


class TTStudioSettings(BaseSettings):
    """Typed view of app/.env. Unknown keys are ignored; matching is case-insensitive."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE_PATH,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Security / secrets
    hf_token: Optional[str] = None
    jwt_secret: Optional[str] = None
    django_secret_key: Optional[str] = None
    tavily_api_key: Optional[str] = None
    rag_admin_password: Optional[str] = None

    # Application modes
    vite_app_title: Optional[str] = None
    vite_enable_deployed: bool = False
    vite_enable_rag_admin: bool = False

    # Cloud model endpoints (only used in AI Playground mode)
    cloud_chat_ui_url: Optional[str] = None
    cloud_chat_ui_auth_token: Optional[str] = None

    # TT Inference Server artifact selection
    tt_inference_artifact_branch: Optional[str] = None
    tt_inference_artifact_version: Optional[str] = None

    @field_validator(
        "hf_token", "jwt_secret", "django_secret_key", "tavily_api_key",
        "rag_admin_password", "vite_app_title", "cloud_chat_ui_url",
        "cloud_chat_ui_auth_token", "tt_inference_artifact_branch",
        "tt_inference_artifact_version",
        mode="before",
    )
    @classmethod
    def _blank_placeholders(cls, v):
        """Treat placeholder/empty strings as unset (None)."""
        return None if is_placeholder_value(v) else v

    # Convenience: which required-for-secure-run values are still unset.
    def missing_required(self) -> list[str]:
        required = ("hf_token", "jwt_secret", "django_secret_key")
        return [name for name in required if getattr(self, name) is None]


def load_settings(**overrides) -> TTStudioSettings:
    """Load and validate settings from app/.env (and the environment)."""
    return TTStudioSettings(**overrides)
