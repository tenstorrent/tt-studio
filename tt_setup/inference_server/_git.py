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
