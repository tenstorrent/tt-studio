# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Consolidated config store for the launcher (issue #807).

One namespaced JSON file (``.tt_studio_config.json`` at the repo root) replaces
the scattered ``.tt_studio_preferences.json`` / ``.tt_studio_setup_config.json``
dotfiles, the backend ``deployments.json`` and the inference-api
``host_volume_models.json``. Secrets stay in ``.env`` — only non-secret config
lives here.

The file is bind-mounted into the backend container, so two processes (this
host-side launcher and the root-owned backend) write it concurrently. Every
read-modify-write therefore holds an ``fcntl.flock`` (exclusive for writes,
shared for reads), and writes happen **in place** (truncate + rewrite, never a
temp-file + rename) so the single-file bind-mount keeps its inode. The backend
carries a byte-for-byte twin of this contract in
``app/backend/shared_config/config_store.py``.
"""

import fcntl
import json
import os
import threading

from tt_setup.constants import (
    INFERENCE_API_DIR,
    LEGACY_SETUP_CONFIG_FILE_PATH,
    PREFS_FILE_PATH,
    SETUP_CONFIG_FILE_PATH,
    TT_STUDIO_CONFIG_PATH,
    TT_STUDIO_ROOT,
)

CONFIG_VERSION = 1
NAMESPACES = ("setup", "state", "preferences", "features", "ui", "deployments", "host_models")

# Serializes access within this process; flock serializes across processes.
_lock = threading.RLock()


def _config_path():
    return os.environ.get("TT_STUDIO_CONFIG_PATH") or TT_STUDIO_CONFIG_PATH


def _empty_config():
    cfg = {"version": CONFIG_VERSION}
    for ns in NAMESPACES:
        cfg[ns] = {}
    return cfg


def _loads(raw):
    """Parse config text, tolerating an empty or corrupt file.

    In-place writes aren't atomic, so a crash mid-write can truncate the file;
    falling back to an empty config lets the next write rebuild it rather than
    bricking startup.
    """
    if not raw.strip():
        return _empty_config()
    try:
        return json.loads(raw)
    except ValueError:
        return _empty_config()


def _normalize(data):
    """Guarantee the version field and every namespace exist."""
    if not isinstance(data, dict):
        data = {}
    data.setdefault("version", CONFIG_VERSION)
    for ns in NAMESPACES:
        if not isinstance(data.get(ns), dict):
            data[ns] = {}
    return data


def _read_json(path):
    try:
        with open(path, "r") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _legacy_deployments_path():
    # Deferred import: env_config imports config_store, so importing it at module
    # scope would be circular.
    try:
        from tt_setup.env_config._dotenv import get_env_var
        vol = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME")
    except Exception:
        vol = ""
    vol = vol or os.environ.get("HOST_PERSISTENT_STORAGE_VOLUME") \
        or os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
    return os.path.join(vol, "backend_volume", "deployments.json")


def _migrate_or_default():
    """Build the initial config by merging any legacy files that still exist."""
    cfg = _empty_config()

    prefs = _read_json(PREFS_FILE_PATH)
    if isinstance(prefs, dict):
        cfg["preferences"].update(prefs)

    setup = _read_json(SETUP_CONFIG_FILE_PATH) or _read_json(LEGACY_SETUP_CONFIG_FILE_PATH)
    if isinstance(setup, dict):
        feature_keys = ("tt_studio_mode", "ai_playground_mode")
        for key, value in setup.items():
            if key in feature_keys:
                cfg["features"][key] = value
            elif key.startswith("vite_"):
                cfg["ui"][key] = value
            else:
                cfg["setup"][key] = value

    deployments = _read_json(_legacy_deployments_path())
    if isinstance(deployments, dict):
        cfg["deployments"] = deployments

    host_models = _read_json(os.path.join(INFERENCE_API_DIR, "host_volume_models.json"))
    if isinstance(host_models, dict):
        cfg["host_models"] = host_models

    return cfg


def _ensure_exists():
    """Create the config file (running the one-time migration) if it is absent."""
    path = _config_path()
    if os.path.exists(path):
        return path
    data = _migrate_or_default()
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o666)
    with os.fdopen(fd, "r+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            existing = fh.read()
            if not existing.strip():
                json.dump(data, fh, indent=2, default=str)
                fh.flush()
                try:
                    os.fsync(fh.fileno())
                except OSError:
                    pass
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)
    # O_CREAT honours the umask; force 0o666 so the container's root user can
    # also write the bind-mounted file.
    try:
        os.chmod(path, 0o666)
    except OSError:
        pass
    return path


def ensure_exists():
    """Create the config file (running the one-time migration) if absent.

    Call this before ``docker compose up`` so the bind-mount target exists as a
    file rather than a Docker-created directory. Returns the file path.
    """
    with _lock:
        return _ensure_exists()


def load():
    """Return the whole config, materializing the file on first access."""
    with _lock:
        path = _ensure_exists()
        with open(path, "r") as fh:
            fcntl.flock(fh, fcntl.LOCK_SH)
            try:
                raw = fh.read()
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
    data = _loads(raw)
    return _normalize(data)


def mutate(mutator):
    """Run ``mutator(config)`` under an exclusive lock and persist in place.

    ``mutator`` edits the dict in place; its return value is passed back to the
    caller.
    """
    with _lock:
        path = _ensure_exists()
        with open(path, "r+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                raw = fh.read()
                data = _normalize(_loads(raw))
                result = mutator(data)
                fh.seek(0)
                fh.truncate()
                json.dump(data, fh, indent=2, default=str)
                fh.flush()
                try:
                    os.fsync(fh.fileno())
                except OSError:
                    pass
                return result
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)


def get(namespace, key, default=None):
    return load().get(namespace, {}).get(key, default)


def set(namespace, key, value):  # noqa: A001 - deliberate config-store verb
    def _apply(data):
        data.setdefault(namespace, {})[key] = value
    mutate(_apply)


def get_ns(namespace):
    """Return a copy of a namespace dict ({} if absent)."""
    return dict(load().get(namespace, {}))


def set_ns(namespace, value):
    """Replace a whole namespace."""
    def _apply(data):
        data[namespace] = value
    mutate(_apply)


def update_ns(namespace, mapping):
    """Shallow-merge ``mapping`` into a namespace."""
    def _apply(data):
        data.setdefault(namespace, {}).update(mapping)
    mutate(_apply)


def mutate_ns(namespace, mutator):
    """Run ``mutator(namespace_dict)`` under the exclusive lock; persist the result.

    If ``mutator`` returns a dict it replaces the namespace; otherwise the dict
    is assumed to have been edited in place. The mutator's non-dict return value
    is passed back to the caller.
    """
    def _apply(data):
        ns = data.setdefault(namespace, {})
        result = mutator(ns)
        if isinstance(result, dict):
            data[namespace] = result
            return None
        return result
    return mutate(_apply)
