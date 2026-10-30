# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sync the backend model catalog from the inference-server artifact."""

import json
import os
import sys
import subprocess
from tt_setup.constants import *
from tt_setup.console import console, is_verbose
from tt_setup.inference_server._upgrade import _installed_version


SYNC_SCRIPT = os.path.join(TT_STUDIO_ROOT, "app", "backend", "shared_config", "sync_models_from_inference_server.py")
CATALOG_JSON = os.path.join(os.path.dirname(SYNC_SCRIPT), "models_from_inference_server.json")


def _run_sync(*args):
    try:
        env = os.environ.copy()
        if os.path.exists(INFERENCE_ARTIFACT_DIR):
            env["TT_INFERENCE_ARTIFACT_PATH"] = INFERENCE_ARTIFACT_DIR

        result = subprocess.run(
            [sys.executable, SYNC_SCRIPT, *args],
            capture_output=True, text=True, check=False, env=env,
        )

        if result.returncode == 0:
            console.print("[success]✅ Model catalog synced successfully[/success]")
            if is_verbose() and result.stdout.strip():
                for line in result.stdout.strip().splitlines():
                    console.print(f"[muted]   {line}[/muted]")
            return True
        else:
            console.print(f"[warning]⚠️  Model catalog sync returned exit code {result.returncode}[/warning]")
            if is_verbose() and result.stderr.strip():
                for line in result.stderr.strip().splitlines()[-5:]:
                    console.print(f"[muted]   {line}[/muted]")
            return False
    except Exception as e:
        console.print(f"[warning]⚠️  Model catalog sync failed: {e}[/warning]")
        return False


def _sync_model_catalog():
    """Sync the model catalog; if that fails, retry from the artifact and model_overrides.toml alone."""
    if not os.path.exists(SYNC_SCRIPT):
        console.print(f"[warning]⚠️  Model catalog sync script not found: {SYNC_SCRIPT}[/warning]")
        return False
    if _run_sync():
        return True
    console.print("[warning]⚠️  Retrying the model catalog sync without the model support spec[/warning]")
    return _run_sync("--no-model-support")


def catalog_matches_artifact():
    """Whether the catalog was built from the installed artifact (True when either version is unknown)."""
    installed = _installed_version()
    try:
        with open(CATALOG_JSON) as f:
            built_from = (json.load(f).get("source") or {}).get("artifact_version")
    except (OSError, ValueError, AttributeError):
        built_from = None
    return not installed or not built_from or str(built_from).lstrip("v") == installed
