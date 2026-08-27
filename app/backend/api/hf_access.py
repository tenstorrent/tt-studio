# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Hugging Face access checks for the gated models TT Studio relies on.

Ports the CLI check from run.py into the backend so the UI can render
per-model status in the Welcome flow and Settings dialog.
"""

import requests
from typing import List, Dict, Optional


# Only repos that are actually gated on Hugging Face belong here (Qwen and Wan
# are public). Diffusers repos (FLUX) have no root config.json, so check
# model_index.json instead.
HF_GATED_MODELS = [
    ("meta-llama/Llama-3.1-8B-Instruct", "Llama 3.1", "config.json"),
    ("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3", "config.json"),
    ("black-forest-labs/FLUX.1-dev", "FLUX.1-dev", "model_index.json"),
]


def _check_repo(token: str, repo_id: str, filename: str = "config.json") -> Optional[int]:
    url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
    headers = {"User-Agent": "tt-studio"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        return requests.get(url, headers=headers, timeout=10, allow_redirects=True).status_code
    except Exception:
        return None


def _status_from_code(code: Optional[int]) -> str:
    if code is None:
        return "error"
    if code == 200:
        return "granted"
    if code == 401:
        return "auth_failed"
    if code == 403:
        return "denied"
    return "error"


def check_hf_repos(token: str, repos: List[str]) -> List[Dict]:
    """Access status for arbitrary repos, in check_hf_access's shape.

    Mirrors DeployView's gate, including its model_index.json retry: diffusers
    repos have no root config.json, so a gated one would read as "error".

    Works without a token too: public repos answer 200 anonymously, so an
    ungated model reads "granted" even with nothing saved. An anonymous
    401/403 means the repo is gated and no token exists — that's "no_token",
    not a bad credential.
    """
    labels = {repo: label for repo, label, _ in HF_GATED_MODELS}
    results: List[Dict] = []
    for repo in repos:
        code = _check_repo(token, repo)
        if code == 404:
            code = _check_repo(token, repo, "model_index.json")
        status = _status_from_code(code)
        if not token and status in ("auth_failed", "denied"):
            status = "no_token"
        results.append({
            "label": labels.get(repo, repo.split("/")[-1]),
            "repo": repo,
            "status": status,
            "http_status": code,
            "url": f"https://huggingface.co/{repo}",
        })
    return results


def check_hf_access(token: str) -> List[Dict]:
    """Return one row per gated model with normalized status."""
    results: List[Dict] = []
    for repo, label, filename in HF_GATED_MODELS:
        code = _check_repo(token, repo, filename)
        results.append({
            "label": label,
            "repo": repo,
            "status": _status_from_code(code),
            "http_status": code,
            "url": f"https://huggingface.co/{repo}",
        })
    return results
