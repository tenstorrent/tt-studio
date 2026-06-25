# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""TT Inference Server artifact download, validation, and configuration."""

import os
import sys
import subprocess
import shutil
import re
import json
from datetime import datetime
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False
from tt_setup.constants import *
from tt_setup.console import console, is_verbose, step
from tt_setup.env_config import comment_out_env_var, get_env_var, write_env_var


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
        while True:
            change_choice = input(f"{C_CYAN}Would you like to change this? (y/n) [default: n]: {C_RESET}").strip().lower() or "n"
            if change_choice in ["y", "yes", "n", "no"]:
                break
            console.print("[error]⛔ Invalid input. Please enter 'y' or 'n'.[/error]")

        if change_choice in ["n", "no"]:
            console.print(f"[success]✅ Keeping existing configuration: {source_type} '{value}'[/success]")
            return
    
    # Ask user for artifact source type
    console.print("\n[info]Choose TT Inference Server artifact source:[/info]")
    console.print("  1. Release version (stable, recommended for production)")
    console.print("  2. Branch (latest development code, may have new features)")

    if quick_setup:
        # In quick setup, default to latest release but still allow choice
        while True:
            choice = input(f"{C_CYAN}Enter choice (1 or 2) [default: 1]: {C_RESET}").strip() or "1"
            if choice in ["1", "2"]:
                break
            console.print("[error]⛔ Invalid choice. Please enter 1 or 2.[/error]")
    else:
        while True:
            choice = input(f"{C_CYAN}Enter choice (1 or 2) [default: 1]: {C_RESET}").strip() or "1"
            if choice in ["1", "2"]:
                break
            console.print("[error]⛔ Invalid choice. Please enter 1 or 2.[/error]")
    
    if choice == "1":
        # Release version
        if current_branch:
            # Clear branch if switching to release
            write_env_var("TT_INFERENCE_ARTIFACT_BRANCH", "", quote_value=False)

        # Always prompt for version when user chooses option 1
        default_version = "latest"
        if current_version and current_version != "latest":
            default_version = current_version

        prompt_text = f"📦 Enter release version (e.g., 'v0.8.0') or 'latest' [default: {default_version}]: "
        semver_pattern = r"^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"
        while True:
            val = input(prompt_text).strip() or default_version
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

        prompt_text = f"🌿 Enter branch name (e.g., 'main', 'dev', 'feature/xyz') [default: {default_branch}]: "
        val = input(prompt_text).strip() or default_branch
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


def _set_artifact_environment_variables(artifact_dir):
    """Set environment variables for artifact directory."""
    os.environ["TT_INFERENCE_ARTIFACT_PATH"] = artifact_dir
    # Set OVERRIDE_BENCHMARK_TARGETS to point to the file in the artifact directory
    benchmark_file = os.path.join(artifact_dir, "benchmarking", "benchmark_targets", "model_performance_reference.json")
    if os.path.exists(benchmark_file):
        os.environ["OVERRIDE_BENCHMARK_TARGETS"] = benchmark_file


def fetch_branch_commit_sha(branch):
    """Fetch the latest commit SHA for a branch from the GitHub API (unauthenticated)."""
    import json
    url = f"https://api.github.com/repos/tenstorrent/tt-inference-server/git/refs/heads/{branch}"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
            if isinstance(data, list):
                return data[0]["object"]["sha"] if data else None
            return data["object"]["sha"]
    except Exception:
        return None


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
            f.write("     • Or manually edit: app/.env (TT_INFERENCE_ARTIFACT_BRANCH/VERSION)\n")
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


def _sync_model_catalog():
    """
    Sync model catalog from the TT Inference Server artifact.
    Runs sync_models_from_inference_server.py to generate models_from_inference_server.json.
    """
    sync_script = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config",
        "sync_models_from_inference_server.py",
    )

    if not os.path.exists(sync_script):
        console.print(f"[warning]⚠️  Model catalog sync script not found: {sync_script}[/warning]")
        return False

    try:
        env = os.environ.copy()
        if os.path.exists(INFERENCE_ARTIFACT_DIR):
            env["TT_INFERENCE_ARTIFACT_PATH"] = INFERENCE_ARTIFACT_DIR

        result = subprocess.run(
            [sys.executable, sync_script],
            capture_output=True, text=True, check=False, env=env,
        )

        if result.returncode == 0:
            console.print("[success]✅ Model catalog synced successfully[/success]")
            if is_verbose() and result.stdout.strip():
                for line in result.stdout.strip().splitlines():
                    console.print(f"[muted]   {line}[/muted]")
            return True
        else:
            console.print(f"[warning]⚠️  Model catalog sync returned exit code {result.returncode}[/warning]")
            if is_verbose() and result.stderr.strip():
                for line in result.stderr.strip().splitlines()[-5:]:
                    console.print(f"[muted]   {line}[/muted]")
            return False
    except Exception as e:
        console.print(f"[warning]⚠️  Model catalog sync failed: {e}[/warning]")
        return False


