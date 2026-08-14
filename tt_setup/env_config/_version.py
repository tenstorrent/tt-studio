# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Frontend version stamping + quick-setup config snapshot."""

import subprocess
from tt_setup import config_store
from tt_setup.constants import *
from tt_setup.console import console, is_verbose
from tt_setup.env_config._dotenv import write_env_var
from tt_setup.image_source import compute_image_tag


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

    # Pin the compose image tag to this checkout (release tag, else sha-<12>,
    # else "latest") so a pull fetches exactly the bits CI built for it.
    # TT_STUDIO_IMAGE_REGISTRY is user-owned and never written here.
    full_sha = _git(["rev-parse", "HEAD"])
    write_env_var("TT_STUDIO_IMAGE_TAG", compute_image_tag(version, full_sha))

    # Low-priority provenance: show a muted one-liner for official releases;
    # the unofficial-branch note is detail, shown only with --verbose.
    if version:
        console.print(f"[muted]Build {version} · official release[/muted]")
    elif branch and is_verbose():
        console.print(f"[muted]Build {branch} · unofficial build[/muted]")


def save_setup_config(config_dict):
    """Persist the quick-setup snapshot into the config store.

    The flat snapshot is split across namespaces: ``tt_studio_mode`` /
    ``ai_playground_mode`` land in ``features``, ``vite_*`` keys in ``ui``, and
    everything else in ``setup`` (same split as the one-time migration).
    """
    feature_keys = ("tt_studio_mode", "ai_playground_mode")
    setup, features, ui = {}, {}, {}
    for key, value in config_dict.items():
        if key in feature_keys:
            features[key] = value
        elif key.startswith("vite_"):
            ui[key] = value
        else:
            setup[key] = value
    try:
        if setup:
            config_store.update_ns("setup", setup)
        if features:
            config_store.update_ns("features", features)
        if ui:
            config_store.update_ns("ui", ui)
        # Silent — no need to show config file path to user
    except Exception as e:
        console.print(f"[warning]⚠️  Warning: Could not save setup configuration: {e}[/warning]")

