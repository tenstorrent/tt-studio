# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Consolidated launcher config store (issue #807).

One namespaced JSON file (``.tt_studio_config.json`` at the repo root) replaces
the two scattered launcher dotfiles: ``.tt_studio_preferences.json`` (CLI
preferences) and ``.tt_studio_setup_config.json`` (quick-setup snapshot).
Secrets stay in ``.env`` — only non-secret CLI config lives here.

The file is written only by this host-side launcher process, so an in-process
lock plus atomic (temp-file + rename) writes are enough; no cross-process
locking is required.
"""

import json
import os
import threading

from tt_setup.constants import (
    LEGACY_SETUP_CONFIG_FILE_PATH,
    PREFS_FILE_PATH,
    SETUP_CONFIG_FILE_PATH,
    TT_STUDIO_CONFIG_PATH,
)

CONFIG_VERSION = 1
NAMESPACES = ("setup", "preferences", "features", "ui")

# Serializes read-modify-write access within this process.
_lock = threading.RLock()


def _config_path():
    return os.environ.get("TT_STUDIO_CONFIG_PATH") or TT_STUDIO_CONFIG_PATH


def _empty_config():
    cfg = {"version": CONFIG_VERSION}
    for ns in NAMESPACES:
        cfg[ns] = {}
    return cfg


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


def _migrate_or_default():
    """Build the initial config by merging any legacy dotfiles that still exist."""
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

    return cfg


def _write(path, data):
    """Persist atomically (temp file + rename) so a crash can't truncate the store."""
    tmp = f"{path}.tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2, default=str)
    os.replace(tmp, path)


def load():
    """Return the whole config, running the one-time migration on first access."""
    with _lock:
        path = _config_path()
        data = _read_json(path)
        if data is None:
            data = _migrate_or_default()
            _write(path, data)
        return _normalize(data)


def mutate(mutator):
    """Run ``mutator(config)`` under the in-process lock and persist the result.

    ``mutator`` edits the dict in place; its return value is passed back to the
    caller.
    """
    with _lock:
        data = load()
        result = mutator(data)
        _write(_config_path(), data)
        return result


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
