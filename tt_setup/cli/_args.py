# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Typer CLI surface: options, the entry callback, and main()."""

import json
import os
from typing import Optional

import typer
from types import SimpleNamespace
from tt_setup.console import console, ensure_region_reset, set_verbose
from tt_setup.constants import *
from tt_setup.cli._run import _run


def _build_args(**overrides):
    """Build the args namespace `_run()` consumes, from one canonical field list.

    Both the default `_entry` callback and the `run` subcommand funnel through
    here so their field sets never drift (`_run` reads several via attribute
    access). Pass only the fields that differ from the defaults.
    """
    defaults = dict(
        dev=False, cleanup=False, cleanup_all=False, yes=False, help_env=False,
        reconfigure=False, reconfigure_inference_server=False,
        resync=False, pull_branch=False, skip_fastapi=False,
        skip_docker_control=False, no_sudo=False, no_browser=False,
        wait_for_services=False, browser_timeout=60,
        add_headers=False, check_headers=False, auto_deploy=None,
        device_id=None, in_browser=False, fix_docker=False, configure_env=False,
        status=False, logs=False, info=False, report_bug=False,
        install_shortcut=False,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _validate_model_name(model):
    """Best-effort pre-startup catalog check so a typo fails fast instead of
    after the ~2-min stack-up. Silently skips when the catalog isn't fetched yet
    (first run) — resolve_model_id does the authoritative check post-startup.
    """
    catalog = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config",
        "models_from_inference_server.json",
    )
    try:
        with open(catalog) as f:
            names = [m.get("model_name", "") for m in json.load(f).get("models", [])]
    except (OSError, ValueError):
        return  # catalog not synced yet — let the live check handle it
    names = [n for n in names if n]
    if not names:
        return
    needle = model.lower()
    if any(needle == n.lower() or needle in n.lower() for n in names):
        return

    import difflib
    close = difflib.get_close_matches(model, names, n=5, cutoff=0.3)
    console.print(f"[error]⛔ Model '{model}' is not in the catalog.[/error]")
    if close:
        console.print("[info]Did you mean:[/info]")
        for n in close:
            console.print(f"  [bold]{n}[/bold]")
    else:
        console.print(f"[muted]Available: {', '.join(sorted(names))}[/muted]")
    raise typer.Exit(1)


app = typer.Typer(
    add_completion=False,
    rich_markup_mode="rich",
    context_settings={"help_option_names": ["-h", "--help"]},
    help="🚀 TT Studio Setup Script — environment, Docker services, and TT Inference Server.",
)


