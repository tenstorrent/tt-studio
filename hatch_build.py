# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Hatch build hook: ship the TT-Studio app tree inside the `tt-studio` wheel.

The launcher (tt_setup) drives Docker Compose against the whole app tree —
compose files, the build contexts and bind-mounted backend source under app/,
the host-side inference-api/ and docker-control-service/, .env.default, and
ci/deploy_healthcheck.py. The wheel carries those files under
tt_setup/_bundle/, and on first run tt_setup/install_mode.py stages them into
a writable root (~/.tt-studio) for Docker to mount.

The file list comes from `git ls-files`, not hatch's .gitignore filtering: the
root .gitignore ignores *.json and *.txt, which would silently drop tracked
files such as package.json, requirements.txt and the model catalog. Without
git (building a wheel from the sdist), the paths are walked instead — the sdist
already contains exactly the tracked files, put there by this same hook.
"""

import os
import subprocess

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

# Repo paths staged into the runtime root. Keep in sync with what tt_setup reads
# under TT_STUDIO_ROOT (see tt_setup/constants.py).
BUNDLE_PATHS = (
    "app",
    "inference-api",
    "docker-control-service",
    "ci/deploy_healthcheck.py",
    ".env.default",
)
# Where the tree lands inside the wheel; tt_setup/install_mode.py reads it back.
WHEEL_BUNDLE_PREFIX = "tt_setup/_bundle"
# Required for the bundle to be usable at all — a build missing it is a bug.
_SENTINEL = "app/docker-compose.yml"
# Only consulted by the no-git walk; never part of a clean tree.
_SKIP_DIRS = {"node_modules", "__pycache__", ".venv", ".pytest_cache"}


def _tracked_files(root):
    """Git-tracked files under BUNDLE_PATHS that exist on disk, or None when the
    root isn't this repo's checkout."""
    try:
        result = subprocess.run(
            ["git", "-C", root, "ls-files", "-z", "--", *BUNDLE_PATHS],
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    files = [p for p in result.stdout.decode().split("\0") if p]
    if _SENTINEL not in files:
        return None
    return [p for p in files if os.path.isfile(os.path.join(root, p))]


def _walked_files(root):
    """Every file under BUNDLE_PATHS, for builds without git metadata."""
    files = []
    for rel in BUNDLE_PATHS:
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            files.append(rel)
            continue
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames[:] = sorted(d for d in dirnames if d not in _SKIP_DIRS)
            for name in sorted(filenames):
                if name.endswith(".pyc"):
                    continue
                files.append(os.path.relpath(os.path.join(dirpath, name), root))
    return files


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        files = _tracked_files(self.root) or _walked_files(self.root)
        if _SENTINEL not in files:
            raise RuntimeError(
                f"tt-studio build: {_SENTINEL} not found under {self.root}; "
                "build from a tt-studio checkout or its sdist"
            )
        prefix = WHEEL_BUNDLE_PREFIX + "/" if self.target_name == "wheel" else ""
        for rel in files:
            dest = prefix + rel.replace(os.sep, "/")
            build_data["force_include"][os.path.join(self.root, rel)] = dest
