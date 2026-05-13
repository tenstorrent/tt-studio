# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

"""
Thread-safe JSON file store replacing Django ORM for ModelDeployment.

Provides a drop-in ORM-like interface (objects.create, filter, all, get, save)
backed by a single JSON file in the persistent storage volume.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

_STORE_PATH = (
    Path(os.getenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/tt_studio_persistent_volume"))
    / "backend_volume"
    / "deployments.json"
)

_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if s is None:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _sort_key(record: dict, field: str):
    """Return a sortable key for a field, handling None and datetime strings."""
    val = record.get(field)
    if val is None:
        return ""
    return val  # ISO strings sort lexicographically = chronologically


def _normalize_device_ids(device_ids: Any, fallback_device_id: Any = 0) -> List[int]:
    """Normalize device IDs into a non-empty list of integers."""
    if device_ids is None:
        raw_items = [fallback_device_id]
    elif isinstance(device_ids, str):
        raw_items = [part.strip() for part in device_ids.split(",")]
    elif isinstance(device_ids, (list, tuple, set)):
        raw_items = list(device_ids)
    else:
        raw_items = [device_ids]

    normalized: List[int] = []
    for item in raw_items:
        try:
            normalized.append(int(item))
        except (TypeError, ValueError):
            continue

    if not normalized:
        try:
            return [int(fallback_device_id)]
        except (TypeError, ValueError):
            return [0]

    # De-duplicate while preserving order.
    deduped: List[int] = []
    seen = set()
    for device_id in normalized:
        if device_id in seen:
            continue
        seen.add(device_id)
        deduped.append(device_id)
    return deduped


def _load_raw() -> dict:
    if not _STORE_PATH.exists():
        return {"next_id": 1, "records": []}
    try:
        with open(_STORE_PATH, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Could not read deployment store, starting fresh: {e}")
        return {"next_id": 1, "records": []}


def _save_raw(data: dict) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORE_PATH.with_suffix(".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2, default=str)
        os.replace(tmp, _STORE_PATH)
    except Exception as e:
        logger.error(f"Failed to save deployment store: {e}")
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


def _match(record: dict, kwargs: dict) -> bool:
    """Match a record against filter kwargs, supporting __in and __isnull suffixes."""
    for key, val in kwargs.items():
        if key.endswith("__in"):
            field = key[: -len("__in")]
            if record.get(field) not in val:
                return False
        elif key.endswith("__isnull"):
            field = key[: -len("__isnull")]
            is_null = record.get(field) is None
            if is_null != val:
                return False
        else:
            if record.get(key) != val:
                return False
    return True


class _QuerySet:
    def __init__(self, records: List[dict]):
        self._records = records

    def filter(self, **kwargs) -> "_QuerySet":
        return _QuerySet([r for r in self._records if _match(r, kwargs)])

    def order_by(self, *fields) -> "_QuerySet":
        records = list(self._records)
        for field in reversed(fields):
            reverse = field.startswith("-")
            fname = field.lstrip("-")
            records.sort(key=lambda r: _sort_key(r, fname), reverse=reverse)
        return _QuerySet(records)

    def first(self) -> Optional["ModelDeployment"]:
        if not self._records:
            return None
        return ModelDeployment._from_dict(self._records[0])

    def exists(self) -> bool:
        return len(self._records) > 0

    def count(self) -> int:
        return len(self._records)

    def get(self, **kwargs) -> "ModelDeployment":
        matches = [r for r in self._records if _match(r, kwargs)]
        if not matches:
            raise ModelDeployment.DoesNotExist(f"No record matching {kwargs}")
        if len(matches) > 1:
            raise Exception(f"Multiple records matching {kwargs}")
        return ModelDeployment._from_dict(matches[0])

    def __iter__(self):
        return (ModelDeployment._from_dict(r) for r in self._records)

    def __getitem__(self, key):
        if isinstance(key, slice):
            return _QuerySet(self._records[key])
        return ModelDeployment._from_dict(self._records[key])

    def __len__(self) -> int:
        return len(self._records)


class _Manager:
    def create(self, **kwargs) -> "ModelDeployment":
        with _lock:
            data = _load_raw()
            normalized_device_ids = _normalize_device_ids(
                kwargs.get("device_ids"),
                kwargs.get("device_id", 0),
            )
            record = {
                "id": data["next_id"],
                "container_id": kwargs.get("container_id", ""),
                "container_name": kwargs.get("container_name", ""),
                "model_name": kwargs.get("model_name", ""),
                "device": kwargs.get("device", ""),
                "deployed_at": _now().isoformat(),
                "stopped_at": None,
                "status": kwargs.get("status", "running"),
                "stopped_by_user": kwargs.get("stopped_by_user", False),
                "port": kwargs.get("port", None),
                "device_id": normalized_device_ids[0],
                "device_ids": normalized_device_ids,
                "workflow_log_path": kwargs.get("workflow_log_path", None),
            }
            data["next_id"] += 1
            data["records"].append(record)
            _save_raw(data)
        return ModelDeployment._from_dict(record)

    def all(self) -> _QuerySet:
        with _lock:
            data = _load_raw()
        return _QuerySet(list(data["records"]))

    def filter(self, **kwargs) -> _QuerySet:
        return self.all().filter(**kwargs)

    def get(self, **kwargs) -> "ModelDeployment":
        return self.all().get(**kwargs)


class ModelDeployment:
    class DoesNotExist(Exception):
        pass

    objects: _Manager  # set below

    def __init__(self):
        self.id: Optional[int] = None
        self.container_id: str = ""
        self.container_name: str = ""
        self.model_name: str = ""
        self.device: str = ""
        self.deployed_at: Optional[datetime] = None
        self.stopped_at: Optional[datetime] = None
        self.status: str = "running"
        self.stopped_by_user: bool = False
        self.port: Optional[int] = None
        self.device_id: int = 0
        self.device_ids: List[int] = [0]
        self.workflow_log_path: Optional[str] = None

    @classmethod
    def _from_dict(cls, d: dict) -> "ModelDeployment":
        obj = cls()
        obj.id = d.get("id")
        obj.container_id = d.get("container_id", "")
        obj.container_name = d.get("container_name", "")
        obj.model_name = d.get("model_name", "")
        obj.device = d.get("device", "")
        obj.deployed_at = _parse_dt(d.get("deployed_at"))
        obj.stopped_at = _parse_dt(d.get("stopped_at"))
        obj.status = d.get("status", "running")
        obj.stopped_by_user = d.get("stopped_by_user", False)
        obj.port = d.get("port")
        normalized_device_ids = _normalize_device_ids(
            d.get("device_ids"),
            d.get("device_id", 0),
        )
        obj.device_ids = normalized_device_ids
        obj.device_id = normalized_device_ids[0]
        obj.workflow_log_path = d.get("workflow_log_path")
        return obj

    def _to_dict(self) -> dict:
        return {
            "id": self.id,
            "container_id": self.container_id,
            "container_name": self.container_name,
            "model_name": self.model_name,
            "device": self.device,
            "deployed_at": self.deployed_at.isoformat() if self.deployed_at else None,
            "stopped_at": self.stopped_at.isoformat() if self.stopped_at else None,
            "status": self.status,
            "stopped_by_user": self.stopped_by_user,
            "port": self.port,
            "device_id": self.device_ids[0] if self.device_ids else self.device_id,
            "device_ids": self.device_ids if self.device_ids else [self.device_id],
            "workflow_log_path": self.workflow_log_path,
        }

    def save(self) -> None:
        with _lock:
            data = _load_raw()
            for i, r in enumerate(data["records"]):
                if r.get("id") == self.id:
                    data["records"][i] = self._to_dict()
                    _save_raw(data)
                    return
            # Not found — append as new (shouldn't happen in normal flow)
            logger.warning(f"save() called on deployment id={self.id} not found in store; appending")
            data["records"].append(self._to_dict())
            _save_raw(data)

    def __str__(self) -> str:
        return f"{self.model_name} on {self.device} - {self.status}"


ModelDeployment.objects = _Manager()
