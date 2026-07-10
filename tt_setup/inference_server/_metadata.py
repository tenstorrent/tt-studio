# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Artifact structure validation, version read, and metadata (artifact-info.txt)."""

import os
from tt_setup.constants import *
from tt_setup.console import console
from tt_setup.env_config import get_env_var


def _write_artifact_info(artifacts_dir, artifact_type, artifact_value, validation_passed=True, sudo_used=False, commit_sha=None):
    """
    Write artifact metadata file outside the inference-server directory.

    Args:
        artifacts_dir: Directory containing artifacts
        artifact_type: "branch" or "version"
        artifact_value: Branch name or version number
        validation_passed: Whether artifact validation succeeded
        sudo_used: Whether sudo was needed during download/cleanup
        commit_sha: Git commit SHA at download time (branches only)
    """
    info_file = os.path.join(artifacts_dir, "artifact-info.txt")
    try:
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with open(info_file, 'w') as f:
            # Write user-friendly header with clear current configuration
            f.write("=" * 80 + "\n")
            f.write("  TT INFERENCE SERVER - ARTIFACT INFORMATION\n")
            f.write("=" * 80 + "\n\n")

            # Highlight the current configuration prominently
            f.write(f"  📌 CURRENT CONFIGURATION:\n")
            if artifact_type == "branch":
                f.write(f"     ✓ BRANCH      : {artifact_value} (ACTIVE)\n")
                f.write(f"     ✗ VERSION     : Not configured (using branch instead)\n")
            else:
                f.write(f"     ✗ BRANCH      : Not configured (using version instead)\n")
                f.write(f"     ✓ VERSION     : {artifact_value} (ACTIVE)\n")

            f.write(f"\n     Last updated: {timestamp}\n")
            f.write("\n" + "-" * 80 + "\n\n")

            # Instructions for changing
            f.write("  💡 To switch to a different artifact:\n")
            f.write("     • Run: python run.py --reconfigure-inference-server\n")
            f.write("     • Or manually edit: .env (TT_INFERENCE_ARTIFACT_BRANCH/VERSION)\n")
            f.write("\n" + "-" * 80 + "\n\n")

            # Technical details section
            f.write("  🔍 Technical Details:\n")
            f.write(f"     Artifact Type     : {artifact_type}\n")
            f.write(f"     Artifact Value    : {artifact_value}\n")
            if commit_sha:
                f.write(f"     Commit SHA        : {commit_sha}\n")
            f.write(f"     Download Time     : {timestamp}\n")
            f.write(f"     Validation Status : {'✓ PASSED' if validation_passed else '✗ FAILED'}\n")
            f.write(f"     Validation Checks : workflows_dir, workflows/utils.py, VERSION\n")
            f.write(f"     Sudo Used         : {'Yes' if sudo_used else 'No'}\n")
            # Machine-readable marker lines used by cache invalidation detection
            f.write(f"     artifact_type={artifact_type}\n")
            f.write(f"     artifact_value={artifact_value}\n")
            if commit_sha:
                f.write(f"     commit_sha={commit_sha}\n")
            f.write("\n" + "=" * 80 + "\n")

        console.print(f"[muted]📝 Artifact info written to {info_file}[/muted]")
    except Exception as e:
        console.print(f"[warning]⚠️  Could not write artifact info file: {e}[/warning]")


def get_inference_server_version():
    """Get the version of TT Inference Server from the artifact directory."""
    version_file = os.path.join(INFERENCE_ARTIFACT_DIR, "VERSION")
    if os.path.exists(version_file):
        try:
            with open(version_file, 'r') as f:
                version = f.read().strip()
                return version
        except Exception:
            pass
    
    # Fallback: try to get from environment variable
    # Check for branch first (branches don't have VERSION files typically)
    env_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH") or os.getenv("TT_INFERENCE_ARTIFACT_BRANCH")
    if env_branch:
        return None  # Branches don't have version numbers
    
    env_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION") or os.getenv("TT_INFERENCE_ARTIFACT_VERSION")
    if env_version and env_version != "latest":
        return env_version
    
    return None


def validate_artifact_structure(artifact_dir):
    """
    Validate that the downloaded artifact has the required structure.

    Args:
        artifact_dir (str): Path to the artifact directory to validate

    Returns:
        bool: True if valid, False otherwise
    """
    if not os.path.exists(artifact_dir):
        console.print(f"[error]⛔ Validation failed: Artifact directory does not exist: {artifact_dir}[/error]")
        return False

    # Check for required workflows directory and utils.py
    workflows_dir = os.path.join(artifact_dir, "workflows")
    if not os.path.exists(workflows_dir):
        console.print(f"[error]⛔ Validation failed: Missing 'workflows' directory in {artifact_dir}[/error]")
        return False

    workflows_utils = os.path.join(workflows_dir, "utils.py")
    if not os.path.exists(workflows_utils):
        console.print(f"[error]⛔ Validation failed: Missing 'workflows/utils.py' in {artifact_dir}[/error]")
        console.print(f"[muted]   Directory contents: {os.listdir(artifact_dir)[:10]}...[/muted]")
        return False

    # Basic check that it's not an empty file
    try:
        file_size = os.path.getsize(workflows_utils)
        if file_size == 0:
            console.print("[error]⛔ Validation failed: workflows/utils.py is empty[/error]")
            return False
    except Exception as e:
        console.print(f"[error]⛔ Validation failed: Cannot read workflows/utils.py: {e}[/error]")
        return False

    console.print("[success]✅ Artifact structure validated successfully[/success]")
    return True
