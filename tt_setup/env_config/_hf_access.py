# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""HuggingFace token gated-model access probing + rendering."""

try:
    import requests  # noqa: F401
    HAS_REQUESTS = True
except ImportError:
    import urllib.request  # noqa: F401
    HAS_REQUESTS = False
from tt_setup.constants import *
from tt_setup.console import add_note, console


def _hf_check_repo(token, repo_id, filename="config.json"):
    """Return HTTP status code for a HuggingFace repo file. Returns None on network error."""
    url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
    headers = {"User-Agent": "tt-studio"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        if HAS_REQUESTS:
            return requests.get(url, headers=headers, timeout=10, allow_redirects=True).status_code
        else:
            req = urllib.request.Request(url, headers=headers)
            try:
                urllib.request.urlopen(req, timeout=10)
                return 200
            except urllib.error.HTTPError as e:
                return e.code
    except Exception:
        return None


def check_hf_access(token):
    """Check if the HF token can access the gated model repos.

    Returns (status, results):
      - status: True if any repo is accessible, False if the token is
        invalid/denied, None if HuggingFace was unreachable for every repo.
      - results: list of (label, repo_id, http_code) per repo (code None =
        unreachable). The caller renders this — one calm line by default, the
        full per-repo breakdown on failure or with --verbose.
    """
    # diffusers repos (Wan/FLUX) have no root config.json — check model_index.json instead
    repos = [
        ("meta-llama/Llama-3.1-8B-Instruct", "Llama 3.1", "config.json"),
        ("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3", "config.json"),
        ("Qwen/Qwen3-32B", "Qwen3-32B", "config.json"),
        ("Wan-AI/Wan2.2-T2V-A14B-Diffusers", "Wan2.2-T2V", "model_index.json"),
        ("black-forest-labs/FLUX.1-dev", "FLUX.1-dev", "model_index.json"),
    ]
    results = [(label, repo_id, _hf_check_repo(token, repo_id, filename)) for repo_id, label, filename in repos]

    codes = [code for _, _, code in results]
    if all(c is None for c in codes):
        return (None, results)
    if any(c == 401 for c in codes) or any(c == 403 for c in codes):
        return (False, results)
    if any(c == 200 for c in codes):
        return (True, results)
    return (None, results)


def render_hf_access(status, results):
    """Render check_hf_access() output through the theme: one ✓ line when all
    good (unless --verbose); otherwise a per-model breakdown that names which
    gated models you can't access yet, with a link to request access on each."""
    ok_labels = [label for label, _, code in results if code == 200]
    if all(code is None for _, _, code in results):
        console.print("[muted]🤗 HuggingFace: couldn't reach to verify access — continuing[/muted]")
        return
    if status and not is_verbose():
        # Inside a collapsing phase the single phase line covers this; only print
        # the standalone confirmation when not folded into a phase.
        if not in_phase():
            console.print(f"[success]✓[/success] HuggingFace access [muted]· {', '.join(ok_labels)}[/muted]")
        return

    console.print("[info]🤗 HuggingFace access:[/info]")
    blocked = []          # (label, repo_id) — gated models this token can't reach
    token_problem = False  # a 401 means the token itself is invalid/expired
    for label, repo_id, code in results:
        if code == 200:
            console.print(f"  [success]✓[/success] {label}: access confirmed")
        elif code == 401:
            console.print(f"  [error]✗[/error] {label}: [bold]no access[/bold] — token invalid or expired (401)")
            blocked.append((label, repo_id))
            token_problem = True
        elif code == 403:
            console.print(f"  [error]✗[/error] {label}: [bold]no access[/bold] — gate not accepted for this model (403)")
            blocked.append((label, repo_id))
        elif code is None:
            console.print(f"  [warning]…[/warning] {label}: couldn't reach HuggingFace")
        else:
            console.print(f"  [warning]…[/warning] {label}: unexpected HTTP {code}")

    if blocked:
        console.print()
        console.print("[warning]Request access for these gated models, then re-run TT Studio:[/warning]")
        for label, repo_id in blocked:
            console.print(f"  [muted]{label}[/muted]  →  https://huggingface.co/{repo_id}")
        console.print("  [muted]Open each link, click “Agree and access repository” (sign in first), then run: python run.py[/muted]")
        if token_problem:
            console.print("  [muted]If your token is invalid/expired, create a new one: https://huggingface.co/settings/tokens[/muted]")

        # Also record it for the end-of-run recap — per-phase collapse clears the
        # inline copy above, so the user needs the links surfaced again at the end.
        add_note("[warning]HuggingFace — request access, then re-run:[/warning]")
        for label, repo_id in blocked:
            add_note(f"  [muted]{label}[/muted]  →  https://huggingface.co/{repo_id}")
        if token_problem:
            add_note("  [muted]Token invalid/expired — new one: https://huggingface.co/settings/tokens[/muted]")

