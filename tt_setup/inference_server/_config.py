# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Interactive selection of the artifact source (release version vs. branch)."""

import os
import shutil
import re
from tt_setup.constants import *
from tt_setup.console import ask, confirm, console
from tt_setup.env_config import get_env_var, write_env_var
from tt_setup.inference_server._privileges import remove_artifact_with_sudo


def configure_inference_server_artifact(dev_mode=False, quick_setup=False, force_reconfigure=False, reconfigure_inference=False):
    """
    Configure TT Inference Server artifact source (release version or branch).

    Args:
        dev_mode: Development mode flag
        quick_setup: Quick setup flag (minimal prompts, defaults)
        force_reconfigure: Force reconfiguration of all options
        reconfigure_inference: Force reconfiguration of inference server artifact only
    """
    current_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION")
    current_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH")

    # In quick setup with no reconfigure request: silently default to 'latest' if not already set
    if quick_setup and not (force_reconfigure or reconfigure_inference):
        if not (current_version or current_branch):
            write_env_var("TT_INFERENCE_ARTIFACT_VERSION", "latest", quote_value=False)
        return

    # If configuration exists and user didn't request reconfiguration, use it silently
    if (current_version or current_branch) and not (force_reconfigure or reconfigure_inference):
        source_type = "release" if current_version else "branch"
        value = current_version or current_branch
        console.print(f"\n[info]Using existing TT Inference Server configuration: {source_type} '{value}'[/info]")
        console.print("[warning]   (Use --reconfigure-inference-server to change)[/warning]")
        return

    # If reconfiguring, show current config and ask if they want to change
    if (current_version or current_branch) and (force_reconfigure or reconfigure_inference):
        source_type = "release" if current_version else "branch"
        value = current_version or current_branch
        console.print(f"\n[info]Current TT Inference Server configuration: {source_type} '{value}'[/info]")

        # Ask if user wants to change
        if not confirm("Would you like to change this?", default=False):
            console.print(f"[success]✅ Keeping existing configuration: {source_type} '{value}'[/success]")
            return

    # Ask user for artifact source type
    console.print("\n[info]Choose TT Inference Server artifact source:[/info]")
    console.print("  1. Release version (stable, recommended for production)")
    console.print("  2. Branch (latest development code, may have new features)")
    choice = ask("Enter choice", choices=["1", "2"], default="1")

    if choice == "1":
        # Release version
        if current_branch:
            # Clear branch if switching to release
            write_env_var("TT_INFERENCE_ARTIFACT_BRANCH", "", quote_value=False)

        # Always prompt for version when user chooses option 1
        default_version = "latest"
        if current_version and current_version != "latest":
            default_version = current_version

        prompt_text = "📦 Enter release version (e.g., 'v0.8.0') or 'latest'"
        semver_pattern = r"^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"
        while True:
            val = ask(prompt_text, default=default_version).strip()
            if val == "latest" or re.match(semver_pattern, val):
                break

            # Common typo: "v.10.0" or "v.0.10.0" should be "v0.10.0"
            suggested = ""
            if re.match(r"^v\.", val):
                suggested = "v0" + val[1:]

            console.print(f"[error]⛔ Invalid release version '{val}'.[/error]")
            console.print("[muted]   Expected format: vMAJOR.MINOR.PATCH (example: v0.10.0) or 'latest'[/muted]")
            if suggested:
                console.print(f"[muted]   Did you mean: {suggested}[/muted]")
        write_env_var("TT_INFERENCE_ARTIFACT_VERSION", val, quote_value=False)
        console.print(f"[success]✅ TT_INFERENCE_ARTIFACT_VERSION set to '{val}'[/success]")

        # If version changed (or switching from branch to version), force re-download
        if current_branch or (current_version != val):
            artifacts_dir = os.path.join(TT_STUDIO_ROOT, ".artifacts")
            if os.path.exists(artifacts_dir):
                # Not wrapped in step(): the sudo fallback may prompt, and a
                # capturing step() would hide that prompt and hang.
                console.print("[info]🗑️  Removing existing artifacts…[/info]")
                try:
                    shutil.rmtree(artifacts_dir)
                    console.print("[muted]✅ Removed .artifacts directory[/muted]")
                except Exception as e:
                    console.print(f"[warning]⚠️  Could not remove .artifacts directory: {e}[/warning]")
                    console.print("[muted]   Attempting to remove with sudo…[/muted]")
                    if not remove_artifact_with_sudo(artifacts_dir, ".artifacts directory"):
                        console.print("[warning]⚠️  Could not remove with sudo either. Will attempt to continue anyway...[/warning]")
                console.print("[muted]📝 Configuration changed - will re-download artifact[/muted]")
    else:
        # Branch
        if current_version:
            # Clear version if switching to branch
            write_env_var("TT_INFERENCE_ARTIFACT_VERSION", "", quote_value=False)

        # Always prompt for branch when user chooses option 2
        default_branch = "main"
        if current_branch:
            default_branch = current_branch

        prompt_text = "🌿 Enter branch name (e.g., 'main', 'dev', 'feature/xyz')"
        val = ask(prompt_text, default=default_branch).strip()
        write_env_var("TT_INFERENCE_ARTIFACT_BRANCH", val, quote_value=False)
        console.print(f"[success]✅ TT_INFERENCE_ARTIFACT_BRANCH set to '{val}'[/success]")

        # If branch changed (or switching from version to branch), force re-download
        if current_version or (current_branch != val):
            artifacts_dir = os.path.join(TT_STUDIO_ROOT, ".artifacts")
            if os.path.exists(artifacts_dir):
                # Not wrapped in step(): the sudo fallback may prompt, and a
                # capturing step() would hide that prompt and hang.
                console.print("[info]🗑️  Removing existing artifacts…[/info]")
                try:
                    shutil.rmtree(artifacts_dir)
                    console.print("[muted]✅ Removed .artifacts directory[/muted]")
                except Exception as e:
                    console.print(f"[warning]⚠️  Could not remove .artifacts directory: {e}[/warning]")
                    console.print("[muted]   Attempting to remove with sudo…[/muted]")
                    if not remove_artifact_with_sudo(artifacts_dir, ".artifacts directory"):
                        console.print("[warning]⚠️  Could not remove with sudo either. Will attempt to continue anyway...[/warning]")
                console.print("[muted]📝 Configuration changed - will re-download artifact[/muted]")