def setup_tt_inference_server(pull_branch=False):
    """Set up TT Inference Server by downloading/extracting artifact from GitHub release or branch."""
    # Artifact setup — quiet unless downloading or encountering issues

    def suggest_semver(version):
        """Return a likely semantic-version correction for malformed tags."""
        if re.match(r'^v\.', version):
            return "v0" + version[1:]
        return ""

    # Read artifact source from .env file — use EITHER branch OR version, never both
    artifact_branch = get_env_var("TT_INFERENCE_ARTIFACT_BRANCH") or None
    artifact_version = get_env_var("TT_INFERENCE_ARTIFACT_VERSION") or None

    if artifact_branch and artifact_version:
        # Both are set — ask the user which to keep and comment out the other
        console.print("\n[warning]⚠️  Both TT_INFERENCE_ARTIFACT_BRANCH and TT_INFERENCE_ARTIFACT_VERSION are set in .env:[/warning]")
        console.print(f"   1. Branch: '{artifact_branch}'")
        console.print(f"   2. Version: '{artifact_version}'")
        while True:
            choice = input(f"{C_CYAN}Which would you like to use? (1 or 2): {C_RESET}").strip()
            if choice in ("1", "2"):
                break
            console.print("[error]⛔ Enter 1 or 2.[/error]")
        if choice == "1":
            comment_out_env_var("TT_INFERENCE_ARTIFACT_VERSION")
            artifact_version = None
            console.print(f"[success]✅ Using branch '{artifact_branch}' — commented out TT_INFERENCE_ARTIFACT_VERSION in .env[/success]")
        else:
            comment_out_env_var("TT_INFERENCE_ARTIFACT_BRANCH")
            artifact_branch = None
            console.print(f"[success]✅ Using version '{artifact_version}' — commented out TT_INFERENCE_ARTIFACT_BRANCH in .env[/success]")
    elif not artifact_branch and not artifact_version:
        artifact_version = "latest"

    # Create artifacts directory early so we can check for local tarballs
    artifacts_dir = os.path.join(TT_STUDIO_ROOT, ".artifacts")
    os.makedirs(artifacts_dir, exist_ok=True)

    # Proactively request sudo authentication early (before any container builds)
    sudo_available = request_sudo_authentication()
    if not sudo_available:
        pass  # Non-fatal — will retry if needed

    # Track if sudo was used during cleanup (for artifact info file)
    sudo_used_for_cleanup = False

    # Check if artifact already exists and is fully downloaded
    # A complete download has: artifact-info.txt (written last on success), workflows/utils.py, and VERSION
    if os.path.exists(INFERENCE_ARTIFACT_DIR):
        info_file_check = os.path.join(artifacts_dir, "artifact-info.txt")
        workflows_utils = os.path.join(INFERENCE_ARTIFACT_DIR, "workflows", "utils.py")
        version_file = os.path.join(INFERENCE_ARTIFACT_DIR, "VERSION")

        missing = [p for p in [info_file_check, workflows_utils, version_file] if not os.path.exists(p)]
        if missing:
            console.print(f"[warning]⚠️  Incomplete artifact detected (missing: {', '.join(os.path.basename(p) for p in missing)}) — re-downloading...[/warning]")
            try:
                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
            except Exception:
                pass

        if not missing:
            version = get_inference_server_version()
            version_str = f" (v{version})" if version else ""
            branch_str = f" (branch: {artifact_branch})" if artifact_branch else ""
            
            # If env requests a specific version/branch, verify it matches (if possible)
            version_mismatch = False
            branch_mismatch = False
            
            if artifact_branch:
                # For branches, check if we're switching from a version to a branch
                # Read artifact-info.txt to see what we currently have
                info_file = os.path.join(artifacts_dir, "artifact-info.txt")
                if os.path.exists(info_file):
                    try:
                        with open(info_file, 'r') as f:
                            info_content = f.read()
                            if 'artifact_type=version' in info_content:
                                branch_mismatch = True
                                console.print(f"[warning]⚠️  Switching from version artifact to branch '{artifact_branch}'[/warning]")
                            elif 'artifact_type=branch' in info_content:
                                # Check if branch name matches
                                if f"artifact_value={artifact_branch}" not in info_content:
                                    branch_mismatch = True
                                    console.print(f"[warning]⚠️  Branch mismatch: requested '{artifact_branch}' but artifact has different branch[/warning]")
                            else:
                                # Old-format or unrecognized artifact-info.txt — force re-download
                                branch_mismatch = True
                                console.print(f"[warning]⚠️  Unrecognized artifact metadata format - re-downloading branch '{artifact_branch}'[/warning]")
                    except Exception:
                        pass
                else:
                    # artifact-info.txt is missing - force re-download
                    branch_mismatch = True
                    console.print(f"[warning]⚠️  Artifact metadata missing - will re-download branch '{artifact_branch}'[/warning]")
                
                if not branch_mismatch:
                    if pull_branch:
                        # --pull-branch flag: force re-download to pick up new commits on the branch
                        branch_mismatch = True
                        console.print(f"[info]🔄 --pull-branch: re-fetching latest '{artifact_branch}' from remote...[/info]")
                    else:
                        # Check GitHub for new commits via commit SHA comparison
                        stored_sha = None
                        try:
                            with open(info_file_check) as _f:
                                for _line in _f:
                                    if _line.startswith("     commit_sha="):
                                        stored_sha = _line.split("=", 1)[1].strip()
                        except Exception:
                            pass
                        current_sha = fetch_branch_commit_sha(artifact_branch)
                        if current_sha and stored_sha and current_sha != stored_sha:
                            console.print(f"[warning]⚠️  Branch '{artifact_branch}' has new commits ({stored_sha[:7]} → {current_sha[:7]})[/warning]")
                            console.print("[muted]   Re-downloading latest...[/muted]")
                            branch_mismatch = True
                        elif current_sha and stored_sha:
                            console.print(f"[success]✅ TT Inference Server (branch: {artifact_branch}) up-to-date (commit: {current_sha[:7]})[/success]")
                        elif current_sha and not stored_sha:
                            # Artifact was downloaded without recording a commit SHA — re-fetch
                            # so we can record the SHA for future freshness checks.
                            console.print(f"[warning]⚠️  No stored commit SHA for '{artifact_branch}' — re-fetching to record current commit ({current_sha[:7]})[/warning]")
                            branch_mismatch = True
                        else:
                            # GitHub unreachable and no stored SHA — fall back gracefully
                            console.print(f"[success]✅ TT Inference Server (branch: {artifact_branch}) (cached)[/success]")
            elif artifact_version and artifact_version != "latest" and version:
                req = artifact_version.lstrip("v").strip()
                cur = version.lstrip("v").strip()
                if req != cur:
                    version_mismatch = True
                    console.print(f"[warning]⚠️  TT_INFERENCE_ARTIFACT_VERSION={artifact_version} but artifact has VERSION={version}[/warning]")
                else:
                    # Check if we're switching from a branch to a version
                    info_file = os.path.join(artifacts_dir, "artifact-info.txt")
                    if os.path.exists(info_file):
                        try:
                            with open(info_file, 'r') as f:
                                info_content = f.read()
                                if 'artifact_type=branch' in info_content:
                                    version_mismatch = True
                                    console.print(f"[warning]⚠️  Switching from branch artifact to version '{artifact_version}'[/warning]")
                                elif 'artifact_type=version' not in info_content:
                                    # Old-format or unrecognized artifact-info.txt — force re-download
                                    version_mismatch = True
                                    console.print(f"[warning]⚠️  Unrecognized artifact metadata format - re-downloading version '{artifact_version}'[/warning]")
                        except Exception:
                            pass
                    else:
                        # artifact-info.txt is missing - force re-download
                        version_mismatch = True
                        console.print(f"[warning]⚠️  Artifact metadata missing - will re-download version '{artifact_version}'[/warning]")
            
            if version_mismatch or branch_mismatch:
                console.print(f"[muted]   Removing existing artifact and downloading {artifact_version or artifact_branch}...[/muted]")

                # Proactively request sudo authentication since we may need it for cleanup
                console.print("[info]   Requesting sudo authentication in case elevated permissions are needed for cleanup...[/info]")
                sudo_available = request_sudo_authentication()
                if not sudo_available:
                    console.print("[warning]   Note: sudo authentication failed or unavailable. Will attempt cleanup without it.[/warning]")

                try:
                    # Remove the entire .artifacts directory to ensure complete cleanup
                    # Use a more robust deletion method that handles permission errors
                    if os.path.exists(artifacts_dir):
                        def handle_remove_readonly(func, path, exc):
                            """Handle permission errors during deletion by making files writable."""
                            if func in (os.rmdir, os.remove, os.unlink) and exc[1].errno == 13:
                                # Permission denied - try to make file writable and retry
                                try:
                                    os.chmod(path, 0o777)
                                    if os.path.isdir(path):
                                        os.rmdir(path)
                                    else:
                                        os.remove(path)
                                except Exception:
                                    # If we still can't delete it, just skip it
                                    pass
                            else:
                                raise
                        
                        # Try to remove with error handling for permission issues
                        try:
                            shutil.rmtree(artifacts_dir, onerror=handle_remove_readonly)
                            console.print("[muted]✅ Removed entire .artifacts directory[/muted]")
                        except PermissionError as pe:
                            # If there are still permission issues, try using sudo or just remove what we can
                            console.print(f"[warning]⚠️  Some files could not be deleted due to permissions: {pe}[/warning]")
                            console.print("[muted]   Attempting to remove with elevated permissions...[/muted]")
                            try:
                                # Try to change permissions recursively first
                                for root, dirs, files in os.walk(artifacts_dir):
                                    for d in dirs:
                                        os.chmod(os.path.join(root, d), 0o777)
                                    for f in files:
                                        os.chmod(os.path.join(root, f), 0o777)
                                # Now try to remove again
                                shutil.rmtree(artifacts_dir, onerror=handle_remove_readonly)
                                console.print("[muted]✅ Removed entire .artifacts directory after fixing permissions[/muted]")
                            except Exception as e2:
                                console.print(f"[warning]⚠️  Could not fully remove directory: {e2}[/warning]")
                                console.print("[muted]   Attempting to remove just the tt-inference-server subdirectory...[/muted]")
                                # Fallback: try to remove just the inference server directory
                                if os.path.exists(INFERENCE_ARTIFACT_DIR):
                                    try:
                                        for root, dirs, files in os.walk(INFERENCE_ARTIFACT_DIR):
                                            for d in dirs:
                                                os.chmod(os.path.join(root, d), 0o777)
                                            for f in files:
                                                os.chmod(os.path.join(root, f), 0o777)
                                        shutil.rmtree(INFERENCE_ARTIFACT_DIR, onerror=handle_remove_readonly)
                                        console.print("[muted]✅ Removed tt-inference-server directory[/muted]")
                                    except Exception as e3:
                                        console.print(f"[warning]⚠️  Could not remove directory even after fixing permissions: {e3}[/warning]")
                                        console.print("[info]   Attempting removal with sudo as final fallback...[/info]")

                                        # Final fallback: try sudo removal
                                        if remove_artifact_with_sudo(INFERENCE_ARTIFACT_DIR, "tt-inference-server artifact"):
                                            console.print("[success]✅ Successfully removed artifact directory using sudo[/success]")
                                            sudo_used_for_cleanup = True
                                            # Continue with setup - don't return False
                                        else:
                                            console.print("[error]⛔ Could not remove directory with sudo[/error]")
                                            console.print(f"[muted]   Please manually remove {INFERENCE_ARTIFACT_DIR} and try again[/muted]")
                                            return False
                    else:
                        # Fallback: just remove the artifact directory if .artifacts doesn't exist
                        if os.path.exists(INFERENCE_ARTIFACT_DIR):
                            shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                            console.print("[muted]✅ Removed artifact directory[/muted]")

                    # Recreate the artifacts directory for the new download
                    os.makedirs(artifacts_dir, exist_ok=True)
                    console.print("[muted]✅ Recreated .artifacts directory[/muted]")
                    console.print(f"[info]📥 Proceeding to download {artifact_version or artifact_branch}...[/info]")
                    # Continue to download logic below - don't return here
                except Exception as e:
                    console.print(f"[warning]⚠️  Failed to remove artifact directory: {e}[/warning]")
                    console.print("[info]   Attempting removal with sudo as final fallback...[/info]")

                    # Final fallback: try sudo removal
                    if remove_artifact_with_sudo(artifacts_dir, "artifacts directory"):
                        console.print("[success]✅ Successfully removed artifacts directory using sudo[/success]")
                        sudo_used_for_cleanup = True
                        # Recreate the directory and continue
                        os.makedirs(artifacts_dir, exist_ok=True)
                        console.print("[muted]✅ Recreated .artifacts directory[/muted]")
                        console.print(f"[info]📥 Proceeding to download {artifact_version or artifact_branch}...[/info]")
                        # Continue to download logic - don't return here
                    else:
                        console.print("[error]⛔ Could not remove directory with sudo[/error]")
                        console.print(f"[muted]   Please manually remove {INFERENCE_ARTIFACT_DIR} and try again[/muted]")
                        return False
            else:
                if not artifact_branch:
                    console.print(f"[success]✅ TT Inference Server{version_str} (cached)[/success]")
                
                # If version matches or no version specified, use existing artifact
                _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                # Write artifact info if not already present
                info_file = os.path.join(artifacts_dir, "artifact-info.txt")
                if not os.path.exists(info_file):
                    if artifact_branch:
                        _sha = fetch_branch_commit_sha(artifact_branch)
                        _write_artifact_info(artifacts_dir, "branch", artifact_branch, sudo_used=sudo_used_for_cleanup, commit_sha=_sha)
                    elif artifact_version:
                        _write_artifact_info(artifacts_dir, "version", artifact_version, sudo_used=sudo_used_for_cleanup)
                return True
            # If version mismatch, fall through to download the correct version below
        else:
            # Directory exists but is invalid (missing workflows), remove it and re-download
            console.print("[warning]⚠️  Artifact directory exists but is invalid (missing workflows/). Removing and re-downloading...[/warning]")
            try:
                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                console.print("[muted]✅ Removed invalid artifact directory[/muted]")
            except Exception as e:
                console.print(f"[warning]⚠️  Could not remove invalid directory: {e}[/warning]")
                # Try using sudo to remove the directory
                console.print("[info]   Attempting to remove with sudo...[/info]")
                if remove_artifact_with_sudo(INFERENCE_ARTIFACT_DIR, "invalid artifact directory"):
                    console.print("[success]✅ Successfully removed invalid artifact directory with sudo[/success]")
                    sudo_used_for_cleanup = True
                else:
                    console.print("[error]⛔ Failed to remove invalid artifact directory even with sudo[/error]")
                    console.print(f"[muted]   Please manually remove {INFERENCE_ARTIFACT_DIR} and try again[/muted]")
                    return False

    # Priority: Branch > Version
    if artifact_branch:
        # Download from GitHub branch
        console.print(f"[info]📥 Downloading TT Inference Server from GitHub branch: {artifact_branch}[/info]")

        # Sanitize branch name for filename (replace slashes with dashes)
        sanitized_branch = artifact_branch.replace("/", "-")

        artifact_file = os.path.join(artifacts_dir, f"tt-inference-server-{sanitized_branch}.tar.gz")

        # Use cached tarball only if artifact dir also exists (same snapshot).
        # If user deleted the extracted dir, re-download so we get current branch HEAD (overwrites old tarball).
        use_cached_tarball = (
            os.path.exists(artifact_file) and os.path.exists(INFERENCE_ARTIFACT_DIR)
        )
        if use_cached_tarball:
            console.print(f"[muted]📦 Using existing artifact tarball: {artifact_file}[/muted]")
        else:
            if os.path.exists(artifact_file) and not os.path.exists(INFERENCE_ARTIFACT_DIR):
                console.print("[muted]📦 Artifact directory missing; re-downloading branch to get latest commit...[/muted]")
            # Download (overwrites existing tarball if present; always gets current HEAD of branch)
            github_url = f"https://github.com/tenstorrent/tt-inference-server/archive/refs/heads/{artifact_branch}.tar.gz"
            try:
                from tt_setup.console import download_with_progress
                console.print(f"[muted]   Downloading from: {github_url}[/muted]")
                download_with_progress(github_url, artifact_file, "Downloading TT Inference Server")
            except Exception as e:
                error_str = str(e)
                if "404" in error_str or "Not Found" in error_str:
                    console.print(f"[error]⛔ Branch '{artifact_branch}' not found on GitHub (HTTP 404).[/error]")
                    console.print("[muted]   The branch name you configured does not exist.[/muted]")
                    console.print(f"[muted]   You entered: TT_INFERENCE_ARTIFACT_BRANCH={artifact_branch}[/muted]")
                    console.print("[muted]   Run: python run.py --reconfigure-inference-server[/muted]")
                    console.print("[muted]   Valid branches: https://github.com/tenstorrent/tt-inference-server/branches[/muted]")
                else:
                    console.print(f"[error]⛔ Failed to download from GitHub branch: {e}[/error]")
                    console.print(f"[muted]   Make sure the branch name '{artifact_branch}' exists in the repository[/muted]")
                if os.path.exists(artifact_file):
                    try:
                        os.remove(artifact_file)
                    except Exception:
                        pass
                return False
            if not os.path.exists(artifact_file):
                console.print("[error]⛔ Download failed: file not found after download[/error]")
                return False
            file_size = os.path.getsize(artifact_file)
            if file_size == 0:
                console.print("[error]⛔ Download failed: file is empty[/error]")
                try:
                    os.remove(artifact_file)
                except Exception:
                    pass
                return False
            console.print(f"[muted]✅ Artifact downloaded to {artifact_file} ({file_size:,} bytes)[/muted]")
        
        # Extract artifact
        if artifact_file and os.path.exists(artifact_file):
            try:
              with step("Extracting TT Inference Server", spinner=False) as s:
                console.print(f"[muted]📦 Extracting artifact from {artifact_file}...[/muted]")
                import tarfile
                with tarfile.open(artifact_file, "r:gz") as tar:
                    # Verify tarball is valid and not empty
                    members = tar.getmembers()
                    if not members:
                        console.print("[error]⛔ Tarball appears to be empty[/error]")
                        s.fail()
                        return False
                    console.print(f"[muted]   Extracting {len(members)} files...[/muted]")
                    tar.extractall(artifacts_dir)

                console.print("[muted]✅ Extraction complete. Searching for extracted directory...[/muted]")

                # GitHub branch archives extract as tt-inference-server-{branch}
                # But branch names with slashes (e.g., feature/xyz) become dashes in the directory name
                # Try multiple possible directory names
                possible_dirs = [
                    os.path.join(artifacts_dir, f"tt-inference-server-{artifact_branch}"),
                    os.path.join(artifacts_dir, f"tt-inference-server-{sanitized_branch}"),
                ]

                # Also check what was actually extracted
                extracted_dir = None
                for possible_dir in possible_dirs:
                    if os.path.exists(possible_dir):
                        extracted_dir = possible_dir
                        console.print(f"[muted]📁 Found extracted directory: {extracted_dir}[/muted]")
                        break

                # If not found, list directories in artifacts_dir to find the actual name
                if not extracted_dir:
                    try:
                        console.print("[muted]   Searching for directories starting with 'tt-inference-server'...[/muted]")
                        for item in os.listdir(artifacts_dir):
                            item_path = os.path.join(artifacts_dir, item)
                            if os.path.isdir(item_path) and item.startswith("tt-inference-server"):
                                extracted_dir = item_path
                                console.print(f"[muted]📁 Found extracted directory: {extracted_dir}[/muted]")
                                break
                    except Exception as e:
                        console.print(f"[warning]⚠️  Could not list artifacts directory: {e}[/warning]")

                if extracted_dir and os.path.exists(extracted_dir):
                    # Validate the extracted directory has required structure
                    if not validate_artifact_structure(extracted_dir):
                        s.fail()
                        return False

                    # Rename to final location
                    if extracted_dir != INFERENCE_ARTIFACT_DIR:
                        if os.path.exists(INFERENCE_ARTIFACT_DIR):
                            console.print(f"[muted]🗑️  Removing existing {INFERENCE_ARTIFACT_DIR}...[/muted]")
                            shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                        console.print(f"[muted]📦 Moving {extracted_dir} to {INFERENCE_ARTIFACT_DIR}...[/muted]")
                        os.rename(extracted_dir, INFERENCE_ARTIFACT_DIR)
                        console.print(f"[muted]✅ Renamed {extracted_dir} to {INFERENCE_ARTIFACT_DIR}[/muted]")

                    # Final verification that everything is in place
                    if not validate_artifact_structure(INFERENCE_ARTIFACT_DIR):
                        s.fail()
                        return False

                    _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                    commit_sha = fetch_branch_commit_sha(artifact_branch)
                    _write_artifact_info(artifacts_dir, "branch", artifact_branch, sudo_used=sudo_used_for_cleanup, commit_sha=commit_sha)
                    return True
                else:
                    console.print(f"[error]⛔ Extracted directory not found in {artifacts_dir}[/error]")
                    console.print(f"[muted]   Expected one of: {possible_dirs}[/muted]")
                    # List what's actually in artifacts_dir for debugging
                    try:
                        contents = os.listdir(artifacts_dir)
                        console.print(f"[muted]   Actual contents: {contents}[/muted]")
                    except Exception:
                        pass
                    s.fail()
                    return False
            except Exception as e:
                console.print(f"[error]⛔ Failed to extract artifact: {e}[/error]")
                import traceback
                traceback.print_exc()
                return False
    elif artifact_version:
        # Handle "latest" by using the main branch, or download a specific version
        if artifact_version == "latest":
            console.print("[warning]⚠️  'latest' version specified. Using 'main' branch as fallback.[/warning]")
            console.print("[muted]   To use a specific release version, set TT_INFERENCE_ARTIFACT_VERSION to a tag like 'v0.8.0'[/muted]")
            artifact_branch = "main"
            artifact_version = None
            # Re-run the branch download logic
            artifact_file = os.path.join(artifacts_dir, f"tt-inference-server-main.tar.gz")
            if os.path.exists(artifact_file):
                console.print(f"[muted]📦 Using existing artifact tarball: {artifact_file}[/muted]")
            else:
                github_url = f"https://github.com/tenstorrent/tt-inference-server/archive/refs/heads/main.tar.gz"
                try:
                    from tt_setup.console import download_with_progress
                    console.print(f"[muted]   Downloading from: {github_url}[/muted]")
                    download_with_progress(github_url, artifact_file, "Downloading TT Inference Server")
                    file_size = os.path.getsize(artifact_file)
                    if file_size == 0:
                        console.print("[error]⛔ Download failed: file is empty[/error]")
                        os.remove(artifact_file)
                        return False
                    console.print(f"[muted]✅ Artifact downloaded to {artifact_file} ({file_size:,} bytes)[/muted]")
                except Exception as e:
                    console.print(f"[error]⛔ Failed to download from GitHub branch: {e}[/error]")
                    return False
            
            # Extract using the same logic as branch extraction
            if artifact_file and os.path.exists(artifact_file):
                try:
                  with step("Extracting TT Inference Server", spinner=False) as s:
                    console.print(f"[muted]📦 Extracting artifact from {artifact_file}...[/muted]")
                    import tarfile
                    with tarfile.open(artifact_file, "r:gz") as tar:
                        members = tar.getmembers()
                        if not members:
                            console.print("[error]⛔ Tarball appears to be empty[/error]")
                            s.fail()
                            return False
                        console.print(f"[muted]   Extracting {len(members)} files...[/muted]")
                        tar.extractall(artifacts_dir)

                    console.print("[muted]✅ Extraction complete. Searching for extracted directory...[/muted]")
                    extracted_dir = os.path.join(artifacts_dir, "tt-inference-server-main")
                    if not os.path.exists(extracted_dir):
                        for item in os.listdir(artifacts_dir):
                            item_path = os.path.join(artifacts_dir, item)
                            if os.path.isdir(item_path) and item.startswith("tt-inference-server"):
                                extracted_dir = item_path
                                console.print(f"[muted]📁 Found extracted directory: {extracted_dir}[/muted]")
                                break

                    if extracted_dir and os.path.exists(extracted_dir):
                        # Validate the extracted directory has required structure
                        if not validate_artifact_structure(extracted_dir):
                            s.fail()
                            return False

                        if extracted_dir != INFERENCE_ARTIFACT_DIR:
                            if os.path.exists(INFERENCE_ARTIFACT_DIR):
                                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                            os.rename(extracted_dir, INFERENCE_ARTIFACT_DIR)
                            console.print(f"[muted]✅ Renamed {extracted_dir} to {INFERENCE_ARTIFACT_DIR}[/muted]")

                        # Final verification after rename
                        if not validate_artifact_structure(INFERENCE_ARTIFACT_DIR):
                            s.fail()
                            return False

                        _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                        # "latest" used main branch, so record branch not version
                        commit_sha = fetch_branch_commit_sha(artifact_branch)
                        _write_artifact_info(artifacts_dir, "branch", artifact_branch, sudo_used=sudo_used_for_cleanup, commit_sha=commit_sha)
                        return True
                    else:
                        console.print("[error]⛔ Extracted directory not found[/error]")
                        s.fail()
                        return False
                except Exception as e:
                    console.print(f"[error]⛔ Failed to extract artifact: {e}[/error]")
                    import traceback
                    traceback.print_exc()
                    return False
        else:
            # Download from GitHub release (existing logic)
            # Prefer local tarball if present (e.g. .artifacts/tt-inference-server-v0.8.0.tar.gz)
            version_without_v = artifact_version.lstrip("v").strip()
            possible_tarballs = [
                os.path.join(artifacts_dir, f"tt-inference-server-{artifact_version}.tar.gz"),
                os.path.join(artifacts_dir, f"tt-inference-server-{version_without_v}.tar.gz"),
            ]
            artifact_file = None
            for candidate in possible_tarballs:
                if os.path.exists(candidate):
                    artifact_file = candidate
                    console.print(f"[muted]📦 Using existing artifact tarball: {artifact_file}[/muted]")
                    break

            if not artifact_file:
                # Download from GitHub release
                console.print(f"[info]📥 Downloading TT Inference Server from GitHub release: {artifact_version}[/info]")
                github_url = f"https://github.com/tenstorrent/tt-inference-server/archive/refs/tags/{artifact_version}.tar.gz"
                artifact_file = os.path.join(artifacts_dir, f"tt-inference-server-{artifact_version}.tar.gz")
                try:
                    import urllib.request
                    console.print(f"[muted]   Downloading from: {github_url}[/muted]")
                    console.print("[muted]   This may take a few minutes...[/muted]")
                    urllib.request.urlretrieve(github_url, artifact_file)

                    # Verify download completed successfully
                    if not os.path.exists(artifact_file):
                        console.print("[error]⛔ Download failed: file not found after download[/error]")
                        return False

                    file_size = os.path.getsize(artifact_file)
                    if file_size == 0:
                        console.print("[error]⛔ Download failed: file is empty[/error]")
                        os.remove(artifact_file)
                        return False

                    console.print(f"[muted]✅ Artifact downloaded to {artifact_file} ({file_size:,} bytes)[/muted]")
                except Exception as e:
                    error_str = str(e)
                    if "404" in error_str or "Not Found" in error_str:
                        console.print(f"[error]⛔ Version '{artifact_version}' not found on GitHub (HTTP 404).[/error]")
                        console.print("[muted]   The release tag you configured does not exist.[/muted]")
                        console.print(f"[muted]   You entered: TT_INFERENCE_ARTIFACT_VERSION={artifact_version}[/muted]")
                        suggested = suggest_semver(artifact_version)
                        if suggested:
                            console.print(f"[muted]   Did you mean: {suggested} (semantic versioning uses vMAJOR.MINOR.PATCH)[/muted]")
                        console.print("[muted]   Run: python run.py --reconfigure-inference-server[/muted]")
                        console.print("[muted]   Valid releases: https://github.com/tenstorrent/tt-inference-server/releases[/muted]")
                    else:
                        console.print(f"[error]⛔ Failed to download from GitHub release: {e}[/error]")
                    if os.path.exists(artifact_file):
                        try:
                            os.remove(artifact_file)
                        except Exception:
                            pass
                    return False

            if artifact_file and os.path.exists(artifact_file):
                try:
                  with step("Extracting TT Inference Server", spinner=False) as s:
                    console.print(f"[muted]📦 Extracting artifact from {artifact_file}...[/muted]")
                    import tarfile
                    with tarfile.open(artifact_file, "r:gz") as tar:
                        members = tar.getmembers()
                        if not members:
                            console.print("[error]⛔ Tarball appears to be empty[/error]")
                            s.fail()
                            return False
                        console.print(f"[muted]   Extracting {len(members)} files...[/muted]")
                        tar.extractall(artifacts_dir)

                    console.print("[muted]✅ Extraction complete. Searching for extracted directory...[/muted]")
                    version_without_v = artifact_version.lstrip("v")
                    possible_dirs = [
                        os.path.join(artifacts_dir, f"tt-inference-server-{artifact_version}"),
                        os.path.join(artifacts_dir, f"tt-inference-server-{version_without_v}"),
                    ]
                    extracted_dir = None
                    for possible_dir in possible_dirs:
                        if os.path.exists(possible_dir):
                            extracted_dir = possible_dir
                            console.print(f"[muted]📁 Found extracted directory: {extracted_dir}[/muted]")
                            break

                    # If not found, search for any tt-inference-server directory
                    if not extracted_dir:
                        for item in os.listdir(artifacts_dir):
                            item_path = os.path.join(artifacts_dir, item)
                            if os.path.isdir(item_path) and item.startswith("tt-inference-server"):
                                extracted_dir = item_path
                                console.print(f"[muted]📁 Found extracted directory: {extracted_dir}[/muted]")
                                break

                    if extracted_dir and os.path.exists(extracted_dir):
                        # Validate the extracted directory has required structure
                        if not validate_artifact_structure(extracted_dir):
                            s.fail()
                            return False

                        # Rename to final location
                        if extracted_dir != INFERENCE_ARTIFACT_DIR:
                            if os.path.exists(INFERENCE_ARTIFACT_DIR):
                                console.print(f"[muted]🗑️  Removing existing {INFERENCE_ARTIFACT_DIR}...[/muted]")
                                shutil.rmtree(INFERENCE_ARTIFACT_DIR)
                            console.print(f"[muted]📦 Moving {extracted_dir} to {INFERENCE_ARTIFACT_DIR}...[/muted]")
                            os.rename(extracted_dir, INFERENCE_ARTIFACT_DIR)
                            console.print(f"[muted]✅ Renamed {extracted_dir} to {INFERENCE_ARTIFACT_DIR}[/muted]")

                        # Final verification after rename
                        if not validate_artifact_structure(INFERENCE_ARTIFACT_DIR):
                            s.fail()
                            return False

                        _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
                        _write_artifact_info(artifacts_dir, "version", artifact_version, sudo_used=sudo_used_for_cleanup)
                        return True
                    else:
                        console.print("[error]⛔ Extracted directory not found[/error]")
                        s.fail()
                        return False
                except Exception as e:
                    console.print(f"[error]⛔ Failed to extract artifact: {e}[/error]")
                    import traceback
                    traceback.print_exc()
                    return False

    # Fallback: check if artifact directory exists
    if os.path.exists(INFERENCE_ARTIFACT_DIR):
        _set_artifact_environment_variables(INFERENCE_ARTIFACT_DIR)
        return True
    else:
        console.print("[error]⛔ Error: Artifact directory not found[/error]")
        console.print("[muted]   Options:[/muted]")
        console.print("[muted]   1. Set TT_INFERENCE_ARTIFACT_VERSION to a release tag (e.g., 'v0.8.0')[/muted]")
        console.print("[muted]   2. Set TT_INFERENCE_ARTIFACT_BRANCH to a branch name (e.g., 'main', 'dev')[/muted]")
        console.print(f"[muted]   3. Extract the artifact manually to: {INFERENCE_ARTIFACT_DIR}[/muted]")
        console.print("[muted]   See: https://github.com/tenstorrent/tt-inference-server/releases[/muted]")
        return False


