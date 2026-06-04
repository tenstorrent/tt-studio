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
except ModuleNotFoundError:
    tomllib = None

from tt_setup.venv_utils import recreate_venv_if_stale

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_VENV_DIR = os.path.join(_REPO_ROOT, ".tt_studio_run_venv")
_PYPROJECT = os.path.join(_REPO_ROOT, "pyproject.toml")
_MARKER = os.path.join(_VENV_DIR, ".deps_marker")
_FLAG = "TT_STUDIO_BOOTSTRAPPED"


def _supports_color():
    """True iff stderr looks like a color-capable TTY (honors NO_COLOR)."""
    return (
        sys.stderr.isatty()
        and not os.environ.get("NO_COLOR")
        and os.environ.get("TERM", "") != "dumb"
    )


_USE_COLOR = _supports_color()
_C_RED = "\x1b[1;31m" if _USE_COLOR else ""
_C_YELLOW = "\x1b[33m" if _USE_COLOR else ""
_C_CYAN = "\x1b[36m" if _USE_COLOR else ""
_C_BOLD = "\x1b[1m" if _USE_COLOR else ""
_C_DIM = "\x1b[2m" if _USE_COLOR else ""
_C_RESET = "\x1b[0m" if _USE_COLOR else ""


def _die(*lines):
    """Print error lines to stderr and exit non-zero."""
    for line in lines:
        sys.stderr.write(line + "\n")
    sys.exit(1)


def _venv_python(venv_dir):
    sub = "Scripts" if os.name == "nt" else "bin"
    exe = "python.exe" if os.name == "nt" else "python"
    return os.path.join(venv_dir, sub, exe)


def _read_deps(pyproject_path):
    """Return [project.dependencies] from pyproject.toml. Raises on any issue."""
    if tomllib is None:
        v = ".".join(map(str, sys.version_info[:3]))
        raise RuntimeError(
            f"tt-studio setup requires Python 3.11+ (you have {v}); "
            f"tomllib is unavailable."
        )
    with open(pyproject_path, "rb") as f:
        data = tomllib.load(f)
    return list(data.get("project", {}).get("dependencies", []))


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

    if sys.version_info < (3, 11):
        v = ".".join(map(str, sys.version_info[:3]))
        cmd = f"python3.11 run.py {' '.join(sys.argv[1:])}".rstrip()
        _die(
            "",
            f"  {_C_RED}⚠️  Python 3.11+ required by tt-studio setup{_C_RESET}",
            "",
            f"      {_C_DIM}You have:{_C_RESET}  {v}",
            f"      {_C_DIM}Need:{_C_RESET}      3.11 or newer",
            "",
            f"      {_C_BOLD}Fix{_C_RESET} — install Python 3.11+ and rerun, e.g.",
            f"          {_C_CYAN}{cmd}{_C_RESET}",
            "",
        )

    try:
        deps = _read_deps(_PYPROJECT)
    except Exception as e:
        _die(
            "",
            f"  {_C_RED}⚠️  Could not read [project.dependencies] from pyproject.toml{_C_RESET}",
            "",
            f"      {_C_DIM}File:{_C_RESET}    {_PYPROJECT}",
            f"      {_C_DIM}Error:{_C_RESET}   {e}",
            "",
            "      tt-studio setup cannot continue.",
            "",
        )
    if not deps:
        _die(
            "",
            f"  {_C_RED}⚠️  pyproject.toml declares no [project.dependencies]{_C_RESET}",
            "",
            f"      {_C_DIM}File:{_C_RESET}  {_PYPROJECT}",
            "",
            "      Refusing to bootstrap an empty venv.",
            "",
        )

    try:
        _ensure_venv_with_deps(_VENV_DIR, deps)
    except (subprocess.CalledProcessError, OSError) as e:
        _die(
            "",
            f"  {_C_RED}⚠️  Could not prepare the tooling venv{_C_RESET}",
            "",
            f"      {_C_DIM}Error:{_C_RESET}  {e}",
            "",
            f"      {_C_BOLD}Fix{_C_RESET} — install manually:",
            f"          {_C_CYAN}python3 -m pip install {' '.join(deps)}{_C_RESET}",
            "",
        )

    py = _venv_python(_VENV_DIR)
    env = dict(os.environ)
    env[_FLAG] = "1"
    script = os.path.join(_REPO_ROOT, "run.py")
    os.execve(py, [py, script, *sys.argv[1:]], env)
