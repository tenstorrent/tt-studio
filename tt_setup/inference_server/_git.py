# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Branch/commit-SHA resolution against the GitHub API."""

import urllib.request
from tt_setup.constants import *


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


def _is_commit_sha(value):
    """Return True if value looks like a full 40-char hex commit SHA."""
    return bool(value) and len(value) == 40 and all(c in '0123456789abcdefABCDEF' for c in value)


def _ref_status(url):
    """Query a GitHub API URL and classify the result.

    Returns:
        "ok"      — the ref exists (HTTP 2xx).
        "missing" — GitHub confirmed it does not exist (HTTP 404).
        "unknown" — we couldn't verify (offline, timeout, rate-limited, etc.).

    The "missing" vs "unknown" distinction matters: callers reject "missing"
    (the user typed a bad ref) but only warn on "unknown" (don't block an
    offline user who may already have a cached artifact).
    """
    import urllib.error
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return "ok" if 200 <= resp.status < 300 else "unknown"
    except urllib.error.HTTPError as e:
        return "missing" if e.code == 404 else "unknown"
    except Exception:
        return "unknown"


def check_branch_exists(branch):
    """Check a branch name (or commit SHA) exists upstream. Returns ok/missing/unknown."""
    repo = "https://api.github.com/repos/tenstorrent/tt-inference-server"
    if _is_commit_sha(branch):
        return _ref_status(f"{repo}/commits/{branch}")
    return _ref_status(f"{repo}/branches/{branch}")


def check_release_exists(version):
    """Check a release tag (e.g. 'v0.8.0') exists upstream. Returns ok/missing/unknown."""
    repo = "https://api.github.com/repos/tenstorrent/tt-inference-server"
    return _ref_status(f"{repo}/git/ref/tags/{version}")
