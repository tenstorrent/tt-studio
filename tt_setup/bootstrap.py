# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""First-run dependency bootstrap.

`run.py` is launched as bare `python3 run.py` under the user's system Python, which
is not guaranteed to have the third-party deps (rich, typer, pydantic, requests).
This module ensures those deps exist in a managed venv (`.tt_studio_run_venv/`) and
re-execs the script into that venv, so `python3 run.py` "just works" on a fresh clone.

Stdlib-only — it runs *before* the deps are available.
"""

import os
import sys
import hashlib
import subprocess

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover - we require >=3.11
    tomllib = None

from tt_setup.venv_utils import recreate_venv_if_stale

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_VENV_DIR = os.path.join(_REPO_ROOT, ".tt_studio_run_venv")
_PYPROJECT = os.path.join(_REPO_ROOT, "pyproject.toml")
_MARKER = os.path.join(_VENV_DIR, ".deps_marker")
_FLAG = "TT_STUDIO_BOOTSTRAPPED"


def _venv_python(venv_dir):
    sub = "Scripts" if os.name == "nt" else "bin"
    exe = "python.exe" if os.name == "nt" else "python"
    return os.path.join(venv_dir, sub, exe)


def _read_deps(pyproject_path):
    """Return [project.dependencies] from pyproject.toml (empty list on any issue)."""
    if tomllib is None:
        return []
    try:
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
        return list(data.get("project", {}).get("dependencies", []))
    except (OSError, tomllib.TOMLDecodeError):
        return []


def _deps_hash(deps):
    return hashlib.sha256("\n".join(sorted(deps)).encode()).hexdigest()


def _in_target_venv(venv_dir):
    try:
        return os.path.samefile(sys.prefix, venv_dir)
    except OSError:
        return os.path.abspath(sys.prefix) == os.path.abspath(venv_dir)


def _read_marker():
    try:
        with open(_MARKER) as f:
            return f.read().strip()
    except OSError:
        return None


def _write_marker(value):
    try:
        with open(_MARKER, "w") as f:
            f.write(value)
    except OSError:
        pass


def _install(venv_dir, deps):
    py = _venv_python(venv_dir)
    subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run([py, "-m", "pip", "install", *deps], check=True)


def _ensure_venv_with_deps(venv_dir, deps):
    """Create the venv if missing/stale and install deps when the dep set changes."""
    want = _deps_hash(deps)
    needs_create = recreate_venv_if_stale(venv_dir) or not os.path.exists(venv_dir)
    if needs_create:
        print("⚙️  First run: preparing tt-studio tooling (one-time, ~a few seconds)...")
        subprocess.run([sys.executable, "-m", "venv", venv_dir], check=True)
        _install(venv_dir, deps)
        _write_marker(want)
        return
    if _read_marker() != want:
        print("⚙️  Updating tt-studio tooling dependencies...")
        _install(venv_dir, deps)
        _write_marker(want)


def ensure_environment():
    """Ensure run.py's deps are available, re-exec into the managed venv if needed.

    No-op when already inside the venv, when bootstrap is disabled via the
    TT_STUDIO_BOOTSTRAPPED flag, or when there is nothing to bootstrap.
    """
    if os.environ.get(_FLAG) == "1":
        return
    if _in_target_venv(_VENV_DIR):
        return
    deps = _read_deps(_PYPROJECT)
    if not deps:
        # Can't determine deps (missing pyproject / old Python); run as-is.
        return

    try:
        _ensure_venv_with_deps(_VENV_DIR, deps)
    except (subprocess.CalledProcessError, OSError) as e:
        print(f"⚠️  Could not prepare the tooling venv ({e}).")
        print(f"   Install manually:  python3 -m pip install {' '.join(deps)}")
        return  # fall through and try under the current interpreter

    py = _venv_python(_VENV_DIR)
    env = dict(os.environ)
    env[_FLAG] = "1"
    script = os.path.join(_REPO_ROOT, "run.py")
    os.execve(py, [py, script, *sys.argv[1:]], env)
