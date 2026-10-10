# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""tt-model-manager artifact setup: a pinned venv holding the ``tt_kernel`` package.

The community-model deploy path drives tt-model-manager as a library. It cannot be
installed into inference-api's venv: inference-api pins ``pydantic<2`` (FastAPI <0.69
requires it) and tt_kernel requires ``pydantic>=2``. So it gets its own venv, treated
like the tt-inference-server artifact — pinned in .env, resolved once at startup, and
recreated only when the pin changes, keeping the working install if the new one fails.

Failure here is never fatal: the inference-server deploy path is unaffected, and the
backend hides community models when the artifact is absent.
"""

import json
import os
import shutil

from tt_setup.constants import (
    MODEL_MANAGER_ARTIFACT_DIR,
    MODEL_MANAGER_DEFAULT_REF,
    MODEL_MANAGER_REPO_URL,
)
from tt_setup.console import console, show_detail
from tt_setup.env_config import get_env_var
from tt_setup.shell import run_command

# Written next to the venv so a re-run can tell "already installed at this pin" from
# "installed at a different pin" without importing anything out of the venv.
_STAMP_NAME = "artifact-info.json"
# The working venv, set aside while a different ref installs, then moved to
# _DISCARDED_VENV once the new one works, so a half-deleted venv is never restored.
_PREVIOUS_VENV = ".venv.previous"
_DISCARDED_VENV = ".venv.discarded"


def model_manager_python(artifact_dir=MODEL_MANAGER_ARTIFACT_DIR):
    """Path to the artifact venv's interpreter, whether or not it exists yet."""
    if os.name == "nt":
        return os.path.join(artifact_dir, ".venv", "Scripts", "python.exe")
    return os.path.join(artifact_dir, ".venv", "bin", "python")


def _stamp_path(artifact_dir):
    return os.path.join(artifact_dir, _STAMP_NAME)


def _installed_ref(artifact_dir):
    """The ref recorded by the last successful install, or None."""
    try:
        with open(_stamp_path(artifact_dir)) as handle:
            return (json.load(handle) or {}).get("ref")
    except (OSError, ValueError):
        return None


def _write_stamp(artifact_dir, ref):
    with open(_stamp_path(artifact_dir), "w") as handle:
        json.dump({"ref": ref, "repo": MODEL_MANAGER_REPO_URL}, handle, indent=2)


def _resolve_ref():
    """The pinned ref: a tag, branch, or commit SHA of tt-model-manager."""
    return (get_env_var("TT_MODEL_MANAGER_REF") or "").strip() or MODEL_MANAGER_DEFAULT_REF


def _create_venv(venv_dir):
    """Create the venv with uv when available, else stdlib venv.

    uv is preferred only because it resolves the install an order of magnitude
    faster; nothing here depends on it being present.
    """
    if shutil.which("uv"):
        result = run_command(["uv", "venv", venv_dir], capture_output=True)
        if result and result.returncode == 0:
            return True
    result = run_command(["python3", "-m", "venv", venv_dir], capture_output=True)
    return bool(result and result.returncode == 0)


def _install_package(venv_dir, python, ref):
    """Install the pinned tt-model-manager into the venv."""
    spec = f"tt-model @ git+{MODEL_MANAGER_REPO_URL}@{ref}"
    if shutil.which("uv"):
        result = run_command(
            ["uv", "pip", "install", "--python", python, spec], capture_output=True
        )
        if result and result.returncode == 0:
            return True, ""
    pip = os.path.join(venv_dir, "Scripts" if os.name == "nt" else "bin", "pip")
    result = run_command([pip, "install", spec], capture_output=True)
    if result and result.returncode == 0:
        return True, ""
    stderr = (getattr(result, "stderr", "") or "").strip()
    return False, stderr.splitlines()[-1] if stderr else "pip install failed"


def _install(venv_dir, python, ref):
    """Create the venv and install ``ref`` into it. Returns an error message, or None."""
    if not _create_venv(venv_dir):
        return "could not create the venv"
    ok, detail = _install_package(venv_dir, python, ref)
    return None if ok else detail


def setup_tt_model_manager(artifact_dir=MODEL_MANAGER_ARTIFACT_DIR, force=False):
    """Ensure the pinned tt-model-manager venv exists. Returns True when usable.

    Idempotent: an install already at the requested ref is left alone, so a normal
    start costs one file read.
    """
    ref = _resolve_ref()
    python = model_manager_python(artifact_dir)
    venv_dir = os.path.join(artifact_dir, ".venv")
    previous_dir = os.path.join(artifact_dir, _PREVIOUS_VENV)
    discarded_dir = os.path.join(artifact_dir, _DISCARDED_VENV)
    shutil.rmtree(discarded_dir, ignore_errors=True)
    if os.path.isdir(previous_dir):
        # An earlier install was interrupted; the set-aside venv still matches the stamp.
        shutil.rmtree(venv_dir, ignore_errors=True)
        os.rename(previous_dir, venv_dir)

    if not force and os.path.exists(python) and _installed_ref(artifact_dir) == ref:
        if show_detail():
            console.print(f"[muted]tt-model-manager already at {ref}[/muted]")
        return True

    # Replace rather than install over the old venv, so a downgrade cannot leave
    # newer files behind.
    has_previous = os.path.exists(python)
    if has_previous:
        os.rename(venv_dir, previous_dir)
    else:
        shutil.rmtree(venv_dir, ignore_errors=True)
    os.makedirs(artifact_dir, exist_ok=True)

    error = _install(venv_dir, python, ref)
    if error:
        shutil.rmtree(venv_dir, ignore_errors=True)
        if has_previous:
            os.rename(previous_dir, venv_dir)
            console.print(f"[warning]⚠️  Could not install tt-model-manager@{ref} ({error}); "
                          f"keeping {_installed_ref(artifact_dir) or 'the installed version'}[/warning]")
            return True
        console.print(f"[warning]⚠️  Could not install tt-model-manager@{ref} ({error}) — "
                      "community models will be unavailable[/warning]")
        return False

    if has_previous:
        os.rename(previous_dir, discarded_dir)
    _write_stamp(artifact_dir, ref)
    shutil.rmtree(discarded_dir, ignore_errors=True)
    if show_detail():
        console.print(f"[success]✅ tt-model-manager installed at {ref}[/success]")
    return True


def model_manager_status(artifact_dir=MODEL_MANAGER_ARTIFACT_DIR):
    """What the launcher knows about the artifact, for --info and diagnostics."""
    python = model_manager_python(artifact_dir)
    return {
        "available": os.path.exists(python),
        "python": python,
        "ref": _installed_ref(artifact_dir),
        "requested_ref": _resolve_ref(),
    }
