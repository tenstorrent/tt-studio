# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sync the backend model catalog from the inference-server artifact."""

import os
import sys
import subprocess
from tt_setup.constants import *
from tt_setup.console import console, is_verbose


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
