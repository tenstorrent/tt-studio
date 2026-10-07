# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How TT-Studio was installed, and where its runtime root lives.

Two modes:

- **Source checkout** (`python run.py` from a clone): the root is the working
  directory, exactly as it has always been.
- **pip install** (`pip install tt-studio`): the wheel carries the app tree under
  tt_setup/_bundle/ (added by hatch_build.py). Docker Compose bind-mounts parts
  of that tree and the launcher writes .env, logs/, .artifacts/ and the
  persistent volume beside it, so it can't run out of site-packages. `main()`
  stages the bundle into a writable root (~/.tt-studio, or $TT_STUDIO_HOME)
  once per installed version, then hands off to the normal launcher there.

Stdlib-only, and must not import tt_setup.constants: constants derives every
path from resolve_root() and creates logs/ at import time, which has to happen
after staging.
"""

import json
import os
import re
import shutil
import subprocess
import sys

PACKAGE_NAME = "tt-studio"
BUNDLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_bundle")
# Written into the root after staging: the installed version plus the bundle's
# file list, so an upgrade can drop files the new version no longer ships.
MARKER_NAME = ".tt-studio-install.json"
_SENTINEL = os.path.join("app", "docker-compose.yml")


class InstallError(Exception):
    """The runtime root can't be prepared; the message says what to do."""


def is_pip_install():
    """True when this tt_setup carries its own app tree (a wheel install)."""
    return os.path.isdir(BUNDLE_DIR)


def data_root():
    """Writable runtime root for a pip install: $TT_STUDIO_HOME or ~/.tt-studio."""
    home = os.environ.get("TT_STUDIO_HOME", "").strip()
    return os.path.abspath(os.path.expanduser(home or "~/.tt-studio"))


def resolve_root():
    """TT_STUDIO_ROOT for this process (see tt_setup/constants.py)."""
    return data_root() if is_pip_install() else os.getcwd()


def launch_cmd():
    """How the user starts the launcher, for hints like '<cmd> --stop'."""
    return "tt-studio" if is_pip_install() else "python run.py"


def package_version():
    """Installed distribution version ('' when not installed, e.g. a bare clone)."""
    from importlib.metadata import PackageNotFoundError, version

    try:
        return version(PACKAGE_NAME)
    except PackageNotFoundError:
        return ""


def release_tag(version):
    """The git tag a published release was built from: 'vX.Y.Z', or
    'vX.Y.Z-rcN' for a pre-release (PEP 440 spells it X.Y.ZrcN). Images are
    pushed under that exact tag. Dev and local builds (X.Y.Z.devN+g<sha>)
    never correspond to a release tag, so they get ''."""
    match = re.fullmatch(r"(\d+\.\d+\.\d+)((?:a|b|rc)\d+)?", version or "")
    if not match:
        return ""
    base, pre = match.groups()
    return f"v{base}-{pre}" if pre else f"v{base}"


def image_tag(version):
    """Container image tag for a pip install. A release maps to the vX.Y.Z tag
    publish-images.yml pushes; any other build gets a tag that is never
    published, so the launcher builds locally rather than pulling another
    version's images."""
    return release_tag(version) or "v" + version.replace("+", "-")


def studio_version():
    """Human-readable version for --version: the package version in a pip
    install, `git describe` in a checkout."""
    if is_pip_install():
        return package_version() or "unknown"
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except OSError:
        pass
    return package_version() or "unknown"


def _bundle_files(bundle_dir):
    """Relative paths of every bundled file. pip byte-compiles the .py files in
    the bundle like any other package data; those caches aren't app files."""
    files = []
    for dirpath, dirnames, filenames in os.walk(bundle_dir):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            files.append(os.path.relpath(os.path.join(dirpath, name), bundle_dir))
    return sorted(files)


