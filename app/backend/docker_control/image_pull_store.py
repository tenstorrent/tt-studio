# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Durable, cross-process store for image-pull progress.

Why this exists: the backend runs multiple uvicorn workers (``--workers 4`` in
app/docker-compose.yml). A module-level dict is per-process, so the worker that
mints a ``pull_id`` and runs its pull thread is usually NOT the worker that serves
the client's progress polls — roughly 3 in 4 polls landed on a process that had
never heard of the job and returned ``not_found``, which the UI rendered as
"Deployment failed" while the pull was in fact running fine.

Design mirrors deployment_store.py (the house pattern for shared state): JSON in
the persistent volume, atomic replace, no new dependency or migration. Differences:

  * **One file per pull_id.** Concurrent pulls never touch the same file, so two
    pulls can't clobber each other's updates.
  * **flock on read-modify-write.** A threading.Lock only guards one process;
    progress updates cross process boundaries here, so we take an OS-level
    exclusive lock for the read-modify-write cycle.

Entries are self-expiring in two senses: finished ones are evicted after
``ENTRY_TTL_SECONDS``, and a "pulling" entry whose owner process died stops being
refreshed — ``is_stalled()`` detects that, so a dead pull surfaces as an error
instead of sitting at "pulling" forever.
"""

from __future__ import annotations

import errno
import fcntl
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_STORE_DIR = (
    Path(os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume"))
    / "backend_volume"
    / "image_pulls"
)

# Guards this process's own read-modify-write cycles; flock guards across processes.
_local_lock = threading.Lock()

# Degraded-mode fallback. If the persistent volume isn't writable (it has had
# permission problems in the field), file ops raise and we keep state in-process
# instead. That is exactly the old per-worker behaviour — no worse than before —
# rather than making every pull look orphaned, which would be far worse.
_fallback: Dict[str, dict] = {}
_fallback_active = False


def _use_fallback(reason: str) -> None:
    global _fallback_active
    if not _fallback_active:
        _fallback_active = True
        logger.warning(
            f"[image_pull_store] persistent store unavailable ({reason}); falling back "
            "to per-process memory. Pull progress will not survive across workers."
        )

ENTRY_TTL_SECONDS = 3600  # evict finished entries after an hour

# A live worker refreshes updated_at at least every _HEARTBEAT_INTERVAL_SECONDS
# (30s in image_pull.py). Allow generous slack for a loaded box before calling a
# pull stalled — a false positive would fail a healthy multi-GB pull.
STALL_AFTER_SECONDS = 180


def _path_for(pull_id: str) -> Path:
    # pull_ids are minted as f"imgpull_{uuid4().hex}", but never build a path from
    # unvalidated input — a stray separator would escape the store directory.
    safe = "".join(c for c in pull_id if c.isalnum() or c in ("_", "-"))
    if not safe:
        raise ValueError(f"unusable pull_id: {pull_id!r}")
    return _STORE_DIR / f"{safe}.json"


def _ensure_dir() -> None:
    _STORE_DIR.mkdir(parents=True, exist_ok=True)


def _write_atomic(path: Path, data: dict) -> None:
    """Write JSON via a temp file in the same directory + os.replace, so a reader
    never observes a partially written file."""
    _ensure_dir()
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, default=str)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def create_entry(pull_id: str, entry: dict) -> None:
    """Persist a new pull-job entry, replacing any stale file for the same id."""
    try:
        _write_atomic(_path_for(pull_id), entry)
    except Exception as e:
        # Never block a deploy on the progress store — the pull itself still runs.
        _use_fallback(str(e))
        with _local_lock:
            _fallback[pull_id] = dict(entry)


def get_entry(pull_id: str) -> Optional[dict]:
    """Return the stored snapshot, or None when this id isn't tracked."""
    try:
        path = _path_for(pull_id)
    except ValueError:
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        with _local_lock:
            entry = _fallback.get(pull_id)
            return dict(entry) if entry is not None else None
    except (json.JSONDecodeError, OSError) as e:
        # A torn read shouldn't look like "job doesn't exist" — that would be
        # reported as a hard failure. Surface it as unknown-but-present instead.
        logger.warning(f"[image_pull_store] unreadable entry {pull_id}: {e}")
        return None


