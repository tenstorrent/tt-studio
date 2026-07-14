# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Consolidated config store — backend accessor (issue #807).

Byte-for-byte twin of the launcher's ``tt_setup/config_store.py`` on-disk
contract: one namespaced JSON file, ``fcntl.flock`` around every
read-modify-write (exclusive for writes, shared for reads), and **in-place**
writes so the single-file bind-mount keeps its inode. The launcher performs the
one-time migration from the legacy files before the container starts and the
file is bind-mounted in read-write; this module therefore never migrates — it
only creates an empty skeleton as a safety net if the mount is somehow missing.

Secrets stay in ``.env``; only non-secret config lives here.
"""

import fcntl
import json
import os
import threading

CONFIG_VERSION = 1
NAMESPACES = ("setup", "state", "preferences", "features", "ui", "deployments", "host_models")

# Path is injected by docker-compose (bind-mount target); the default matches the
# compose wiring so the module also works if the env var is unset.
_DEFAULT_PATH = "/tt_studio_config.json"

# Serializes access within this process; flock serializes across processes.
_lock = threading.RLock()


def _config_path():
    return os.environ.get("TT_STUDIO_CONFIG_PATH") or _DEFAULT_PATH


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


def _ensure_exists():
    path = _config_path()
    if os.path.exists(path):
        return path
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o666)
    with os.fdopen(fd, "r+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            existing = fh.read()
            if not existing.strip():
                json.dump(_empty_config(), fh, indent=2, default=str)
                fh.flush()
                try:
                    os.fsync(fh.fileno())
                except OSError:
                    pass
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)
    try:
        os.chmod(path, 0o666)
    except OSError:
        pass
    return path


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
    """Run ``mutator(config)`` under an exclusive lock and persist in place."""
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