def read_marker(root):
    """The install marker in `root` as a dict, or None when absent/unreadable."""
    try:
        with open(os.path.join(root, MARKER_NAME)) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_marker(root, data):
    path = os.path.join(root, MARKER_NAME)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def check_root_is_ours(root):
    """Raise InstallError unless `root` is missing, empty, or already a
    tt-studio install — never stage over files tt-studio didn't put there."""
    if not os.path.exists(root):
        return
    if not os.path.isdir(root):
        raise InstallError(
            f"{root} exists and is not a folder. Set TT_STUDIO_HOME to another location."
        )
    if read_marker(root) is not None:
        return
    if os.path.exists(os.path.join(root, ".git")):
        raise InstallError(
            f"{root} is a git checkout, not a tt-studio install folder. Run `python run.py` "
            "there instead, or set TT_STUDIO_HOME to an empty folder."
        )
    if os.listdir(root):
        raise InstallError(
            f"{root} already has files that tt-studio didn't create. Set TT_STUDIO_HOME to an "
            "empty folder (or remove that folder) and run tt-studio again."
        )


def _remove_stale(root, rel):
    """Delete one file a previous version shipped, then any parent folders it
    leaves empty. Paths outside `root` are ignored."""
    root = os.path.realpath(root)
    path = os.path.realpath(os.path.join(root, rel))
    if not path.startswith(root + os.sep) or not os.path.isfile(path):
        return
    try:
        os.remove(path)
        parent = os.path.dirname(path)
        while parent != root and not os.listdir(parent):
            os.rmdir(parent)
            parent = os.path.dirname(parent)
    except OSError:
        pass


def stage_bundle(root, bundle_dir=None, version=None):
    """Make `root` hold this version's app files. Files the launcher or the
    containers created (.env, logs/, .artifacts/, volumes, venvs, db.sqlite3)
    are left alone; bundled files are overwritten with this version's copy.

    Returns (previous_version, changed). previous_version is None on a fresh
    install; changed is False when `root` was already on this version.
    """
    bundle_dir = BUNDLE_DIR if bundle_dir is None else bundle_dir
    version = package_version() if version is None else version
    check_root_is_ours(root)
    marker = read_marker(root) or {}
    previous = marker.get("version")
    if previous == version and os.path.isfile(os.path.join(root, _SENTINEL)):
        return previous, False

    files = _bundle_files(bundle_dir)
    if _SENTINEL not in files:
        raise InstallError(
            "this tt-studio package is missing its app files. Reinstall it: "
            "pipx install --force tt-studio (or pip install --force-reinstall tt-studio)"
        )
    try:
        os.makedirs(root, exist_ok=True)
        if not marker:
            # Claim the folder before copying, so an interrupted first install is
            # resumed next time instead of being refused as someone else's files.
            _write_marker(root, {"version": None, "files": []})
        for rel in files:
            dst = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(bundle_dir, rel), dst)
    except PermissionError as e:
        raise InstallError(
            f"couldn't write {e.filename}: permission denied. If a container created it, "
            f"run: sudo chown -R $USER {root}"
        ) from e
    for rel in sorted(set(marker.get("files") or []) - set(files)):
        _remove_stale(root, rel)
    _write_marker(root, {"version": version, "files": files})
    return previous, True


def _tilde(path):
    home = os.path.expanduser("~")
    return (
        "~" + path[len(home) :]
        if path == home or path.startswith(home + os.sep)
        else path
    )


def main():
    """Console-script entry point (`tt-studio`)."""
    if is_pip_install():
        root = data_root()
        try:
            previous, changed = stage_bundle(root)
        except (InstallError, OSError) as e:
            sys.stderr.write(f"tt-studio: {e}\n")
            sys.exit(1)
        if changed:
            version = package_version()
            if previous:
                print(f"tt-studio: updated {previous} → {version} in {_tilde(root)}")
            else:
                print(f"tt-studio: installed {version} into {_tilde(root)}")
        # Same layout as a checkout run from its root, so cwd-relative code agrees.
        os.chdir(root)

    from tt_setup.cli import main as cli_main

    cli_main()
