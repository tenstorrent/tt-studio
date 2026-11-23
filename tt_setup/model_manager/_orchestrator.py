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

import functools
import json
import os
import shutil
import subprocess

from tt_setup.constants import (
    EXTERNAL_MODEL_MANAGER_PYTHON,
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


def model_manager_python(artifact_dir=None):
    """Path to the artifact venv's interpreter, whether or not it exists yet.

    Without ``artifact_dir``, an interpreter given in TT_MODEL_MANAGER_PYTHON wins.
    """
    if artifact_dir is None:
        if EXTERNAL_MODEL_MANAGER_PYTHON:
            return EXTERNAL_MODEL_MANAGER_PYTHON
        artifact_dir = MODEL_MANAGER_ARTIFACT_DIR
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


def _install_package(python, ref):
    """Install the pinned tt-model-manager into the venv.

    Only runs executables known to exist (uv found on PATH, or the venv's own
    interpreter): run_command exits the launcher on a missing binary, and a
    uv-created venv has no pip of its own.
    """
    spec = f"tt-model @ git+{MODEL_MANAGER_REPO_URL}@{ref}"
    if shutil.which("uv"):
        command = ["uv", "pip", "install", "--python", python, spec]
    else:
        command = [python, "-m", "pip", "install", spec]
    result = run_command(command, capture_output=True)
    if result and result.returncode == 0:
        return True, ""
    stderr = (getattr(result, "stderr", "") or "").strip()
    return False, stderr.splitlines()[-1].strip() if stderr else "install failed"


def _install(venv_dir, python, ref):
    """Create the venv and install ``ref`` into it. Returns an error message, or None."""
    if not _create_venv(venv_dir):
        return "could not create the venv"
    ok, detail = _install_package(python, ref)
    return None if ok else detail


def _check_external():
    """Whether the TT_MODEL_MANAGER_PYTHON interpreter can import tt_kernel."""
    python = EXTERNAL_MODEL_MANAGER_PYTHON
    error = None
    if not os.path.isfile(python):
        error = "no such interpreter"
    else:
        try:
            result = subprocess.run([python, "-c", "import tt_kernel"],
                                    capture_output=True, text=True, timeout=60, check=False)
            if result.returncode != 0:
                lines = (result.stderr or "").strip().splitlines()
                error = lines[-1] if lines else f"exit code {result.returncode}"
        except (OSError, subprocess.SubprocessError) as e:
            error = str(e)
    if error:
        console.print(f"[warning]⚠️  TT_MODEL_MANAGER_PYTHON={python} cannot run tt-model-manager "
                      f"({error}) — community models will be unavailable[/warning]")
        return False
    if show_detail():
        console.print(f"[muted]Using tt-model-manager from {python}[/muted]")
    return True


def setup_tt_model_manager(artifact_dir=None, force=False):
    """Ensure the pinned tt-model-manager venv exists. Returns True when usable.

    Idempotent: an install already at the requested ref is left alone, so a normal
    start costs one file read. Without ``artifact_dir``, an interpreter given in
    TT_MODEL_MANAGER_PYTHON is checked and used as is, never installed into.
    """
    if artifact_dir is None:
        if EXTERNAL_MODEL_MANAGER_PYTHON:
            return _check_external()
        artifact_dir = MODEL_MANAGER_ARTIFACT_DIR
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


@functools.cache
def _external_version(python):
    """The commit tt-model was installed from for ``python`` (its package version
    when not installed from git), or None."""
    script = (
        "import importlib.metadata as m, json; d = m.distribution('tt-model'); "
        "u = json.loads(d.read_text('direct_url.json') or '{}'); "
        "print(u.get('vcs_info', {}).get('commit_id', '')[:8] or d.version)"
    )
    try:
        result = subprocess.run([python, "-c", script],
                                capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def model_manager_status(artifact_dir=None):
    """What the launcher knows about the artifact, for --info and diagnostics.

    The refs are None for a TT_MODEL_MANAGER_PYTHON interpreter: its installer owns the
    pin, so ``version`` says what it has instead.
    """
    python = model_manager_python(artifact_dir)
    external = artifact_dir is None and bool(EXTERNAL_MODEL_MANAGER_PYTHON)
    artifact_dir = artifact_dir or MODEL_MANAGER_ARTIFACT_DIR
    return {
        "available": os.path.exists(python),
        "python": python,
        "ref": None if external else _installed_ref(artifact_dir),
        "requested_ref": None if external else _resolve_ref(),
        "external": external,
        "version": _external_version(python) if external and os.path.exists(python) else None,
    }
