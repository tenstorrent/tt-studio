# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""One-shot migration from PR #750's `user_config.json` to the split
`.env` + `user_state.json` layout.

Idempotent: safe to call every backend boot. Does nothing once the legacy file
is gone.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from shared_config.env_store import read_env_file, write_env_file
from shared_config.user_state import save_user_state


logger = logging.getLogger(__name__)


_SECRET_KEYS = (("hf_token", "HF_TOKEN"), ("tts_api_key", "TTS_API_KEY"), ("tavily_api_key", "TAVILY_API_KEY"))


def _legacy_path() -> Path:
    base = os.environ.get("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume")
    return Path(base) / "backend_volume" / "user_config.json"


def migrate_if_needed() -> None:
    path = _legacy_path()
    if not path.exists():
        return

    try:
        with path.open("r") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        logger.warning("Legacy user_config.json present but unreadable; leaving in place.")
        return
    if not isinstance(data, dict):
        return

    current_env = read_env_file()
    env_updates: dict = {}
    for json_key, env_key in _SECRET_KEYS:
        val = data.get(json_key)
        if val and not current_env.get(env_key):
            env_updates[env_key] = val
    if env_updates:
        try:
            write_env_file(env_updates)
            logger.info("Migrated secrets from user_config.json into .env: %s", sorted(env_updates))
        except OSError as exc:
            logger.warning("Could not migrate secrets into .env (%s); leaving user_config.json in place.", exc)
            return

    state_updates: dict = {}
    if data.get("setup_complete"):
        state_updates["setup_complete"] = True
    if data.get("jwt_secret"):
        state_updates["jwt_secret"] = data["jwt_secret"]
    if state_updates:
        save_user_state(state_updates)
        logger.info("Migrated non-secret state from user_config.json into user_state.json: %s", sorted(state_updates))

    try:
        path.unlink()
        logger.info("Deleted legacy user_config.json after migration.")
    except OSError as exc:
        logger.warning("Could not delete legacy user_config.json (%s).", exc)
