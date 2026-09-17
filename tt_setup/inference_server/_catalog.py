# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sync the backend model catalog from the inference-server artifact."""

import json
import os
import sys
import subprocess
from tt_setup.constants import *
from tt_setup.console import console, is_verbose


def _catalog_missing_generated_specs(models_json_path: str) -> bool:
    """True if the catalog references a runtime_model_spec_overrides file (e.g.
    a chip-tier spec like bge-m3-p150.json) that isn't actually on disk.

    These per-device spec files are generated as a side effect of
    _sync_model_catalog() but are gitignored, unlike the catalog JSON itself
    (which IS committed). So on a fresh clone the catalog already "exists" and
    the normal should_sync check never fires sync -- leaving the catalog
    pointing at spec files that were never generated on this machine. This
    catches that case so sync still runs once to generate them.
    """
    try:
        with open(models_json_path) as f:
            catalog = json.load(f)
    except (OSError, json.JSONDecodeError):
        return False
    for model in catalog.get("models", []):
        for rel_path in (model.get("runtime_model_spec_overrides") or {}).values():
            if not os.path.exists(os.path.join(TT_STUDIO_ROOT, rel_path)):
                return True
    return False


def _sync_model_catalog():
    """
    Sync model catalog from the TT Inference Server artifact.
    Runs sync_models_from_inference_server.py to generate models_from_inference_server.json.
    """
    sync_script = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config",
        "sync_models_from_inference_server.py",
    )

    if not os.path.exists(sync_script):
        console.print(f"[warning]⚠️  Model catalog sync script not found: {sync_script}[/warning]")
        return False

    try:
        env = os.environ.copy()
        if os.path.exists(INFERENCE_ARTIFACT_DIR):
            env["TT_INFERENCE_ARTIFACT_PATH"] = INFERENCE_ARTIFACT_DIR

        result = subprocess.run(
            [sys.executable, sync_script],
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
