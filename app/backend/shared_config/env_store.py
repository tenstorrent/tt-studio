# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Read and write `app/.env` as the single persistent secret store.

`.env` is bind-mounted into the backend container (read-write) and the agent
container (read-only). Helpers re-read on every call so UI changes via the
Settings dialog take effect without restarting any container.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Iterable, Optional


_DEFAULT_PATH_IN_CONTAINER = "/run/tt_studio/env_file"


def env_file_path() -> Path:
    """Resolve the path to the bind-mounted `.env` file.

    Inside a container, prefer `TT_STUDIO_ENV_FILE` if set, else fall back to
    the canonical bind-mount target. On the host (e.g. inference-api running
    as a subprocess), `TT_STUDIO_ENV_FILE` is set by run.py to the absolute
    host path.
    """
    explicit = os.environ.get("TT_STUDIO_ENV_FILE")
    if explicit:
        return Path(explicit)
    return Path(_DEFAULT_PATH_IN_CONTAINER)


def read_env_file(path: Optional[Path] = None) -> dict:
    """Parse a `.env` file into a dict of {KEY: value}.

    Skips comments and blank lines. Strips matched surrounding quotes from
    values. Returns an empty dict if the file is missing or unreadable so
    callers can fall back to `os.environ`.
    """
    path = path or env_file_path()
    out: dict = {}
    try:
        with path.open("r") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                out[key] = value
    except OSError:
        return {}
    return out


def write_env_file(updates: dict, path: Optional[Path] = None) -> None:
    """Update keys in `.env` in place, preserving comments, blank lines, and
    the order of unrelated entries. Atomic via temp-file + os.replace.
    """
    if not updates:
        return
    path = path or env_file_path()

    existing_lines: list[str] = []
    if path.exists():
        with path.open("r") as f:
            existing_lines = f.readlines()

    remaining = dict(updates)
    new_lines: list[str] = []
    for raw in existing_lines:
        stripped = raw.lstrip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(raw)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in remaining:
            value = remaining.pop(key)
            if value is None or value == "":
                continue
            new_lines.append(f"{key}={value}\n")
        else:
            new_lines.append(raw)

    # Append any keys that weren't already present.
    for key, value in remaining.items():
        if value is None or value == "":
            continue
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        new_lines.append(f"{key}={value}\n")

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w") as f:
            f.writelines(new_lines)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def get_env_value(key: str, default: Optional[str] = None) -> Optional[str]:
    """File-first lookup with `os.environ` fallback.

    Use this for any value that lives in the bind-mounted `app/.env` — secrets
    and otherwise. Returns ``default`` if neither source has a non-empty value.
    """
    val = read_env_file().get(key)
    if val:
        return val
    env_val = os.environ.get(key)
    if env_val:
        return env_val
    return default


def get_hf_token() -> Optional[str]:
    return get_env_value("HF_TOKEN")


def get_tts_api_key() -> Optional[str]:
    return get_env_value("TTS_API_KEY")


def get_tavily_api_key() -> Optional[str]:
    return get_env_value("TAVILY_API_KEY")


def get_artifact_info() -> dict:
    """Read-only metadata about which tt-inference-server release TT Studio is pinned to."""
    return {
        "branch": get_env_value("TT_INFERENCE_ARTIFACT_BRANCH"),
        "version": get_env_value("TT_INFERENCE_ARTIFACT_VERSION"),
    }


__all__ = (
    "env_file_path",
    "read_env_file",
    "write_env_file",
    "get_env_value",
    "get_hf_token",
    "get_tts_api_key",
    "get_tavily_api_key",
    "get_artifact_info",
)
