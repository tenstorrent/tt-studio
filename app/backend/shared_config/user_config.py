# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Runtime-editable user secrets stored in the persistent volume.

Resolution order for each value: user_config.json -> environment variable
-> (JWT only) auto-generated and persisted.
"""

import json
import os
import secrets
from pathlib import Path
from typing import Optional


_CONFIG_FILENAME = "user_config.json"


def _config_path() -> Path:
    base = os.environ.get("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume")
    return Path(base) / "backend_volume" / _CONFIG_FILENAME


def load_user_config() -> dict:
    path = _config_path()
    if not path.exists():
        return {}
    try:
        with path.open("r") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_user_config(updates: dict) -> dict:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    current = load_user_config()
    for k, v in updates.items():
        if v is None or v == "":
            current.pop(k, None)
        else:
            current[k] = v
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(current, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    return current


def get_jwt_secret() -> str:
    cfg = load_user_config()
    val = cfg.get("jwt_secret")
    if val:
        return val
    env_val = os.environ.get("JWT_SECRET")
    if env_val:
        return env_val
    generated = secrets.token_urlsafe(48)
    save_user_config({"jwt_secret": generated})
    return generated


def get_tavily_api_key() -> Optional[str]:
    cfg = load_user_config()
    val = cfg.get("tavily_api_key")
    if val:
        return val
    return os.environ.get("TAVILY_API_KEY") or None
