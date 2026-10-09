# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Move to a new default artifact version without losing the installed one."""

import os
import shutil

from tt_setup.console import console
from tt_setup.constants import INFERENCE_ARTIFACT_DIR, TT_STUDIO_ROOT
from tt_setup.env_config import get_env_var
from tt_setup.inference_server._env import _set_artifact_environment_variables
from tt_setup.inference_server._orchestrator import setup_tt_inference_server
from tt_setup.inference_server._privileges import remove_artifact_with_sudo

ARTIFACTS_DIR = os.path.join(TT_STUDIO_ROOT, ".artifacts")
INFO_FILE = os.path.join(ARTIFACTS_DIR, "artifact-info.txt")
# Not named tt-inference-server*: the orchestrator adopts such entries in .artifacts/.
PREVIOUS_DIR = os.path.join(ARTIFACTS_DIR, "previous")
PREVIOUS_ARTIFACT = os.path.join(PREVIOUS_DIR, "tt-inference-server")
PREVIOUS_INFO = os.path.join(PREVIOUS_DIR, "artifact-info.txt")


def _installed_version():
    try:
        with open(os.path.join(INFERENCE_ARTIFACT_DIR, "VERSION")) as f:
            return f.read().strip().lstrip("v") or None
    except OSError:
        return None


def _remove(path):
    if os.path.isdir(path):
        try:
            shutil.rmtree(path)
        except OSError:
            remove_artifact_with_sudo(path, os.path.basename(path))
    elif os.path.exists(path):
        os.remove(path)


def _stash():
    _remove(PREVIOUS_DIR)
    os.makedirs(PREVIOUS_DIR, exist_ok=True)
    os.rename(INFERENCE_ARTIFACT_DIR, PREVIOUS_ARTIFACT)
    if os.path.exists(INFO_FILE):
        os.rename(INFO_FILE, PREVIOUS_INFO)


def _restore():
    _remove(INFERENCE_ARTIFACT_DIR)
    os.rename(PREVIOUS_ARTIFACT, INFERENCE_ARTIFACT_DIR)
    if os.path.exists(PREVIOUS_INFO):
        os.replace(PREVIOUS_INFO, INFO_FILE)
    _remove(PREVIOUS_DIR)


def _discard(version):
    _remove(PREVIOUS_DIR)
    for name in (f"tt-inference-server-v{version}.tar.gz", f"tt-inference-server-{version}.tar.gz"):
        _remove(os.path.join(ARTIFACTS_DIR, name))


def setup_artifact_with_fallback(target_version, pull_branch=False):
    """Set up the artifact, keeping the installed one if `target_version` can't be installed.

    Returns True when `target_version` is in use, False when it fell back to the
    installed version, and None when setup failed.
    """
    if os.path.isdir(PREVIOUS_ARTIFACT) and not os.path.exists(INFERENCE_ARTIFACT_DIR):
        _restore()  # an earlier upgrade was killed mid-download

    if get_env_var("TT_INFERENCE_ARTIFACT_VERSION") in ("latest", "v0.22.0"): os.environ["TT_INFERENCE_ARTIFACT_VERSION"] = ""  # old .env defaults, not pins
    pinned = get_env_var("TT_INFERENCE_ARTIFACT_VERSION") or get_env_var("TT_INFERENCE_ARTIFACT_BRANCH")
    current = _installed_version()
    if pinned or not target_version or not current or current == target_version.lstrip("v"):
        return setup_tt_inference_server(pull_branch, target_version) or None

    try:
        _stash()
    except OSError as e:
        console.print(f"[warning]⚠️  Couldn't back up the installed artifact ({e}); upgrading without a fallback[/warning]")
        return setup_tt_inference_server(pull_branch, target_version) or None
    try:
        installed = setup_tt_inference_server(pull_branch, target_version)
    except BaseException:
        _restore()
        raise
    if installed:
        _discard(current)
        return True

    previous = f"v{current}"
    console.print(
        f"[warning]⚠️  Couldn't install TT Inference Server {target_version}; "
        f"keeping {previous} and its model list[/warning]"
    )
    _restore()
    # Use the restored artifact as is: setting it up again would swap a branch artifact for a release download.
    os.environ["TT_INFERENCE_ARTIFACT_VERSION"] = previous
    _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
    return False
