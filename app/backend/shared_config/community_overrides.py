# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Load and validate community_overrides.toml (co-located with this file).

The community counterpart of model_overrides.py: which page drives each
tt-model-manager bundle, why some have none, and which bundles are hidden outright.
Loaded by community_model_config, which supplies the model types it has routes for,
so an entry serving a type with no page behind it fails at startup instead of
offering an interaction page that 404s.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Collection, Dict, Optional, Tuple

from shared_config.model_overrides import VALID_REASONS, OverridesError
from shared_config.model_type_config import ModelTypes

OVERRIDES_PATH = Path(__file__).parent / "community_overrides.toml"
OVERRIDES_SCHEMA_VERSION = 1
SERVE_BY_TASK = "task"

Mark = Tuple[str, str]  # (reason, details)


@dataclass(frozen=True)
class Engine:
    """How bundles of one engine are served. ``serve_as`` None means by Hub task."""

    serve_as: Optional[ModelTypes]
    vllm_mesh_fallback: bool = False


def _details(entry: dict) -> str:
    return " ".join(str(entry.get("details") or "").split())


def _model_type(value: str, servable: Collection[ModelTypes], where: str) -> ModelTypes:
    try:
        model_type = ModelTypes(value)
    except ValueError:
        raise OverridesError(f"{where}: unknown model type {value!r}.") from None
    if model_type not in servable:
        raise OverridesError(
            f"{where}: {value!r} has no community route defaults; servable types are "
            f"{sorted(t.value for t in servable)}."
        )
    return model_type


def _require(entry: dict, fields: Tuple[str, ...], where: str) -> None:
    missing = [f for f in fields if not entry.get(f)]
    if missing:
        raise OverridesError(
            f"{where}: entry {entry!r} is missing {', '.join(missing)}."
        )


def _mark(entry: dict, where: str) -> Mark:
    _require(entry, ("reason", "details"), where)
    if entry["reason"] not in VALID_REASONS:
        raise OverridesError(
            f"{where}: unknown reason {entry['reason']!r}; expected one of {VALID_REASONS}."
        )
    return entry["reason"], _details(entry)


def _parse_engines(entries, servable, where) -> Dict[str, Engine]:
    engines: Dict[str, Engine] = {}
    for entry in entries:
        _require(entry, ("kind", "serve_as"), where)
        if entry["kind"] in engines:
            raise OverridesError(f"{where}: duplicate [[engine]] {entry['kind']!r}.")
        serve_as = entry["serve_as"]
        engines[entry["kind"]] = Engine(
            serve_as=None
            if serve_as == SERVE_BY_TASK
            else _model_type(serve_as, servable, f"{where} [[engine]] {entry['kind']}"),
            vllm_mesh_fallback=bool(entry.get("vllm_mesh_fallback", False)),
        )
    return engines


def _parse_tasks(
    entries, servable, where
) -> Tuple[Dict[str, ModelTypes], Dict[str, str]]:
    """Tasks served by a page, and the details of why the others have none."""
    served: Dict[str, ModelTypes] = {}
    no_page: Dict[str, str] = {}
    for entry in entries:
        _require(entry, ("task",), where)
        task = entry["task"]
        if task in served or task in no_page:
            raise OverridesError(f"{where}: duplicate [[task]] {task!r}.")
        if entry.get("serve_as"):
            served[task] = _model_type(
                entry["serve_as"], servable, f"{where} [[task]] {task}"
            )
        else:
            _require(entry, ("details",), f"{where} [[task]] {task} (no serve_as)")
            no_page[task] = _details(entry)
    return served, no_page


def _parse_unavailable(entries, where) -> Dict[Tuple[str, Optional[str]], Mark]:
    marks: Dict[Tuple[str, Optional[str]], Mark] = {}
    for entry in entries:
        _require(entry, ("repo",), where)
        key = (entry["repo"], entry.get("profile"))
        if key in marks:
            raise OverridesError(
                f"{where}: duplicate [[unavailable]] for {key[0]} / {key[1] or '(bundle-wide)'}."
            )
        marks[key] = _mark(entry, f"{where} [[unavailable]] {entry['repo']}")
    return marks


class CommunityOverrides:
    """Parsed, validated contents of community_overrides.toml."""

    def __init__(
        self, servable: Collection[ModelTypes], path: Path = OVERRIDES_PATH
    ) -> None:
        where = str(path)
        try:
            doc = tomllib.loads(path.read_text())
        except FileNotFoundError:
            raise OverridesError(f"{where}: not found.") from None
        except tomllib.TOMLDecodeError as exc:
            raise OverridesError(f"{where}: invalid TOML ({exc}).") from exc

        if doc.get("schema_version") != OVERRIDES_SCHEMA_VERSION:
            raise OverridesError(
                f"{where}: schema_version {doc.get('schema_version')!r}, "
                f"expected {OVERRIDES_SCHEMA_VERSION}."
            )
        self.engines = _parse_engines(doc.get("engine") or [], servable, where)
        self.served_tasks, self.no_page_tasks = _parse_tasks(
            doc.get("task") or [], servable, where
        )
        self.unavailable = _parse_unavailable(doc.get("unavailable") or [], where)

    def unavailable_mark(
        self, repo_id: str, profile: Optional[str] = None
    ) -> Optional[Mark]:
        """Why a bundle (or one of its profiles) is hidden, or None when it is offered."""
        return self.unavailable.get((repo_id, None)) or (
            self.unavailable.get((repo_id, profile)) if profile else None
        )
