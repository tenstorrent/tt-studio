# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Interactive monitor TUI for a running TT Studio stack (`python run.py --status`).

A k9s-style dashboard: a services pane (live health dot, port, uptime) on the
left, a live log pane on the right, and footer key bindings. Container services
stream `docker compose logs -f`; host services (inference, docker-control) tail
their log files. Health is probed concurrently every couple of seconds.

On a non-TTY (piped/redirected), `run_status()` falls back to a one-shot text
table instead of launching the full-screen app.
"""

import os
import sys

from tt_setup.constants import DOCKER_CONTROL_LOG_FILE, MODEL_RUN_LOG_FILE, TT_STUDIO_ROOT
from tt_setup.services import snapshot_health

# Compose service names are stable across dev/prod/tt-hardware overrides, so we
# drive logs/restart by service name and never juggle container-name suffixes.
SERVICES = [
    {"name": "Backend",        "compose": "tt_studio_backend",  "port": 8000, "health": "http://localhost:8000/up/",              "kind": "container"},
    {"name": "Frontend",       "compose": "tt_studio_frontend", "port": 3000, "health": "http://localhost:3000/",                 "kind": "container"},
    {"name": "Agent",          "compose": "tt_studio_agent",    "port": 8080, "health": "http://localhost:8080/",                 "kind": "container"},
    {"name": "ChromaDB",       "compose": "tt_studio_chroma",   "port": 8111, "health": "http://localhost:8111/api/v1/heartbeat", "kind": "container"},
    {"name": "Inference",      "compose": None,                 "port": 8001, "health": "http://localhost:8001/",                 "kind": "host", "log": MODEL_RUN_LOG_FILE},
    {"name": "Docker Control", "compose": None,                 "port": 8002, "health": "http://localhost:8002/api/v1/health",    "kind": "host", "log": DOCKER_CONTROL_LOG_FILE},
]

_APP_DIR = os.path.join(TT_STUDIO_ROOT, "app")


def _compose_base(dev_mode):
    """`docker compose …` prefix (with the right -f overrides), output suppressed."""
    from tt_setup.docker import build_docker_compose_command
    return build_docker_compose_command(dev_mode=dev_mode, show_hardware_info=False, quiet=True)


def run_status(dev_mode=False):
    """Entry point for `--status`. Launches the TUI on a TTY, else prints a
    one-shot text snapshot. Returns an exit code."""
    if not sys.stdout.isatty():
        return _print_text_snapshot()
    try:
        from tt_setup.monitor_app import MonitorApp
    except ModuleNotFoundError as exc:  # textual missing (venv not rebuilt yet)
        if exc.name in ("textual", "monitor_app", "tt_setup.monitor_app"):
            from tt_setup.console import console
            console.print("[warning]The monitor TUI needs the 'textual' package. "
                          "Re-run `python run.py` once to rebuild the environment.[/warning]")
            return _print_text_snapshot()
        raise
    MonitorApp(dev_mode=dev_mode).run()
    return 0


def _print_text_snapshot():
    """Non-TTY fallback: a single static health table (no live TUI)."""
    from rich.table import Table

    from tt_setup.console import console
    health = snapshot_health([s["health"] for s in SERVICES])
    table = Table(title="TT Studio · status", title_style="bold accent")
    table.add_column("Service")
    table.add_column("Port")
    table.add_column("Health")
    for s in SERVICES:
        up = health.get(s["health"], False)
        glyph = "[success]● up[/success]" if up else "[error]✗ down[/error]"
        table.add_row(s["name"], str(s["port"]), glyph)
    console.print(table)
    return 0
