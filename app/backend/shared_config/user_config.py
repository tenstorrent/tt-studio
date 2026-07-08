# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Runtime-editable user secrets stored in the persistent volume.

Secrets live in dotenv format at backend_volume/user_config.env (mode 0600,
uppercase env-var keys, atomic writes). Resolution order for each value:
user_config.env -> environment variable -> (JWT only) auto-generated and
persisted. A legacy user_config.json from earlier builds is migrated to the
.env file on first load and then deleted so secrets exist in one place only.
"""

import json
import os
import secrets
from pathlib import Path
from typing import Optional


_CONFIG_FILENAME = "user_config.env"
_LEGACY_JSON_FILENAME = "user_config.json"

# Python-facing keys <-> keys as written in user_config.env.
_ENV_KEYS = {
    "jwt_secret": "JWT_SECRET",
    "hf_token": "HF_TOKEN",
    "tavily_api_key": "TAVILY_API_KEY",
    "tts_api_key": "TTS_API_KEY",
    "setup_complete": "SETUP_COMPLETE",
}
_PY_KEYS = {v: k for k, v in _ENV_KEYS.items()}


def _config_dir() -> Path:
    base = os.environ.get("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume")
    return Path(base) / "backend_volume"


def _config_path() -> Path:
    return _config_dir() / _CONFIG_FILENAME


def _legacy_json_path() -> Path:
    return _config_dir() / _LEGACY_JSON_FILENAME


def _parse_env_file(path: Path) -> dict:
    """Parse a KEY=VALUE dotenv file into a python-keyed dict.

    Ignores comments, blank lines, and unknown keys; strips optional single or
    double quotes around values.
    """
    result = {}
    try:
        text = path.read_text()
    except OSError:
        return result
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        py_key = _PY_KEYS.get(key)
        if py_key is None or not value:
            continue
        if py_key == "setup_complete":
            result[py_key] = value.lower() in ("true", "1", "yes")
        else:
            result[py_key] = value
    return result


def _sanitize_value(value: str) -> str:
    """Secrets are single-line by definition; strip newlines so a crafted
    value cannot inject extra KEY=VALUE lines into the file."""
    return value.replace("\r", "").replace("\n", "").strip()


def _write_env_file(config: dict) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    lines = ["# TT Studio user secrets — managed via the Settings UI. Do not commit."]
    for py_key, env_key in _ENV_KEYS.items():
        value = config.get(py_key)
        if value is None or value == "" or value is False:
            continue
        if py_key == "setup_complete":
            lines.append(f"{env_key}=true")
        else:
            lines.append(f"{env_key}={_sanitize_value(str(value))}")
    tmp = path.with_suffix(".env.tmp")
    with tmp.open("w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _migrate_legacy_json() -> Optional[dict]:
    """One-time migration: convert user_config.json to user_config.env and
    delete the JSON so secrets don't linger in two files. Returns the migrated
    config, or None if there was nothing to migrate."""
    legacy = _legacy_json_path()
    if _config_path().exists() or not legacy.exists():
        return None
    try:
        with legacy.open("r") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
    except (OSError, json.JSONDecodeError):
        return None
    config = {k: v for k, v in data.items() if k in _ENV_KEYS and v not in (None, "", False)}
    _write_env_file(config)
    try:
        legacy.unlink()
    except OSError:
        # Best effort (e.g. root-owned file on a host volume); the .env file
        # now takes precedence either way.
        pass
    return config


def load_user_config() -> dict:
    path = _config_path()
    if not path.exists():
        migrated = _migrate_legacy_json()
        if migrated is not None:
            return migrated
        return {}
    return _parse_env_file(path)


def save_user_config(updates: dict) -> dict:
    current = load_user_config()
    for k, v in updates.items():
        if k not in _ENV_KEYS:
            continue
        if v is None or v == "":
            current.pop(k, None)
        else:
            current[k] = v
    _write_env_file(current)
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


def get_hf_token() -> Optional[str]:
    cfg = load_user_config()
    val = cfg.get("hf_token")
    if val:
        return val
    return os.environ.get("HF_TOKEN") or None


def get_tts_api_key() -> Optional[str]:
    cfg = load_user_config()
    val = cfg.get("tts_api_key")
    if val:
        return val
    return os.environ.get("TTS_API_KEY") or None


def get_artifact_info() -> dict:
    """Read-only metadata about which tt-inference-server release TT Studio is pinned to."""
    return {
        "branch": os.environ.get("TT_INFERENCE_ARTIFACT_BRANCH") or None,
        "version": os.environ.get("TT_INFERENCE_ARTIFACT_VERSION") or None,
    }


def is_setup_complete() -> bool:
    return bool(load_user_config().get("setup_complete"))


def mark_setup_complete() -> None:
    save_user_config({"setup_complete": True})
