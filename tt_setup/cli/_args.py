# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Typer CLI surface: options, the entry callback, and main()."""

import sys
import typer
from types import SimpleNamespace
from typing import List, Optional
from tt_setup.console import console, ensure_region_reset, set_no_clear, set_verbose
from tt_setup.constants import *
from tt_setup.constants import _PURGE_MODEL_PICKER
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
    reconfigure_inference_server: bool = typer.Option(False, "--reconfigure-inference-server", "--reconfig-inf", help="Reconfigure the TT Inference Server artifact (short alias: --reconfig-inf).", rich_help_panel="Setup & Configuration"),
    configure_env: bool = typer.Option(False, "--configure-env", help="Interactively configure all environment variables.", rich_help_panel="Setup & Configuration"),
    accept_terms: bool = typer.Option(False, "--accept-terms", help="Accept the OS Model Terms non-interactively (for CI/automation).", rich_help_panel="Setup & Configuration"),
    install_shortcut: bool = typer.Option(False, "--install-shortcut", help="Add a `tt-studio` shell shortcut so you can skip typing `python run.py`.", rich_help_panel="Setup & Configuration"),
    switch: str = typer.Option(None, "--switch", metavar="REF", help="Switch this checkout to a git branch or tag (e.g. dev, v2.9.0-rc1), then exit; re-run to start.", rich_help_panel="Setup & Configuration"),
    # ── Model Deployment ─────────────────────────────────────────────────────
    auto_deploy: str = typer.Option(None, "--auto-deploy", metavar="MODEL_NAME", help="Auto-deploy the given model after startup.", rich_help_panel="Model Deployment"),
    device_id: int = typer.Option(0, "--device-id", metavar="CHIP_ID", help="Chip slot index (0-7) for --auto-deploy.", rich_help_panel="Model Deployment"),
    # ── Lifecycle ────────────────────────────────────────────────────────────
    stop: bool = typer.Option(False, "--stop", help="Stop TT Studio: tear down Docker containers and networks.", rich_help_panel="Lifecycle"),
    status: bool = typer.Option(False, "--status", help="Open the live monitor TUI for a running stack.", rich_help_panel="Lifecycle"),
    status_json: bool = typer.Option(False, "--json", help="With --status: print a one-shot machine-readable status dump (NDJSON) instead of the TUI.", rich_help_panel="Lifecycle"),
    logs: bool = typer.Option(False, "--logs", help="Stream all container logs (docker compose logs -f).", rich_help_panel="Lifecycle"),
    info: bool = typer.Option(False, "--info", help="Re-show the 'TT Studio is ready' summary (URLs, mode, hardware).", rich_help_panel="Lifecycle"),
    # ── Reset (--purge-all) ──────────────────────────────────────────────────
    purge_all: bool = typer.Option(False, "--purge-all", help="Stop and wipe everything incl. persistent data and .env.", rich_help_panel="Reset (--purge-all)"),
    purge_model: Optional[List[str]] = typer.Option(None, "--purge-model", metavar="MODEL", help="Uninstall one model: weights, volume, env, container (image if unshared). Repeatable; bare --purge-model opens an interactive picker.", rich_help_panel="Reset (--purge-all)"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip the --purge-all / --purge-model confirmation prompt.", rich_help_panel="Reset (--purge-all)"),
    uninstall: bool = typer.Option(False, "--uninstall", help="Full uninstall: run the --purge-all teardown and remove the `tt-studio` shell shortcut.", rich_help_panel="Reset (--purge-all)"),
    # ── Advanced (less-common setup/runtime knobs) ───────────────────────────
    reconfigure: bool = typer.Option(False, "--reconfigure", help="Reset preferences and reconfigure all options.", rich_help_panel="Advanced"),
    resync: bool = typer.Option(False, "--resync", help="Force resync of the model catalog.", rich_help_panel="Advanced"),
    pull_branch: bool = typer.Option(False, "--pull-branch", help="Re-download the inference artifact from its branch.", rich_help_panel="Advanced"),
    build_images: bool = typer.Option(False, "--build-images", help="Build container images locally instead of pulling prebuilt ones from ghcr.io.", rich_help_panel="Advanced"),
    skip_fastapi: bool = typer.Option(False, "--skip-fastapi", help="Skip TT Inference Server FastAPI setup.", rich_help_panel="Advanced"),
    skip_docker_control: bool = typer.Option(False, "--skip-docker-control", help="Skip the Docker Control Service.", rich_help_panel="Advanced"),
    no_sudo: bool = typer.Option(False, "--no-sudo", help="Skip sudo usage (may limit functionality).", rich_help_panel="Advanced"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Skip automatic browser opening.", rich_help_panel="Advanced"),
    wait_for_services: bool = typer.Option(False, "--wait-for-services", help="Wait for all services to be healthy.", rich_help_panel="Advanced"),
    json_events: bool = typer.Option(False, "--json-events", help="Emit machine-readable NDJSON events on stdout (for a wrapping program, e.g. a desktop launcher). Implies non-interactive: prompts become prompt_blocked events; human output moves to stderr.", rich_help_panel="Advanced"),
    browser_timeout: int = typer.Option(60, "--browser-timeout", help="Seconds to wait for frontend before opening browser.", rich_help_panel="Advanced"),
    # ── Developer Tools ──────────────────────────────────────────────────────
    add_headers: bool = typer.Option(False, "--add-headers", help="Add missing SPDX license headers (excludes frontend).", rich_help_panel="Developer Tools"),
    check_headers: bool = typer.Option(False, "--check-headers", help="Check for missing SPDX license headers.", rich_help_panel="Developer Tools"),
    # ── Troubleshooting & Info ───────────────────────────────────────────────
    help_env: bool = typer.Option(False, "--help-env", help="Show detailed environment-variables help.", rich_help_panel="Troubleshooting & Info"),
    report_bug: bool = typer.Option(False, "--report-bug", help="Collect a diagnostics bundle and open a pre-filled GitHub issue.", rich_help_panel="Troubleshooting & Info"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show full per-phase output instead of the calm summary.", rich_help_panel="Troubleshooting & Info"),
    no_clear: bool = typer.Option(False, "--no-clear", help="Keep the terminal's contents and show full startup detail (don't clear the screen).", rich_help_panel="Troubleshooting & Info"),
    # ── Deprecated / hidden ──────────────────────────────────────────────────
    fix_docker: bool = typer.Option(False, "--fix-docker", hidden=True, help="Deprecated. Start Docker yourself; see the links shown when the daemon isn't running."),
    # ── Deprecated aliases (hidden) ──────────────────────────────────────────
    cleanup: bool = typer.Option(False, "--cleanup", hidden=True, help="Deprecated alias for --stop."),
    cleanup_all: bool = typer.Option(False, "--cleanup-all", hidden=True, help="Deprecated alias for --purge-all."),
):
    """Set up and launch TT Studio. With no flags, runs the default minimal setup."""
    set_verbose(verbose or no_clear)   # --no-clear shows full step detail too
    set_no_clear(no_clear)

    if status_json and not status:
        raise typer.BadParameter("--json requires --status")
    # Machine-readable modes: stdout becomes pure NDJSON (one JSON object per
    # line); raw print() and the Rich consoles are re-pointed at stderr.
    if json_events or (status and status_json):
        from tt_setup.console import events
        events.enable()

    # --cleanup/--cleanup-all are deprecated aliases for --stop/--purge-all.
    # Warn, then normalize all four onto the internal cleanup/cleanup_all flags.
    if cleanup or cleanup_all:
        legacy = "--cleanup-all" if cleanup_all else "--cleanup"
        replacement = "--purge-all" if cleanup_all else "--stop"
        console.print(f"[warning]⚠  {legacy} is deprecated; use {replacement} instead.[/warning]")
    # --uninstall is the full purge plus shell-shortcut removal.
    full_teardown = purge_all or cleanup_all or uninstall
    stop_requested = stop or cleanup or full_teardown

    args = SimpleNamespace(
        dev=dev, cleanup=stop_requested, cleanup_all=full_teardown, yes=yes, help_env=help_env,
        reconfigure=reconfigure, reconfigure_inference_server=reconfigure_inference_server,
        resync=resync, pull_branch=pull_branch, build_images=build_images, skip_fastapi=skip_fastapi,
        skip_docker_control=skip_docker_control, no_sudo=no_sudo, no_browser=no_browser,
        wait_for_services=wait_for_services, browser_timeout=browser_timeout,
        add_headers=add_headers, check_headers=check_headers, auto_deploy=auto_deploy,
        device_id=device_id, fix_docker=fix_docker, configure_env=configure_env,
        status=status, status_json=status_json, json_events=json_events,
        logs=logs, info=info, report_bug=report_bug,
        install_shortcut=install_shortcut, accept_terms=accept_terms,
        switch=switch, uninstall=uninstall, purge_model=list(purge_model or []),
    )
    _run(args)


def _normalize_purge_model_argv(argv):
    """Support bare `--purge-model` (no model name) meaning "open the picker".
    The vendored click in this typer version can't express an option with an
    optional value, so inject the picker sentinel whenever --purge-model is the
    last token or is followed by another flag. `--purge-model NAME` and
    `--purge-model=NAME` pass through untouched."""
    out = []
    for i, token in enumerate(argv):
        out.append(token)
        if token == "--purge-model" and (
            i + 1 == len(argv) or argv[i + 1].startswith("-")
        ):
            out.append(_PURGE_MODEL_PICKER)
    return out


def main():
    """Entry point: run the Typer app. The atexit + finally net guarantees the
    terminal scroll region (sticky header) is always reset, even on an exit path
    that didn't go through the normal teardown."""
    import atexit
    atexit.register(ensure_region_reset)
    try:
        app(_normalize_purge_model_argv(sys.argv[1:]))
    finally:
        ensure_region_reset()