def request_sudo_authentication(force_prompt=False):
    """
    Request sudo authentication upfront and cache it for later use.
    
    Args:
        force_prompt (bool): If True, always prompt even if sudo is already authenticated
    
    Returns:
        bool: True if authenticated, False otherwise
    """
    # Check if sudo is available
    if not shutil.which("sudo"):
        console.print("[error]⛔ Error: sudo is not available on this system.[/error]")
        return False

    # First, check if sudo is already authenticated (non-interactive mode)
    if not force_prompt:
        check_result = subprocess.run(["sudo", "-n", "-v"], capture_output=True, text=True)
        if check_result.returncode == 0:
            return True

    console.print("[info]🔐 TT Inference Server setup requires sudo privileges. Please enter your password:[/info]")
    try:
        # Test sudo access - this will prompt for password if needed
        result = subprocess.run(["sudo", "-v"], check=True, capture_output=True, text=True)
        console.print("[success]✅ Sudo authentication successful.[/success]")
        return True
    except subprocess.CalledProcessError as e:
        console.print("[error]⛔ Error: Failed to authenticate with sudo[/error]")
        if e.returncode == 1:
            console.print("[warning]   This usually means the password was incorrect or sudo access was denied.[/warning]")
        return False
    except FileNotFoundError:
        console.print("[error]⛔ Error: sudo command not found[/error]")
        return False


