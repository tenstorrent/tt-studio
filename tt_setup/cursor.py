# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Connect the Cursor editor to the TT-Studio coding-agent gateway.

Cursor sends custom-API-key requests from its own cloud, not from the local
machine, so the LiteLLM gateway (localhost:4000) must be reachable over public
HTTPS before Cursor can use it. `python run.py --cursor` automates everything
that can be automated: it reads the gateway info from the running backend,
opens a cloudflared quick tunnel, and prints the three values to paste into
Cursor Settings -> Models. The paste itself stays manual because Cursor keeps
its API-key settings in secure storage that no external tool can write.
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

from tt_setup.console import confirm, console, notice_panel, step
from tt_setup.constants import ENV_FILE_PATH
from tt_setup.env_config import get_env_var

# Quick tunnels get a random subdomain here; parse it out of cloudflared's logs.
_TUNNEL_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

_CODING_AGENTS_INFO_URL = "http://localhost:8000/models/coding-agents/"
_CLOUDFLARED_RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download"
_LOCAL_BIN = os.path.expanduser("~/.local/bin")


def parse_tunnel_url(text):
    """Return the https://*.trycloudflare.com URL in `text`, or None."""
    match = _TUNNEL_URL_RE.search(text or "")
    return match.group(0) if match else None


def build_cursor_values(tunnel_url, master_key, models):
    """Assemble the paste-ready Cursor settings from tunnel + gateway state.

    Returns (base_url, api_key, model_names) — pure, so it's unit-testable.
    """
    base_url = tunnel_url.rstrip("/") + "/v1"
    return base_url, master_key, list(models)


def _gateway_port():
    try:
        return int(get_env_var("LITELLM_PORT", "4000") or "4000")
    except ValueError:
        return 4000


def _http_get_json(url, token=None, timeout=5):
    """GET `url` and parse JSON. Returns None on any failure."""
    request = urllib.request.Request(url)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                return None
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def fetch_gateway_info():
    """Gateway state from the running backend (the Coding Agents page source).

    Returns the parsed payload — {"health", "gateway_port", "master_key",
    "models": [{"name", "type"}, ...]} — or None if the backend is unreachable.
    """
    return _http_get_json(_CODING_AGENTS_INFO_URL)


def gateway_model_names(info):
    """Model names from a coding-agents info payload ([] if none)."""
    if not info:
        return []
    return [m.get("name") for m in info.get("models", []) if m.get("name")]


def find_cloudflared():
    """Path to a usable cloudflared binary, or None."""
    found = shutil.which("cloudflared")
    if found:
        return found
    local = os.path.join(_LOCAL_BIN, "cloudflared")
    if os.path.isfile(local) and os.access(local, os.X_OK):
        return local
    return None


def _cloudflared_download_url():
    """Download URL for this platform's static cloudflared binary (Linux only)."""
    if platform.system() != "Linux":
        return None
    machine = platform.machine().lower()
    arch = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(machine)
    if not arch:
        return None
    return f"{_CLOUDFLARED_RELEASES}/cloudflared-linux-{arch}"


def install_cloudflared():
    """Offer to download cloudflared to ~/.local/bin. Returns its path or None."""
    url = _cloudflared_download_url()
    console.print("[info]cloudflared (the tunnel tool) isn't installed.[/info]")
    if url is None:
        console.print("[warning]Install it yourself, then re-run: "
                      "https://developers.cloudflare.com/cloudflared/ "
                      "(macOS: brew install cloudflared)[/warning]")
        return None
    if not confirm(f"Download it now to {_LOCAL_BIN}?", default=True):
        console.print("[muted]Skipped. Install cloudflared and re-run python run.py --cursor[/muted]")
        return None
    target = os.path.join(_LOCAL_BIN, "cloudflared")
    with step("Downloading cloudflared"):
        os.makedirs(_LOCAL_BIN, exist_ok=True)
        urllib.request.urlretrieve(url, target)
        os.chmod(target, 0o755)
    return target


