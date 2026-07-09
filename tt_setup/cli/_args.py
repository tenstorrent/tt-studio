# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Typer CLI surface: options, the entry callback, and main()."""

import typer
from types import SimpleNamespace
from tt_setup.console import console, ensure_region_reset, set_verbose
from tt_setup.constants import *
from tt_setup.cli._run import _run


app = typer.Typer(
    add_completion=False,
    rich_markup_mode="rich",
    context_settings={"help_option_names": ["-h", "--help"]},
    help="🚀 TT Studio Setup Script — environment, Docker services, and TT Inference Server.",
)


@app.callback(invoke_without_command=True)
def _entry(
    # ── Setup & Configuration (the everyday flags) ───────────────────────────
    dev: bool = typer.Option(False, "--dev", help="Development mode (hot-reload, suggested defaults).", rich_help_panel="Setup & Configuration"),
    reconfigure_inference_server: bool = typer.Option(False, "--reconfigure-inference-server", help="Reconfigure the TT Inference Server artifact.", rich_help_panel="Setup & Configuration"),
    configure_env: bool = typer.Option(False, "--configure-env", help="Interactively configure all environment variables.", rich_help_panel="Setup & Configuration"),
    # ── Model Deployment ─────────────────────────────────────────────────────
    auto_deploy: str = typer.Option(None, "--auto-deploy", metavar="MODEL_NAME", help="Auto-deploy the given model after startup.", rich_help_panel="Model Deployment"),
    device_id: int = typer.Option(0, "--device-id", metavar="CHIP_ID", help="Chip slot index (0-7) for --auto-deploy.", rich_help_panel="Model Deployment"),
    # ── Lifecycle ────────────────────────────────────────────────────────────
    stop: bool = typer.Option(False, "--stop", help="Stop TT Studio: tear down Docker containers and networks.", rich_help_panel="Lifecycle"),
    status: bool = typer.Option(False, "--status", help="Open the live monitor TUI for a running stack.", rich_help_panel="Lifecycle"),
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
    set_verbose(verbose)

    # --cleanup/--cleanup-all are deprecated aliases for --stop/--purge-all.
    # Warn, then normalize all four onto the internal cleanup/cleanup_all flags.
    if cleanup or cleanup_all:
        legacy = "--cleanup-all" if cleanup_all else "--cleanup"
        replacement = "--purge-all" if cleanup_all else "--stop"
        console.print(f"[warning]⚠  {legacy} is deprecated; use {replacement} instead.[/warning]")
    full_teardown = purge_all or cleanup_all
    stop_requested = stop or cleanup or full_teardown

    args = SimpleNamespace(
        dev=dev, cleanup=stop_requested, cleanup_all=full_teardown, yes=yes, help_env=help_env,
        reconfigure=reconfigure, reconfigure_inference_server=reconfigure_inference_server,
        resync=resync, pull_branch=pull_branch, skip_fastapi=skip_fastapi,
        skip_docker_control=skip_docker_control, no_sudo=no_sudo, no_browser=no_browser,
        wait_for_services=wait_for_services, browser_timeout=browser_timeout,
        add_headers=add_headers, check_headers=check_headers, auto_deploy=auto_deploy,
        device_id=device_id, fix_docker=fix_docker, configure_env=configure_env,
        status=status, report_bug=report_bug,
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

