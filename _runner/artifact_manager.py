# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import subprocess
import shutil

from _runner.constants import (
    C_RESET, C_RED, C_GREEN, C_YELLOW, C_BLUE, C_CYAN,
    C_BOLD, C_TT_PURPLE,
    TT_STUDIO_ROOT, INFERENCE_SERVER_DIR, INFERENCE_SERVER_BRANCH,
)
from _runner.utils import run_command


class ArtifactManager:
    def __init__(self, ctx, env_mgr):
        self.ctx = ctx
        self.env_mgr = env_mgr

    def is_valid_git_repo(self, path):
        """Check if directory is a valid git repository.

        Args:
            path: Path to check

        Returns:
            None if directory doesn't exist
            True if directory is a valid git repository
            False if directory exists but is not a valid git repository
        """
        if not os.path.exists(path):
            return None  # Doesn't exist

        git_dir = os.path.join(path, ".git")
        if os.path.isfile(git_dir) or os.path.isdir(git_dir):
            # Verify it's actually valid by checking for HEAD
            try:
                result = subprocess.run(
                    ["git", "-C", path, "rev-parse", "--git-dir"],
                    capture_output=True, text=True, check=False
                )
                return result.returncode == 0
            except Exception:
                return False

        return False  # Exists but not a git repo

    def get_inference_server_version(self):
        """Get the current version/branch of the TT Inference Server."""
        if not os.path.exists(INFERENCE_SERVER_DIR):
            return None
        try:
            result = subprocess.run(
                ["git", "branch", "--show-current"],
                capture_output=True, text=True, check=False,
                cwd=INFERENCE_SERVER_DIR
            )
            return result.stdout.strip() or None
        except Exception:
            return None

    def configure_inference_server_artifact(self):
        """
        Configure the TT Inference Server artifact (submodule).
        Ensures submodules are properly initialized and on the correct branch.
        """
        return self._initialize_submodules()

    def _initialize_submodules(self):
        """Initialize git submodules if they don't exist or are not properly set up."""
        print(f"🔧 Checking and initializing git submodules...")

        # Check if we're in a git repository
        if not os.path.exists(".git"):
            print(f"{C_RED}⛔ Error: Not in a git repository. Cannot initialize submodules.{C_RESET}")
            print(f"   Please ensure you cloned the repository with: git clone --recurse-submodules https://github.com/tenstorrent/tt-studio.git")
            return False

        # Check if .gitmodules exists
        if not os.path.exists(".gitmodules"):
            print(f"{C_RED}⛔ Error: .gitmodules file not found. Cannot initialize submodules.{C_RESET}")
            print(f"   Please ensure you have the complete repository.")
            return False

        # Check for corrupted submodule directories before attempting initialization
        submodule_path = os.path.join(TT_STUDIO_ROOT, "tt-inference-server")
        repo_state = self.is_valid_git_repo(submodule_path)

        if repo_state is False:  # Directory exists but is corrupted
            print(f"{C_YELLOW}⚠️  Detected corrupted submodule directory at {submodule_path}{C_RESET}")
            print(f"   Cause: Directory exists but is not a valid git repository")
            print(f"   This usually happens when:")
            print(f"   - A previous git operation was interrupted")
            print(f"   - The directory was created manually")
            print(f"   - Git's internal state is corrupted")
            print(f"   Solution: Cleaning up and re-initializing...")

            try:
                # Clean up corrupted directory
                shutil.rmtree(submodule_path)
                print(f"{C_GREEN}✅ Removed corrupted directory{C_RESET}")

                # Clean up git's internal cache
                git_modules_path = os.path.join(TT_STUDIO_ROOT, ".git", "modules", "tt-inference-server")
                if os.path.exists(git_modules_path):
                    shutil.rmtree(git_modules_path)
                    print(f"{C_GREEN}✅ Cleaned up git submodule cache{C_RESET}")
            except Exception as cleanup_error:
                print(f"{C_RED}⛔ Error during cleanup: {cleanup_error}{C_RESET}")
                print(f"   Please manually remove: {submodule_path}")
                return False

        try:
            # Step 1: Sync submodule configurations to align .gitmodules with .git/config
            print(f"🔄 Synchronizing submodule configurations...")
            run_command(["git", "submodule", "sync", "--recursive"], check=True)

            # Step 2: Update submodules to ensure they're properly initialized and on correct branches
            print(f"📦 Initializing and updating git submodules...")
            run_command(["git", "submodule", "update", "--init", "--recursive"], check=True)

            # Step 3: Ensure submodules are on the correct branch as specified in .gitmodules
            print(f"🌿 Ensuring submodules are on correct branches...")
            run_command(["git", "submodule", "foreach", "--recursive", "git checkout $(git config -f $toplevel/.gitmodules submodule.$name.branch || echo main)"], check=True)

            print(f"✅ Successfully initialized and updated git submodules")
            return True

        except (subprocess.CalledProcessError, SystemExit) as e:
            print(f"{C_RED}⛔ Error: Failed to initialize submodules{C_RESET}")

            # Provide specific diagnostic information
            error_output = ""
            if hasattr(e, 'stderr') and e.stderr:
                error_output = str(e.stderr)
            elif hasattr(e, 'output') and e.output:
                error_output = str(e.output)

            if "already exists and is not an empty directory" in error_output or "already exists" in str(e):
                print(f"   Cause: Submodule directory exists but couldn't be initialized")
                print(f"   This usually happens when:")
                print(f"   - A previous git operation was interrupted")
                print(f"   - The directory was created manually")
                print(f"   - Git's internal state is corrupted")
                print(f"\n   Manual fix:")
                print(f"   1. rm -rf tt-inference-server .git/modules/tt-inference-server")
                print(f"   2. Run this script again")
            else:
                print(f"   Error details: {error_output if error_output else str(e)}")
                print(f"   Please try manually: git submodule update --init --recursive")

            return False

    def validate_artifact_structure(self):
        """Validate that the inference server directory has the expected structure."""
        if not os.path.exists(INFERENCE_SERVER_DIR):
            return False
        requirements_file = os.path.join(INFERENCE_SERVER_DIR, "requirements-api.txt")
        return os.path.exists(requirements_file)

    def _set_artifact_environment_variables(self):
        """Set environment variables related to the inference server artifact."""
        jwt_secret = self.env_mgr.get_env_var("JWT_SECRET")
        hf_token = self.env_mgr.get_env_var("HF_TOKEN")

        if jwt_secret:
            os.environ["JWT_SECRET"] = jwt_secret
        if hf_token:
            os.environ["HF_TOKEN"] = hf_token

    def _write_artifact_info(self):
        """Write artifact version/info for reference."""
        version = self.get_inference_server_version()
        if version:
            print(f"📋 TT Inference Server version/branch: {version}")