def start_tunnel(cloudflared_path, port):
    """Start a cloudflared quick tunnel to the gateway port.

    Returns (process, public_url), or (None, None) if cloudflared exits or
    never reports a URL.
    """
    process = subprocess.Popen(
        [cloudflared_path, "tunnel", "--url", f"http://localhost:{port}", "--no-autoupdate"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    # cloudflared logs the assigned URL to stderr shortly after startup.
    collected = []
    try:
        for line in process.stderr:
            collected.append(line)
            url = parse_tunnel_url(line)
            if url:
                return process, url
            if process.poll() is not None:
                break
    except KeyboardInterrupt:
        process.terminate()
        raise
    process.terminate()
    tail = "".join(collected[-10:]).strip()
    if tail:
        console.print(f"[muted]{tail}[/muted]")
    return None, None


def connect_cursor(args):
    """Entry point for `python run.py --cursor`."""
    if not os.path.exists(ENV_FILE_PATH):
        console.print(notice_panel(
            "[bold error]TT Studio isn't set up yet[/bold error]",
            ["No .env file found — run [info]python run.py[/info] first to set up and start TT Studio."],
            border_style="error"))
        sys.exit(1)

    info = fetch_gateway_info()
    if info is None:
        console.print(notice_panel(
            "[bold error]TT Studio isn't running[/bold error]",
            ["The backend didn't answer on http://localhost:8000.",
             "Start TT Studio first: [info]python run.py[/info]",
             "then re-run [info]python run.py --cursor[/info]."],
            border_style="error"))
        sys.exit(1)

    if info.get("health") != "healthy":
        console.print(notice_panel(
            "[bold error]Coding-agent gateway is not healthy[/bold error]",
            ["The LiteLLM gateway (tt_studio_litellm) isn't answering yet.",
             "Give it a moment after startup, or check [info]python run.py --logs[/info]."],
            border_style="error"))
        sys.exit(1)

    master_key = info.get("master_key") or get_env_var("LITELLM_MASTER_KEY", "")
    if not master_key:
        console.print(notice_panel(
            "[bold error]Gateway key not configured[/bold error]",
            ["LITELLM_MASTER_KEY is missing — restart TT Studio with [info]python run.py[/info]."],
            border_style="error"))
        sys.exit(1)

    port = info.get("gateway_port") or _gateway_port()
    models = gateway_model_names(info)
    if not models:
        console.print("[warning]⚠  No chat models are deployed yet — Cursor setup will still work, "
                      "but deploy a model in TT Studio (Models page) before using it.[/warning]")

    cloudflared = find_cloudflared() or install_cloudflared()
    if not cloudflared:
        sys.exit(1)

    console.print("[info]Opening a public tunnel to the gateway "
                  "(Cursor's servers must reach it over HTTPS)…[/info]")
    process, tunnel_url = start_tunnel(cloudflared, port)
    if not tunnel_url:
        console.print(notice_panel(
            "[bold error]Couldn't open the tunnel[/bold error]",
            ["cloudflared didn't report a public URL. Check your internet connection and retry.",
             f"Manual alternative: [info]cloudflared tunnel --url http://localhost:{port}[/info]"],
            border_style="error"))
        sys.exit(1)

    base_url, api_key, model_names = build_cursor_values(tunnel_url, master_key, models)
    # Values print as plain full-width lines (a fixed-width panel would truncate
    # the long tunnel URL and break copy-paste); the panel below carries the steps.
    console.print()
    console.print("[muted]Override OpenAI Base URL[/muted]")
    console.print(f"  [info]{base_url}[/info]")
    console.print("[muted]OpenAI API Key[/muted]")
    console.print(f"  [info]{api_key}[/info]")
    console.print("[muted]Model name(s)[/muted]")
    console.print(f"  [info]{', '.join(model_names) if model_names else '(deploy a model first)'}[/info]")
    footer = [
        "[muted]1 · Enable “OpenAI API Key” and paste the key above[/muted]",
        "[muted]2 · Enable “Override OpenAI Base URL” and paste the Base URL[/muted]",
        "[muted]3 · Add a custom model with the exact model name, then Verify[/muted]",
        "",
        "[muted]Keep this command running — the tunnel closes when it exits.[/muted]",
        "[muted]Note · Cursor's Tab completion always uses Cursor's own models.[/muted]",
    ]
    console.print()
    console.print(notice_panel(
        "[bold accent]In Cursor · Settings → Models → API Keys[/bold accent]", footer))
    console.print()

    try:
        process.wait()
        console.print("[warning]Tunnel closed (cloudflared exited).[/warning]")
    except KeyboardInterrupt:
        process.terminate()
        console.print("\n[muted]Tunnel closed.[/muted]")
