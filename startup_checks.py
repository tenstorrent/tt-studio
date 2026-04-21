# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC


"""
startup_checks.py — Pre-flight freshness checks for tt-studio.

Extracted from run.py following the same pattern as venv_utils.py.
Checks whether the local tt-studio checkout and the downloaded
tt-inference-server artifact are up to date with GitHub before any
other startup work begins.
"""

import os
import subprocess
import json
import urllib.request


# ── colour codes (same as run.py) ────────────────────────────────────────────
C_RESET  = "\033[0m"
C_GREEN  = "\033[92m"
C_YELLOW = "\033[93m"
C_BLUE   = "\033[94m"


def _fetch_github_sha(owner: str, repo: str, branch: str) -> str | None:
    """Return the latest commit SHA for owner/repo@branch, or None on failure."""
    url = f"https://api.github.com/repos/{owner}/{repo}/git/refs/heads/{branch}"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
            if isinstance(data, list):
                return data[0]["object"]["sha"] if data else None
            return data["object"]["sha"]
    except Exception:
        return None


def _read_artifact_commit_sha(tt_studio_root: str) -> str | None:
    """
    Read the commit SHA stored in artifact-info.txt when the
    tt-inference-server artifact was last downloaded.
    Returns None if the file is missing or has no commit_sha entry.
    """
    info_file = os.path.join(tt_studio_root, ".artifacts", "artifact-info.txt")
    if not os.path.exists(info_file):
        return None
    try:
        with open(info_file) as f:
            for line in f:
                if line.strip().startswith("commit_sha="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None


def check_startup_freshness(tt_studio_root: str, get_env_var_fn) -> dict:
    """
    Freshness check called at the very start of main(), before any startup work.

    Compares:
      1. Local tt-studio HEAD vs the same branch on GitHub.
      2. Stored artifact commit SHA vs the latest on GitHub (branch mode only).

    Prints green checkmarks when up to date, yellow warnings when behind.
    Never raises — network failures are silently skipped.

    Returns a dict with keys:
      - tt_studio_behind (bool): True if local branch is behind GitHub.
      - artifact_behind (bool): True if the artifact branch is behind GitHub.
      - artifact_branch (str | None): The artifact branch name being tracked,
          or None when using a pinned version.

    Args:
        tt_studio_root:  Absolute path to the tt-studio repo root.
        get_env_var_fn:  run.py's get_env_var() so we can read .env without
                         duplicating its parsing logic.
    """
    result = {
        "tt_studio_behind": False,
        "artifact_behind": False,
        "artifact_branch": None,
    }

    print(f"\n{C_BLUE}🔍 Checking for updates...{C_RESET}")

    # ── 1. tt-studio self-check ───────────────────────────────────────────────
    try:
        local_sha = subprocess.run(
            ["git", "-C", tt_studio_root, "rev-parse", "HEAD"],
            capture_output=True, text=True, check=False,
        ).stdout.strip()
        local_branch = subprocess.run(
            ["git", "-C", tt_studio_root, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, check=False,
        ).stdout.strip()
    except Exception:
        local_sha = local_branch = ""

    if local_sha and local_branch and local_branch not in ("HEAD", ""):
        remote_sha = _fetch_github_sha("tenstorrent", "tt-studio", local_branch)
        if remote_sha is None:
            print(f"{C_YELLOW}   tt-studio: could not reach GitHub to check for updates{C_RESET}")
        elif local_sha == remote_sha:
            print(f"{C_GREEN}✓  tt-studio '{local_branch}': up to date ({local_sha[:7]}){C_RESET}")
        else:
            print(f"{C_YELLOW}⚠️  tt-studio '{local_branch}': behind GitHub "
                  f"({local_sha[:7]} → {remote_sha[:7]}){C_RESET}")
            print(f"   Run: git pull")
            result["tt_studio_behind"] = True
    else:
        print(f"{C_YELLOW}   tt-studio: could not determine local branch/SHA{C_RESET}")

    # ── 2. Artifact (tt-inference-server) freshness check ────────────────────
    artifact_branch = (
        get_env_var_fn("TT_INFERENCE_ARTIFACT_BRANCH")
        or os.getenv("TT_INFERENCE_ARTIFACT_BRANCH", "")
    )
    result["artifact_branch"] = artifact_branch or None

    if not artifact_branch:
        # Version-pinned artifact — no branch to check against
        print()
        return result

    stored_sha = _read_artifact_commit_sha(tt_studio_root)
    remote_sha = _fetch_github_sha("tenstorrent", "tt-inference-server", artifact_branch)

    if remote_sha is None:
        print(f"{C_YELLOW}   Artifact: could not reach GitHub to check for updates{C_RESET}")
    elif not stored_sha:
        # Artifact exists but no commit SHA was recorded — treat as outdated so
        # setup_tt_inference_server will re-fetch and record the SHA.
        print(f"{C_YELLOW}⚠️  Artifact '{artifact_branch}': no stored commit SHA "
              f"(latest on GitHub: {remote_sha[:7]}) — needs refresh{C_RESET}")
        result["artifact_behind"] = True
    elif stored_sha == remote_sha:
        print(f"{C_GREEN}✓  Artifact '{artifact_branch}': up to date ({stored_sha[:7]}){C_RESET}")
    else:
        print(f"{C_YELLOW}⚠️  Artifact '{artifact_branch}': behind GitHub "
              f"({stored_sha[:7]} → {remote_sha[:7]}){C_RESET}")
        result["artifact_behind"] = True

    print()
    return result


if __name__ == "__main__":
    # Standalone test — reads TT_INFERENCE_ARTIFACT_BRANCH from app/.env directly
    root = os.path.dirname(os.path.abspath(__file__))

    def _read_env(key):
        env_file = os.path.join(root, "app", ".env")
        try:
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(f"{key}=") and not line.startswith("#"):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
        return ""

    status = check_startup_freshness(root, _read_env)
    print(f"Result: {status}")