@app.callback(invoke_without_command=True)
def _entry(
    ctx: typer.Context,
    # ── Setup & Configuration (the everyday flags) ───────────────────────────
    dev: bool = typer.Option(False, "--dev", help="Development mode (hot-reload, suggested defaults).", rich_help_panel="Setup & Configuration"),
    reconfigure_inference_server: bool = typer.Option(False, "--reconfigure-inference-server", help="Reconfigure the TT Inference Server artifact.", rich_help_panel="Setup & Configuration"),
    configure_env: bool = typer.Option(False, "--configure-env", help="Interactively configure all environment variables.", rich_help_panel="Setup & Configuration"),
    install_shortcut: bool = typer.Option(False, "--install-shortcut", help="Add a `tt-studio` shell shortcut so you can skip typing `python run.py`.", rich_help_panel="Setup & Configuration"),
    # ── Model Deployment ─────────────────────────────────────────────────────
    auto_deploy: str = typer.Option(None, "--auto-deploy", metavar="MODEL_NAME", help="Auto-deploy the given model after startup (headless by default).", rich_help_panel="Model Deployment"),
    device_id: Optional[int] = typer.Option(None, "--device-id", metavar="CHIP_ID", help="Chip slot index (0-7) for the deploy. Omit to let the backend allocate based on the model.", rich_help_panel="Model Deployment"),
    in_browser: bool = typer.Option(False, "--in-browser", help="Deploy through the web UI instead of headlessly.", rich_help_panel="Model Deployment"),
    # ── Lifecycle ────────────────────────────────────────────────────────────
    stop: bool = typer.Option(False, "--stop", help="Stop TT Studio: tear down Docker containers and networks.", rich_help_panel="Lifecycle"),
    status: bool = typer.Option(False, "--status", help="Open the live monitor TUI for a running stack.", rich_help_panel="Lifecycle"),
    logs: bool = typer.Option(False, "--logs", help="Stream all container logs (docker compose logs -f).", rich_help_panel="Lifecycle"),
    info: bool = typer.Option(False, "--info", help="Re-show the 'TT Studio is ready' summary (URLs, mode, hardware).", rich_help_panel="Lifecycle"),
    # ── Reset (--purge-all) ──────────────────────────────────────────────────
    purge_all: bool = typer.Option(False, "--purge-all", help="Stop and wipe everything incl. persistent data and .env.", rich_help_panel="Reset (--purge-all)"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip the --purge-all confirmation prompt.", rich_help_panel="Reset (--purge-all)"),
    # ── Advanced (less-common setup/runtime knobs) ───────────────────────────
    reconfigure: bool = typer.Option(False, "--reconfigure", help="Reset preferences and reconfigure all options.", rich_help_panel="Advanced"),
    resync: bool = typer.Option(False, "--resync", help="Force resync of the model catalog.", rich_help_panel="Advanced"),
    pull_branch: bool = typer.Option(False, "--pull-branch", help="Re-download the inference artifact from its branch.", rich_help_panel="Advanced"),
    skip_fastapi: bool = typer.Option(False, "--skip-fastapi", help="Skip TT Inference Server FastAPI setup.", rich_help_panel="Advanced"),
    skip_docker_control: bool = typer.Option(False, "--skip-docker-control", help="Skip the Docker Control Service.", rich_help_panel="Advanced"),
    no_sudo: bool = typer.Option(False, "--no-sudo", help="Skip sudo usage (may limit functionality).", rich_help_panel="Advanced"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Skip automatic browser opening.", rich_help_panel="Advanced"),
    wait_for_services: bool = typer.Option(False, "--wait-for-services", help="Wait for all services to be healthy.", rich_help_panel="Advanced"),
    browser_timeout: int = typer.Option(60, "--browser-timeout", help="Seconds to wait for frontend before opening browser.", rich_help_panel="Advanced"),
    # ── Developer Tools ──────────────────────────────────────────────────────
    add_headers: bool = typer.Option(False, "--add-headers", help="Add missing SPDX license headers (excludes frontend).", rich_help_panel="Developer Tools"),
    check_headers: bool = typer.Option(False, "--check-headers", help="Check for missing SPDX license headers.", rich_help_panel="Developer Tools"),
    # ── Troubleshooting & Info ───────────────────────────────────────────────
    help_env: bool = typer.Option(False, "--help-env", help="Show detailed environment-variables help.", rich_help_panel="Troubleshooting & Info"),
    report_bug: bool = typer.Option(False, "--report-bug", help="Collect a diagnostics bundle and open a pre-filled GitHub issue.", rich_help_panel="Troubleshooting & Info"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show full per-phase output instead of the calm summary.", rich_help_panel="Troubleshooting & Info"),
    # ── Deprecated / hidden ──────────────────────────────────────────────────
    fix_docker: bool = typer.Option(False, "--fix-docker", hidden=True, help="Deprecated. Start Docker yourself; see the links shown when the daemon isn't running."),
    # ── Deprecated aliases (hidden) ──────────────────────────────────────────
    cleanup: bool = typer.Option(False, "--cleanup", hidden=True, help="Deprecated alias for --stop."),
    cleanup_all: bool = typer.Option(False, "--cleanup-all", hidden=True, help="Deprecated alias for --purge-all."),
):
    """Set up and launch TT Studio. With no flags, runs the default minimal setup."""
    # A subcommand (e.g. `run`) was invoked — its handler owns the flow. Without
    # this guard the callback would also run the full default setup.
    if ctx.invoked_subcommand is not None:
        return

    set_verbose(verbose)

    # --cleanup/--cleanup-all are deprecated aliases for --stop/--purge-all.
    # Warn, then normalize all four onto the internal cleanup/cleanup_all flags.
    if cleanup or cleanup_all:
        legacy = "--cleanup-all" if cleanup_all else "--cleanup"
        replacement = "--purge-all" if cleanup_all else "--stop"
        console.print(f"[warning]⚠  {legacy} is deprecated; use {replacement} instead.[/warning]")
    full_teardown = purge_all or cleanup_all
    stop_requested = stop or cleanup or full_teardown

    args = _build_args(
        dev=dev, cleanup=stop_requested, cleanup_all=full_teardown, yes=yes, help_env=help_env,
        reconfigure=reconfigure, reconfigure_inference_server=reconfigure_inference_server,
        resync=resync, pull_branch=pull_branch, skip_fastapi=skip_fastapi,
        skip_docker_control=skip_docker_control, no_sudo=no_sudo, no_browser=no_browser,
        wait_for_services=wait_for_services, browser_timeout=browser_timeout,
        add_headers=add_headers, check_headers=check_headers, auto_deploy=auto_deploy,
        device_id=device_id, in_browser=in_browser, fix_docker=fix_docker,
        configure_env=configure_env, status=status, logs=logs, info=info,
        report_bug=report_bug, install_shortcut=install_shortcut,
    )
    _run(args)


@app.command("run")
def run_model_command(
    model: str = typer.Argument(..., metavar="MODEL_NAME", help="Model to deploy, e.g. Qwen3-32B."),
    device_id: Optional[int] = typer.Option(None, "--device-id", metavar="CHIP_ID", help="Chip slot index (0-7). Omit to let the backend allocate based on the model."),
    in_browser: bool = typer.Option(False, "--in-browser", help="Deploy through the web UI instead of headlessly."),
    dev: bool = typer.Option(False, "--dev", help="Development mode (hot-reload)."),
    no_browser: bool = typer.Option(False, "--no-browser", help="Skip opening the browser."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show full per-phase output instead of the calm summary."),
):
    """Launch TT Studio and deploy MODEL_NAME (ollama-style).

    Brings the whole stack up and deploys the model in one command. The deploy
    runs headlessly against the backend by default and also opens the browser at
    /models-deployed so you can watch; pass --in-browser to drive the deploy
    through the web UI instead.
    """
    set_verbose(verbose)
    _validate_model_name(model)
    args = _build_args(
        dev=dev, auto_deploy=model, device_id=device_id,
        in_browser=in_browser, no_browser=no_browser,
    )
    _run(args)


def main():
    """Entry point: run the Typer app. The atexit + finally net guarantees the
    terminal scroll region (sticky header) is always reset, even on an exit path
    that didn't go through the normal teardown."""
    import atexit
    atexit.register(ensure_region_reset)
    try:
        app()
    finally:
        ensure_region_reset()

