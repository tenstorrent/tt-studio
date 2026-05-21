# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Non-secret UI state for TT Studio.

Holds the `setup_complete` flag and the auto-generated `jwt_secret`. These are
infra/UX state, not user-supplied credentials — they live in a small JSON file
in the persistent volume so the Welcome stepper can be skipped on return and
browser sessions survive backend restarts.

Secrets (HF/TTS/Tavily/etc.) do NOT live here — they live in `.env` via
`env_store`.
"""

from __future__ import annotations

import json
import os
import secrets
import tempfile
from pathlib import Path
from typing import Optional


_STATE_FILENAME = "user_state.json"
_ALLOWED_KEYS = frozenset({"setup_complete", "jwt_secret"})


def _state_path() -> Path:
    base = os.environ.get("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume")
    return Path(base) / "backend_volume" / _STATE_FILENAME


def load_user_state() -> dict:
    path = _state_path()
    if not path.exists():
        return {}
    try:
        with path.open("r") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        return {k: v for k, v in data.items() if k in _ALLOWED_KEYS}
    except (OSError, json.JSONDecodeError):
        return {}


def save_user_state(updates: dict) -> dict:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    current = load_user_state()
    for k, v in updates.items():
        if k not in _ALLOWED_KEYS:
            continue
        if v is None or v == "":
            current.pop(k, None)
        else:
            current[k] = v

    fd, tmp_path = tempfile.mkstemp(
        prefix=_STATE_FILENAME + ".",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(current, f, indent=2)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return current


def is_setup_complete() -> bool:
    return bool(load_user_state().get("setup_complete"))


def mark_setup_complete() -> None:
    save_user_state({"setup_complete": True})


def get_jwt_secret() -> str:
    state = load_user_state()
    val = state.get("jwt_secret")
    if val:
        return val
    env_val = os.environ.get("JWT_SECRET")
    if env_val:
        save_user_state({"jwt_secret": env_val})
        return env_val
    generated = secrets.token_urlsafe(48)
    save_user_state({"jwt_secret": generated})
    return generated


__all__ = (
    "load_user_state",
    "save_user_state",
    "is_setup_complete",
    "mark_setup_complete",
    "get_jwt_secret",
)
