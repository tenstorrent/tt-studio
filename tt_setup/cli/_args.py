# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Typer CLI surface: options, the entry callback, and main()."""

import json
import os
import sys
import typer
from types import SimpleNamespace
from typing import List, Optional
from tt_setup.console import console, ensure_region_reset, set_no_clear, set_verbose
from tt_setup.constants import *
from tt_setup.constants import _PURGE_MODEL_PICKER
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
        resync=False, pull_branch=False, build_images=False, skip_fastapi=False,
        skip_docker_control=False, no_sudo=False, no_browser=False,
        wait_for_services=False, browser_timeout=60,
        add_headers=False, check_headers=False, auto_deploy=None,
        device_id=None, headless=False, fix_docker=False, configure_env=False,
        status=False, logs=False, info=False, report_bug=False,
        install_shortcut=False, accept_terms=False, switch=None,
        uninstall=False, purge_model=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _catalog_models():
    """Full catalog entries as {name, group, boards}. Empty list when the catalog
    isn't fetched yet (first run) or can't be parsed. `group` is the display type
    (LLM, VLM, IMAGE, …); `boards` are the device_configurations it supports."""
    catalog = os.path.join(
        TT_STUDIO_ROOT, "app", "backend", "shared_config",
        "models_from_inference_server.json",
    )
    try:
        with open(catalog) as f:
            entries = json.load(f).get("models", [])
    except (OSError, ValueError):
        return []
    out = []
    for m in entries:
        name = m.get("model_name", "")
        if not name:
            continue
        out.append({
            "name": name,
            "group": m.get("display_model_type") or m.get("model_type") or "OTHER",
            "boards": m.get("device_configurations", []) or [],
        })
    return out


def _catalog_model_names():
    """Sorted catalog model names (all boards). Empty when not synced yet."""
    return sorted({m["name"] for m in _catalog_models()})


def _complete_model(incomplete: str):
    """Shell-completion callback: catalog model names matching the partial input.
    Degrades to nothing when the catalog isn't synced or completion isn't set up."""
    lo = incomplete.lower()
    return [n for n in _catalog_model_names() if lo in n.lower()]


def _detect_board():
    """Best-effort board code (e.g. 'P300x2', 'N150') via tt-smi, in the same
    vocabulary as the catalog's device_configurations. Empty string when tt-smi is
    unavailable/unreadable or there's no local hardware (remote/cloud mode)."""
    try:
        from tt_setup.shell import check_tt_smi
        status, _detail, board = check_tt_smi()
    except Exception:
        return ""
    return board if status == "ok" else ""


# Friendly group headers + display order for the interactive picker.
_MODEL_GROUP_LABELS = {
    "LLM": "LLMs", "VLM": "Vision-language", "IMAGE": "Image generation",
    "VIDEO": "Video", "AUDIO": "Speech-to-text", "TEXT_TO_SPEECH": "Text-to-speech",
    "EMBEDDING": "Embeddings", "CNN": "Vision (CNN)",
}
_MODEL_GROUP_ORDER = ["LLM", "VLM", "IMAGE", "VIDEO", "AUDIO", "TEXT_TO_SPEECH", "EMBEDDING", "CNN"]


def _prompt_for_model():
    """Interactively choose a model when `run` is invoked without one. Filters to
    the detected board (via tt-smi, when available) to keep the list short, groups
    by model type, and accepts a number or a name. Falls back to free-text entry
    when the catalog isn't synced yet (the live resolve check vets it post-startup)."""
    models = _catalog_models()
    if not models:
        return typer.prompt("Model to deploy").strip()

    board = _detect_board()
    shown = models
    if board:
        compatible = [m for m in models if board in m["boards"]]
        if compatible:
            shown = compatible
            console.print(f"[muted]Filtered to models compatible with your board ({board}).[/muted]")

    groups = {}
    for m in shown:
        groups.setdefault(m["group"], []).append(m["name"])
    ordered_groups = [g for g in _MODEL_GROUP_ORDER if g in groups] + \
        sorted(g for g in groups if g not in _MODEL_GROUP_ORDER)

    console.print("[info]Available models:[/info]")
    ordered_names = []
    for g in ordered_groups:
        console.print(f"\n[bold]{_MODEL_GROUP_LABELS.get(g, g.title())}[/bold]")
        for name in sorted(groups[g]):
            ordered_names.append(name)
            console.print(f"  [bold]{len(ordered_names):>2}[/bold]  {name}")

    choice = typer.prompt("\nSelect a model (number or name)").strip()
    if choice.isdigit():
        idx = int(choice)
        if not 1 <= idx <= len(ordered_names):
            raise typer.BadParameter(f"choice {idx} is out of range 1-{len(ordered_names)}")
        return ordered_names[idx - 1]
    return choice  # a name — _validate_model_name vets it next


def _validate_model_name(model):
    """Best-effort pre-startup catalog check so a typo fails fast instead of
    after the ~2-min stack-up. Silently skips when the catalog isn't fetched yet
    (first run) — resolve_model_id does the authoritative check post-startup.
    """
    names = _catalog_model_names()
    if not names:
        return  # catalog not synced yet — let the live check handle it
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
        console.print(f"[muted]Available: {', '.join(names)}[/muted]")
    raise typer.Exit(1)