def remove_artifact_with_sudo(directory_path, description="artifact directory"):
    """
    Attempt to remove a directory using sudo after user confirmation.

    Args:
        directory_path (str): Absolute path to directory to remove
        description (str): Human-readable description for user prompt

    Returns:
        bool: True if successfully removed, False if user declined or removal failed
    """
    # Check if directory exists
    if not os.path.exists(directory_path):
        return True

    # Check if sudo is available
    if not shutil.which("sudo"):
        console.print("[error]⛔ Error: sudo is not available on this system.[/error]")
        return False

    # Explain to user why sudo is needed
    console.print("")
    console.print(f"[warning]🔐 Permission issues prevent normal removal of {description}[/warning]")
    console.print(f"[muted]   Directory: {directory_path}[/muted]")
    console.print("[muted]   Sudo access is required to remove files with restricted permissions.[/muted]")

    # Prompt for confirmation
    try:
        user_input = input(f"   Use sudo to remove {description}? (y/N): ").strip().lower()
        if user_input not in ['y', 'yes']:
            console.print("[warning]   Sudo removal declined by user.[/warning]")
            return False
    except KeyboardInterrupt:
        console.print("\n[warning]   Sudo removal cancelled by user.[/warning]")
        return False

    # Request sudo authentication first
    console.print("[muted]   Requesting sudo authentication...[/muted]")
    if not request_sudo_authentication():
        return False

    # Attempt sudo removal
    console.print(f"[muted]   Removing {description} with sudo...[/muted]")
    try:
        result = subprocess.run(
            ["sudo", "rm", "-rf", directory_path],
            capture_output=True,
            text=True,
            check=True
        )

        # Verify directory was removed
        if not os.path.exists(directory_path):
            return True
        else:
            console.print("[error]⛔ Directory still exists after sudo removal[/error]")
            return False

    except subprocess.CalledProcessError as e:
        console.print(f"[error]⛔ Error: Sudo removal failed: {e}[/error]")
        if e.stderr:
            console.print(f"[muted]   {e.stderr}[/muted]")
        return False
    except FileNotFoundError:
        console.print("[error]⛔ Error: sudo or rm command not found[/error]")
        return False
    except KeyboardInterrupt:
        console.print("\n[warning]   Sudo removal cancelled by user.[/warning]")
        return False
