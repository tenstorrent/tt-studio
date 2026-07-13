# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Frontend npm-dependency check + git-repo validation."""

import os
import subprocess
from tt_setup.constants import *
from tt_setup.console import console, show_detail


def is_valid_git_repo(path):
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


def ensure_frontend_dependencies(force_prompt=False, quick_setup=False):
    """
    Ensures frontend dependencies are available locally for IDE support.
    This is optional for running the app, as dependencies are always installed
    inside the Docker container, but it greatly improves the development experience
    (e.g., for TypeScript autocompletion).
    
    Args:
        force_prompt (bool): If True, always prompt user even if preference exists
        quick_setup (bool): If True, automatically skip npm installation without prompting (quick setup)
    """
    frontend_dir = os.path.join(TT_STUDIO_ROOT, "app", "frontend")
    node_modules_dir = os.path.join(frontend_dir, "node_modules")
    package_json_path = os.path.join(frontend_dir, "package.json")

    if not os.path.exists(package_json_path):
        console.print(f"[error]⛔ package.json not found in {frontend_dir}[/error]")
        return False

    # If node_modules already exists and is populated, we're good.
    if os.path.exists(node_modules_dir) and os.listdir(node_modules_dir):
        return True

    # Local node_modules is optional — the running app always installs its deps
    # inside the Docker container. We no longer prompt to install it locally;
    # just leave a quiet hint for anyone who wants IDE type-checking/autocomplete.
    if show_detail():
        console.print(
            "[muted]Frontend deps install in Docker; skipping the local copy. "
            "For IDE support run: cd app/frontend && npm install[/muted]"
        )
    return True