def update_entry(pull_id: str, **changes) -> Optional[dict]:
    """Read-modify-write one entry under an exclusive cross-process lock.

    Returns the updated snapshot, or None if the entry is gone.
    """
    try:
        path = _path_for(pull_id)
    except ValueError:
        return None

    with _local_lock:
        try:
            _ensure_dir()
            # Open r+ so we hold the lock on the very file we're updating.
            with open(path, "r+") as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    try:
                        f.seek(0)
                        entry = json.load(f)
                    except json.JSONDecodeError:
                        return None
                    entry.update(changes)
                    entry["updated_at"] = time.time()
                    # Rewrite in place while holding the lock. The file is small and
                    # written whole, so truncate-then-write is safe here; readers that
                    # catch a torn read fall back to "unknown", never to "not found".
                    f.seek(0)
                    f.truncate()
                    json.dump(entry, f, default=str)
                    f.flush()
                    os.fsync(f.fileno())
                    return entry
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except FileNotFoundError:
            return _update_fallback_locked(pull_id, changes)
        except OSError as e:
            if e.errno == errno.ENOENT:
                return _update_fallback_locked(pull_id, changes)
            _use_fallback(str(e))
            return _update_fallback_locked(pull_id, changes)


def bump_peak_progress(pull_id: str, pct: int) -> int:
    """Raise the stored peak percent to at least ``pct`` and return the peak.

    Kept in the store (rather than read-then-update by the caller) so the
    read-compare-write runs inside one cross-process lock — otherwise two workers
    could interleave and let the reported percent go backwards, which is exactly
    what the clamp exists to prevent.
    """
    try:
        path = _path_for(pull_id)
    except ValueError:
        return pct
    with _local_lock:
        try:
            with open(path, "r+") as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    try:
                        f.seek(0)
                        entry = json.load(f)
                    except json.JSONDecodeError:
                        return pct
                    peak = max(int(entry.get("peak_progress") or 0), int(pct))
                    entry["peak_progress"] = peak
                    entry["updated_at"] = time.time()
                    f.seek(0)
                    f.truncate()
                    json.dump(entry, f, default=str)
                    f.flush()
                    return peak
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except (FileNotFoundError, OSError):
            entry = _fallback.get(pull_id)
            if entry is None:
                return pct
            peak = max(int(entry.get("peak_progress") or 0), int(pct))
            entry["peak_progress"] = peak
            entry["updated_at"] = time.time()
            return peak


def _update_fallback_locked(pull_id: str, changes: dict) -> Optional[dict]:
    """Apply an update to the in-process fallback. Caller holds _local_lock."""
    entry = _fallback.get(pull_id)
    if entry is None:
        return None
    entry.update(changes)
    entry["updated_at"] = time.time()
    return dict(entry)


def delete_entry(pull_id: str) -> None:
    with _local_lock:
        _fallback.pop(pull_id, None)
    try:
        _path_for(pull_id).unlink()
    except (FileNotFoundError, ValueError):
        pass
    except OSError as e:
        logger.debug(f"[image_pull_store] could not delete entry {pull_id}: {e}")


def is_stalled(entry: dict) -> bool:
    """True when an entry claims to be pulling but nothing has refreshed it.

    The owning worker heartbeats ``updated_at`` while it runs, so a gap beyond
    STALL_AFTER_SECONDS means that process is gone (restart, --reload, crash) and
    no one is driving this pull any more.
    """
    if entry.get("status") != "pulling":
        return False
    try:
        updated_at = float(entry.get("updated_at") or 0)
    except (TypeError, ValueError):
        return False
    return (time.time() - updated_at) > STALL_AFTER_SECONDS


def all_entries() -> Dict[str, dict]:
    """Every tracked pull, keyed by pull_id. Used for reconciliation."""
    out: Dict[str, dict] = {}
    try:
        if not _STORE_DIR.exists():
            return out
        for path in _STORE_DIR.glob("*.json"):
            try:
                with open(path, "r") as f:
                    out[path.stem] = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
    except OSError as e:
        logger.debug(f"[image_pull_store] could not list entries: {e}")
    return out


def evict_stale() -> List[str]:
    """Drop finished entries past their TTL. Returns the ids removed.

    Unlike the previous in-memory eviction this also removes long-dead "pulling"
    entries: one whose owner died is never going to finish, and leaving it behind
    made every future lookup return a job that looks perpetually in progress.
    """
    removed: List[str] = []
    now = time.time()
    for pull_id, entry in all_entries().items():
        try:
            updated_at = float(entry.get("updated_at") or 0)
        except (TypeError, ValueError):
            updated_at = 0
        age = now - updated_at
        finished = entry.get("status") != "pulling"
        if (finished and age > ENTRY_TTL_SECONDS) or (
            not finished and age > max(ENTRY_TTL_SECONDS, STALL_AFTER_SECONDS * 4)
        ):
            delete_entry(pull_id)
            removed.append(pull_id)
    return removed