def _validate_device_id(value: Optional[str]) -> Optional[str]:
    """Typer callback for `--device-id`. Accepts a single chip slot ("0") or a
    comma-separated list ("0,1") for multi-chip models. Validates format only
    (comma-separated non-negative integers) and returns the normalized string;
    the backend serializer owns the authoritative hardware range check.
    """
    if value is None:
        return None
    parts = [p.strip() for p in value.split(",")]
    if not all(p.isdigit() for p in parts):
        raise typer.BadParameter(
            f"'{value}' must be a chip slot like '0', or a comma-separated list "
            "like '0,1' for multi-chip models."
        )
    return ",".join(parts)


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
    reconfigure_inference_server: bool = typer.Option(False, "--reconfigure-inference-server", "--reconfig-inf", help="Reconfigure the TT Inference Server artifact (short alias: --reconfig-inf).", rich_help_panel="Setup & Configuration"),
    configure_env: bool = typer.Option(False, "--configure-env", help="Interactively configure all environment variables.", rich_help_panel="Setup & Configuration"),
    accept_terms: bool = typer.Option(False, "--accept-terms", help="Accept the OS Model Terms non-interactively (for CI/automation).", rich_help_panel="Setup & Configuration"),
    install_shortcut: bool = typer.Option(False, "--install-shortcut", help="Add a `tt-studio` shell shortcut so you can skip typing `python run.py`.", rich_help_panel="Setup & Configuration"),
    switch: str = typer.Option(None, "--switch", metavar="REF", help="Switch this checkout to a git branch or tag (e.g. dev, v2.9.0-rc1), then exit; re-run to start.", rich_help_panel="Setup & Configuration"),
    # ── Model Deployment ─────────────────────────────────────────────────────
    auto_deploy: str = typer.Option(None, "--auto-deploy", "--model", metavar="MODEL_NAME", help="Auto-deploy the given model after startup (via the web UI by default; add --headless for a terminal-driven deploy). Or use the `run <model>` subcommand.", rich_help_panel="Model Deployment", autocompletion=_complete_model),
    device_id: Optional[str] = typer.Option(None, "--device-id", metavar="CHIP_IDS", help="Chip slot(s) for the deploy, e.g. `0` or `0,1` for multi-chip models. Omit to let the backend allocate based on the model.", rich_help_panel="Model Deployment", callback=_validate_device_id),
    headless: bool = typer.Option(False, "--headless", help="Deploy via the terminal (backend API) instead of the web UI.", rich_help_panel="Model Deployment"),
    # ── Lifecycle ────────────────────────────────────────────────────────────
    stop: bool = typer.Option(False, "--stop", help="Stop TT Studio: tear down Docker containers and networks.", rich_help_panel="Lifecycle"),
    status: bool = typer.Option(False, "--status", help="Open the live monitor TUI for a running stack.", rich_help_panel="Lifecycle"),
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
    # A subcommand (e.g. `run`) was invoked — its handler owns the flow. Without
    # this guard the callback would also run the full default setup.
    if ctx.invoked_subcommand is not None:
        return

    set_verbose(verbose or no_clear)   # --no-clear shows full step detail too
    set_no_clear(no_clear)

    # --cleanup/--cleanup-all are deprecated aliases for --stop/--purge-all.
    # Warn, then normalize all four onto the internal cleanup/cleanup_all flags.
    if cleanup or cleanup_all:
        legacy = "--cleanup-all" if cleanup_all else "--cleanup"
        replacement = "--purge-all" if cleanup_all else "--stop"
        console.print(f"[warning]⚠  {legacy} is deprecated; use {replacement} instead.[/warning]")
    # --uninstall is the full purge plus shell-shortcut removal.
    full_teardown = purge_all or cleanup_all or uninstall
    stop_requested = stop or cleanup or full_teardown

    if auto_deploy:
        _validate_model_name(auto_deploy)

    args = _build_args(
        dev=dev, cleanup=stop_requested, cleanup_all=full_teardown, yes=yes, help_env=help_env,
        reconfigure=reconfigure, reconfigure_inference_server=reconfigure_inference_server,
        resync=resync, pull_branch=pull_branch, build_images=build_images, skip_fastapi=skip_fastapi,
        skip_docker_control=skip_docker_control, no_sudo=no_sudo, no_browser=no_browser,
        wait_for_services=wait_for_services, browser_timeout=browser_timeout,
        add_headers=add_headers, check_headers=check_headers, auto_deploy=auto_deploy,
        device_id=device_id, headless=headless, fix_docker=fix_docker,
        configure_env=configure_env, status=status, logs=logs, info=info,
        report_bug=report_bug, install_shortcut=install_shortcut,
        accept_terms=accept_terms, switch=switch, uninstall=uninstall,
        purge_model=list(purge_model or []),
    )
    _run(args)


@app.command("run")
def run_model_command(
    model: Optional[str] = typer.Argument(None, metavar="MODEL_NAME", help="Model to deploy, e.g. Qwen3-32B. Omit to pick from the catalog interactively.", autocompletion=_complete_model),
    device_id: Optional[str] = typer.Option(None, "--device-id", metavar="CHIP_IDS", help="Chip slot(s), e.g. `0` or `0,1` for multi-chip models. Omit to let the backend allocate based on the model.", callback=_validate_device_id),
    headless: bool = typer.Option(False, "--headless", help="Deploy via the terminal (backend API) instead of the web UI."),
    dev: bool = typer.Option(False, "--dev", help="Development mode (hot-reload)."),
    no_browser: bool = typer.Option(False, "--no-browser", help="Skip opening the browser."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show full per-phase output instead of the calm summary."),
):
    """Launch TT Studio and deploy a model in one command.

    Brings the whole stack up and deploys the model. By default the deploy runs
    through the web UI (the browser opens and drives it); pass --headless to
    deploy against the backend API from the terminal instead, with the browser
    opening at /models-deployed only so you can watch. Omit MODEL_NAME to choose
    from the synced catalog interactively.
    """
    set_verbose(verbose)
    if model is None:
        model = _prompt_for_model()
    _validate_model_name(model)
    args = _build_args(
        dev=dev, auto_deploy=model, device_id=device_id,
        headless=headless, no_browser=no_browser,
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

