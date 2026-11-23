# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Which copy of each artifact a run uses: its version, and whether it is TT Studio's own.

Recorded at startup and shown in the ready panel. ``--info`` reads the record back
instead of re-resolving, because its shell may not have the TT_INFERENCE_SERVER_DIR /
TT_MODEL_MANAGER_PYTHON that the launching process (e.g. tt-cli) had.
"""

import json
import os

from tt_setup.constants import (
    EXTERNAL_INFERENCE_ARTIFACT_DIR,
    INFERENCE_ARTIFACT_DIR,
    LOGS_DIR,
    MODEL_MANAGER_ARTIFACT_DIR,
)
from tt_setup.model_manager import model_manager_status

SOURCES_FILE = os.path.join(LOGS_DIR, "artifact-sources.json")

# (record key, ready-panel label, the variable that points it at an external copy)
_ARTIFACTS = (
    ("inference_server", "Inference server", "TT_INFERENCE_SERVER_DIR"),
    ("model_manager", "Model manager", "TT_MODEL_MANAGER_PYTHON"),
)


def _inference_server():
    try:
        with open(os.path.join(INFERENCE_ARTIFACT_DIR, "VERSION")) as f:
            version = f.read().strip().lstrip("v")
    except OSError:
        if not os.path.isdir(INFERENCE_ARTIFACT_DIR):
            return None
        version = ""
    return {
        "version": f"v{version}" if version else None,
        "path": INFERENCE_ARTIFACT_DIR,
        "external": bool(EXTERNAL_INFERENCE_ARTIFACT_DIR),
    }


def _model_manager():
    status = model_manager_status()
    if not status["available"]:
        return None
    if status["external"]:
        return {"version": status["version"], "path": status["python"], "external": True}
    return {"version": (status["ref"] or "")[:8] or None, "path": MODEL_MANAGER_ARTIFACT_DIR,
            "external": False}


def record_artifact_sources():
    """Resolve and save what this run uses. Returns the record."""
    sources = {"inference_server": _inference_server(), "model_manager": _model_manager()}
    try:
        with open(SOURCES_FILE, "w") as f:
            json.dump(sources, f, indent=2)
    except OSError:
        pass  # only the --info re-view loses it
    return sources


def load_artifact_sources():
    """The record from the last startup, or {} when there is none."""
    try:
        with open(SOURCES_FILE) as f:
            sources = json.load(f)
    except (OSError, ValueError):
        return {}
    return sources if isinstance(sources, dict) else {}


def _short(path):
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path.startswith(home + os.sep) else path


def artifact_rows(sources):
    """Ready-panel rows, e.g. ("Inference server", "v0.24.0 · TT Studio's own")."""
    rows = []
    for key, label, var in _ARTIFACTS:
        source = sources.get(key)
        if not isinstance(source, dict):
            continue
        version = source.get("version") or "unknown version"
        if source.get("external"):
            origin = f"external ({var}) · {_short(source.get('path') or '?')}"
        else:
            origin = "TT Studio's own"
        rows.append((label, f"{version} · {origin}"))
    return rows
