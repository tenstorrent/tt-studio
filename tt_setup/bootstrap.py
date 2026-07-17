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
import itertools
import subprocess
import threading
import time

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
_C_GREEN = "\x1b[32m" if _USE_COLOR else ""
_C_YELLOW = "\x1b[33m" if _USE_COLOR else ""
_C_CYAN = "\x1b[36m" if _USE_COLOR else ""
_C_PURPLE = "\x1b[38;5;99m" if _USE_COLOR else ""
_C_BOLD = "\x1b[1m" if _USE_COLOR else ""
_C_DIM = "\x1b[2m" if _USE_COLOR else ""
_C_RESET = "\x1b[0m" if _USE_COLOR else ""

# Braille "dots" frames, matching the launcher's phase spinner
# (tt_setup/console/_stepper.py). Kept here as a literal so bootstrap stays
# stdlib-only — it runs before Rich (and tt_setup.console) is importable.
_SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


class _Spinner:
    """A tiny stdlib stand-in for `console.step()` for the pre-Rich bootstrap.

    Shows one calm line (`⠙ label…` in accent purple) while a block runs, then
    collapses it to `✓ label` (green) / `✗ label` (red). Animates only on a
    color-capable TTY; on a non-TTY / NO_COLOR it prints a single plain
    `⚙️  label…` start line and a plain `✓/✗ label`, so piped logs stay free of
    escape codes.
    """

    def __init__(self, label):
        self.label = label
        self._stop = threading.Event()
        self._thread = None
        # _supports_color() gates on stderr; the spinner writes to stdout, so
        # require stdout to be a TTY too before animating in place.
        self._animate = _USE_COLOR and sys.stdout.isatty()

    def __enter__(self):
        if self._animate:
            self._thread = threading.Thread(target=self._spin, daemon=True)
            self._thread.start()
        else:
            print(f"⚙️  {self.label}…")
        return self

    def _spin(self):
        for frame in itertools.cycle(_SPINNER_FRAMES):
            if self._stop.is_set():
                break
            sys.stdout.write(f"\r{_C_PURPLE}{frame}{_C_RESET} {_C_DIM}{self.label}…{_C_RESET}")
            sys.stdout.flush()
            time.sleep(0.1)

    def _halt(self):
        """Stop the animation thread and wipe the spinner line (TTY only)."""
        if self._animate and not self._stop.is_set():
            self._stop.set()
            if self._thread:
                self._thread.join()
            sys.stdout.write("\r\033[2K")  # carriage return + erase line
            sys.stdout.flush()

    def done(self, ok=True):
        """Collapse the line to a ✓/✗ result. Call on success or handled failure."""
        self._halt()
        if self._animate:
            glyph = f"{_C_GREEN}✓{_C_RESET}" if ok else f"{_C_RED}✗{_C_RESET}"
        else:
            glyph = "✓" if ok else "✗"
        print(f"{glyph} {self.label}")

    def __exit__(self, exc_type, exc, tb):
        # If the block raised before done() ran, just wipe the spinner line so a
        # following _die() panel isn't corrupted; the caller surfaces the error.
        self._halt()
        return False


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
            f"tt-studio setup requires Python 3.12+ (you have {v}); "
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


def _run_quiet(cmd):
    """Run a subprocess, capturing combined stdout+stderr instead of letting it
    flood the terminal. On failure the captured text rides along on
    CalledProcessError.output so the caller can surface it."""
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def _install(venv_dir, deps):
    py = _venv_python(venv_dir)
    _run_quiet([py, "-m", "pip", "install", "--upgrade", "pip"])
    _run_quiet([py, "-m", "pip", "install", *deps])


def _ensure_venv_with_deps(venv_dir, deps):
    """Create the venv if missing/stale and install deps when the dep set changes."""
    want = _deps_hash(deps)
    needs_create = recreate_venv_if_stale(venv_dir, _C_YELLOW, _C_RESET) or not os.path.exists(venv_dir)
    if needs_create:
        with _Spinner("Preparing tt-studio tooling (one-time)") as sp:
            _run_quiet([sys.executable, "-m", "venv", venv_dir])
            _install(venv_dir, deps)
            sp.done()
        _write_marker(want)
        return
    if _read_marker() != want:
        with _Spinner("Updating tooling dependencies") as sp:
            _install(venv_dir, deps)
            sp.done()
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

    if sys.version_info < (3, 12):
        v = ".".join(map(str, sys.version_info[:3]))
        cmd = f"python3.12 run.py {' '.join(sys.argv[1:])}".rstrip()
        _die(
            "",
            f"  {_C_RED}⚠️  Python 3.12+ required by tt-studio setup{_C_RESET}",
            "",
            f"      {_C_DIM}You have:{_C_RESET}  {v}",
            f"      {_C_DIM}Need:{_C_RESET}      3.12 or newer",
            "",
            f"      {_C_BOLD}Fix{_C_RESET} — install Python 3.12+ and rerun, e.g.",
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
        # pip/venv output was captured (not streamed); surface the tail here so a
        # failure is still debuggable now that the firehose is silenced.
        output = getattr(e, "output", None)
        detail = []
        if output and output.strip():
            tail = output.strip().splitlines()[-20:]
            detail = ["", f"      {_C_DIM}Last output:{_C_RESET}", *(f"        {ln}" for ln in tail)]
        _die(
            "",
            f"  {_C_RED}⚠️  Could not prepare the tooling venv{_C_RESET}",
            "",
            f"      {_C_DIM}Error:{_C_RESET}  {e}",
            *detail,
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
