# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Frontend version stamping + quick-setup config snapshot."""

import json
import subprocess
from tt_setup.constants import *
from tt_setup.console import console, is_verbose
from tt_setup.env_config._dotenv import write_env_var


def set_app_version_env():
    """
    Compute the running build's version from git and persist it to .env so
    docker compose can inject it into the frontend as VITE_APP_VERSION /
    VITE_APP_GIT_BRANCH.

    Releases are plain git tags (e.g. v2.6.0) with no package.json bump, so git is
    the source of truth for "what build is this":
      - If HEAD sits exactly on a release tag, that tag is the official version and
        VITE_APP_VERSION is set to it.
      - Otherwise this is an unofficial build; VITE_APP_VERSION is cleared and the
        frontend falls back to showing the branch name (VITE_APP_GIT_BRANCH).
    """
    def _git(git_args):
        try:
            result = subprocess.run(
                ["git", "-C", TT_STUDIO_ROOT] + git_args,
                capture_output=True, text=True, check=False,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return ""

    # An exact tag match on the current commit => official release build.
    version = _git(["describe", "--tags", "--exact-match"])
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"])
    if branch == "HEAD":
        # Detached checkout (e.g. CI / `git checkout <tag>`): use short sha as label.
        branch = _git(["rev-parse", "--short", "HEAD"])

    write_env_var("VITE_APP_VERSION", version)
    write_env_var("VITE_APP_GIT_BRANCH", branch)

    # Low-priority provenance: show a muted one-liner for official releases;
    # the unofficial-branch note is detail, shown only with --verbose.
    if version:
        console.print(f"[muted]Build {version} · official release[/muted]")
    elif branch and is_verbose():
        console.print(f"[muted]Build {branch} · unofficial build[/muted]")


def save_setup_config(config_dict):
    """Save the quick-setup configuration snapshot to JSON file"""
    try:
        with open(SETUP_CONFIG_FILE_PATH, 'w') as f:
            json.dump(config_dict, f, indent=2)
        # Silent — no need to show config file path to user
    except Exception as e:
        console.print(f"[warning]⚠️  Warning: Could not save setup configuration: {e}[/warning]")

