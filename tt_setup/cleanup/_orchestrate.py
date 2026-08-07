# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""--stop / --purge-all orchestration: build the inventory, confirm, then run the
teardown and (for --purge-all) wipe persistent state."""

import os
from rich.table import Table
from tt_setup.constants import *
from tt_setup.constants import _CLEANUP_VOLUME_PREFIX
from tt_setup.console import console, kept_panel, notice_panel, step
from tt_setup.docker import check_docker_access
from tt_setup.env_config import get_env_var
from tt_setup.cleanup._runtime import _cleanup_runtime
from tt_setup.cleanup._resource_ops import (
    _container_pycache_dirs,
    _docker_reclaimable_bytes,
    _deployed_model_names,
    _docker_daemon_status,
    _format_bytes,
    _hf_cache_model_dirs,
    _path_size,
    _prune_anonymous_volumes,
    _remove_directory_contents,
    _remove_local_tt_studio_images,
    _remove_path,
    _remove_tt_studio_model_volumes,
    _write_browser_cleanup_sentinel,
)


def _print_preserved_summary(has_docker_access):
    """Panel summarising what a plain --stop leaves in place, with a clear
    next-step for wiping it — so users aren't left guessing what survived."""
    if _docker_daemon_status() in ("down", "missing"):
        models = "[muted]none (Docker not running)[/muted]"
    else:
        names = _deployed_model_names(has_docker_access)
        if names is None:
            models = "[muted]left running (not checked)[/muted]"
        elif not names:
            models = "[muted]none running[/muted]"
        else:
            more = "…" if len(names) > 1 else ""
            models = f"[accent]{len(names)} still running[/accent][muted] · {names[0]}{more}[/muted]"

    rows = [
        ("Model deployments", models),
        ("Config & secrets", ".env, saved settings (Welcome setup)"),
        ("Saved data", "model weights, chat history, RAG"),
    ]
    footer = ["[muted]Remove these too →[/muted]  [accent]python run.py --purge-all[/accent]"]
    console.print()
    console.print(kept_panel("[bold]Preserved[/bold]", rows, footer))


def cleanup_resources(args):
    """Clean up TT Studio Docker resources, and (with --purge-all) all persistent
    state. Returns True when the cleanup ran, False when the user aborted at the
    confirmation prompt (so callers like --uninstall can skip their follow-up)."""
    full_cleanup = bool(getattr(args, "cleanup_all", False))
    assume_yes = bool(getattr(args, "yes", False))

    if not full_cleanup:
        console.print("\n[bold accent]Stopping TT Studio[/bold accent]")
        has_access = check_docker_access()
        _cleanup_runtime(args, has_access)

        # user_config.env (saved secrets + the Welcome/SETUP_COMPLETE flag) is
        # left untouched: a plain --stop must not re-trigger first-run setup.
        # Only --purge-all resets it, by removing the persistent volume.
        _print_preserved_summary(has_access)
        return True

    # --- --purge-all: build full inventory and ask once ---
    host_persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or \
        os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
    artifacts_root = os.path.join(TT_STUDIO_ROOT, ".artifacts")

    # All host-side runtime logs + PID files now live under logs/, so the whole
    # directory is removed in one shot (it is always a proper subdir of the repo,
    # never the repo root itself). The repo-root entries that follow clear logs
    # left behind by TT Studio versions from before the logs/ consolidation +
    # rename — and the degenerate case where logs/ couldn't be created and the
    # files fell back to the repo root.
    logs_dir = os.path.join(TT_STUDIO_ROOT, "logs")
    log_items = [
        ("📜", logs_dir, "host-side logs & PID files"),
    ]
    log_items += [
        ("📜", os.path.join(TT_STUDIO_ROOT, name), "legacy host log")
        for name in (
            "model_run.log", "model_run_logs",
            "fastapi.log", "fastapi.pid", "fastapi_logs",
            "startup.log", "docker-control-service.log", "docker-control-service.pid",
        )
    ]

    items = [
        ("📁", host_persistent_volume,
         "HF token, deploy history, RAG DB, model weights"),
        ("⚙️ ", ENV_FILE_PATH,
         "config & secrets (Django key, tokens)"),
        ("⚙️ ", LEGACY_ENV_FILE_PATH, "legacy pre-consolidation env file (app/.env)"),
        ("⚙️ ", LEGACY_ENV_BACKUP_PATH, "legacy env backup from migration (app/.env-old)"),
        ("🔧", artifacts_root,
         "inference-server download + tarball"),
        *log_items,
        ("⚙️ ", TT_STUDIO_CONFIG_PATH, "consolidated config store"),
        # Legacy pre-consolidation files (issue #807); removed if an old install left them.
        ("⚙️ ", PREFS_FILE_PATH, "legacy CLI preferences"),
        ("⚙️ ", SETUP_CONFIG_FILE_PATH, "legacy quick-setup snapshot"),
        ("⚙️ ", LEGACY_SETUP_CONFIG_FILE_PATH, "legacy setup snapshot"),
        ("🎙️ ", os.path.join(TT_STUDIO_ROOT, "output.wav"), "TTS scratch"),
        ("🎙️ ", os.path.join(TT_STUDIO_ROOT, "speech.wav"), "STT scratch"),
        # Files the backend container wrote into the ./backend bind mount as
        # root in older installs (issue #1154). The DB now lives in the
        # persistent volume; these entries clear what previous versions left.
        ("🗄️ ", os.path.join(TT_STUDIO_ROOT, "app", "backend", "db.sqlite3"),
         "backend DB (legacy in-repo location)"),
        ("📁", os.path.join(TT_STUDIO_ROOT, "app", "backend", "temp"),
         "RAG upload scratch"),
        *[("🐍", p, "container bytecode cache") for p in _container_pycache_dirs()],
        ("🐍", os.path.join(INFERENCE_API_DIR, ".venv"),
         "inference-api virtualenv"),
        ("🐍", os.path.join(DOCKER_CONTROL_SERVICE_DIR, ".venv"),
         "docker-control virtualenv"),
        ("🐍", os.path.join(TT_STUDIO_ROOT, ".workflow_venvs"),
         "workflow virtualenvs"),
        # Kept last: the launcher itself runs from this venv, so it must be the
        # final path removed. bootstrap.py recreates it on the next run.
        ("🐍", os.path.join(TT_STUDIO_ROOT, ".tt_studio_run_venv"),
         "launcher virtualenv (recreated on next run)"),
    ]

    existing = [(emoji, path, desc, _path_size(path))
                for emoji, path, desc in items if os.path.exists(path) or os.path.islink(path)]
    host_bytes = sum(sz for _, _, _, sz in existing)

    # Measure the Docker objects we are about to remove while they still exist,
    # so both the estimate and the final "Reclaimed approximately X" reflect the
    # model volumes + images (tens of GB), not just the host-side files.
    has_docker_access = check_docker_access()
    docker_sizes = _docker_reclaimable_bytes(has_docker_access)

    # Weights TT Studio downloaded into the host HuggingFace cache (--host-hf-cache).
    # Scoped to catalog models so we don't touch the user's other cached models.
    hf_models = _hf_cache_model_dirs()
    hf_bytes = sum(size for _, _, size in hf_models)

    total_bytes = host_bytes + sum(docker_sizes.values()) + hf_bytes

    # --- Danger header ---
    danger_lines = [
        "Resets TT Studio to a fresh-clone state.",
        "[bold]Everything below is permanently deleted — this cannot be undone.[/bold]",
    ]
    if getattr(args, "uninstall", False):
        danger_lines.append("Also removes the `tt-studio` shell shortcut from your shell config.")
    console.print()
    console.print(notice_panel(
        "[bold]⚠  --purge-all · full reset[/bold]",
        danger_lines,
        border_style="error",
    ))

    def _table():
        t = Table(box=None, show_header=False, padding=(0, 2), pad_edge=False)
        t.add_column(no_wrap=True)                                       # icon
        t.add_column(no_wrap=True)                                       # name
        t.add_column(justify="right", no_wrap=True, style="muted")       # size
        t.add_column(style="muted", overflow="fold")                    # description
        return t

    # --- Files on disk ---
    console.print("\n[bold]Files on disk[/bold]")
    if existing:
        files = _table()
        for emoji, path, desc, size in existing:
            rel = os.path.relpath(path, TT_STUDIO_ROOT)
            files.add_row(emoji, rel, _format_bytes(size) if size > 0 else "—", desc)
        console.print(files)
    else:
        console.print("  [muted]none found[/muted]")

    # --- Docker objects ---
    def _dsize(key):
        return f"~{_format_bytes(docker_sizes[key])}" if docker_sizes[key] > 0 else ""

    console.print("\n[bold]Docker[/bold]")
    docker = _table()
    docker.add_row("🐳", "Deployment containers", "", "vLLM, YOLO, … on tt_studio_network")
    docker.add_row("💾", "Model-weight volumes", _dsize("model_volumes"), f"{_CLEANUP_VOLUME_PREFIX}*")
    docker.add_row("💾", "Anonymous volumes", _dsize("anon_volumes"), "dangling (dev node_modules, …)")
    docker.add_row("🐳", "Local images", _dsize("images"), "tt-studio, tt-inference-server, chroma")
    console.print(docker)

    # --- HuggingFace cache ---
    console.print("\n[bold]HuggingFace cache[/bold]")
    if hf_models:
        hf = _table()
        for repo_id, _path, size in hf_models:
            hf.add_row("🤗", repo_id, _format_bytes(size) if size > 0 else "—", "downloaded model weights")
        console.print(hf)
    else:
        console.print("  [muted]none found[/muted]")

    # --- Browser ---
    console.print("\n[bold]Browser[/bold]")
    console.print("  🌐 [muted]chat history, theme, login — cleared on next page load[/muted]")

    # --- Reclaim total + final warning ---
    if total_bytes > 0:
        console.print(f"\n[bold]Reclaims ≈ {_format_bytes(total_bytes)}[/bold] [error]· cannot be undone[/error]")
    else:
        console.print("\n[error]This cannot be undone.[/error]")

    if not assume_yes:
        while True:
            try:
                confirm = console.input("\n[warning]Proceed with full reset?[/warning] [muted](y/yes or n/no)[/muted] ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                console.print("\n[warning]🛑 Aborted — nothing was deleted.[/warning]")
                return False
            if confirm in ("y", "yes"):
                break
            if confirm in ("n", "no", ""):
                console.print("\n[info]🛑 Aborted — nothing was deleted.[/info]")
                return False
            console.print("[muted]Please answer y/yes or n/no.[/muted]")
    else:
        console.print("\n[muted]--yes passed; proceeding without prompt.[/muted]")

    console.print("\n[bold]🧹 Cleaning up TT Studio[/bold]")
    _cleanup_runtime(args, has_docker_access)

    # Sudo prompts for password when we lack Docker access — the live spinner
    # would clash with that prompt, so disable it in that case.
    docker_spinner = has_docker_access

    # Volumes must come before images: removing a volume while its image is
    # gone is fine; removing an image while a volume's container is gone is
    # also fine — but we want both done before the host-state wipe so the
    # final "Reclaimed approximately X" total is honest.
    with step("Removing model volumes", spinner=docker_spinner) as s:
        removed_vols = _remove_tt_studio_model_volumes(has_docker_access)
        s.detail(f"{removed_vols} volume(s)")

    with step("Pruning anonymous volumes", spinner=docker_spinner) as s:
        removed_anon = _prune_anonymous_volumes(has_docker_access)
        s.detail(f"{removed_anon} volume(s)")

    with step("Removing local images", spinner=docker_spinner) as s:
        removed = _remove_local_tt_studio_images(has_docker_access)
        s.detail(f"{removed} image(s)")

    with step("Removing HuggingFace cache models", spinner=False) as s:
        if not hf_models:
            s.skip()
        else:
            removed_hf = sum(
                1 for _repo, path, _size in hf_models
                if _remove_path(path, no_sudo=args.no_sudo)
            )
            s.detail(f"{removed_hf}/{len(hf_models)} model(s)")

    with step("Removing host state", spinner=False) as s:
        removed_paths = 0
        for _, path, _, _ in existing:
            if path == os.path.join(TT_STUDIO_ROOT, ".workflow_venvs"):
                removed = _remove_directory_contents(
                    path,
                    preserve_names={".venv_bootstrap_uv"},
                    no_sudo=args.no_sudo,
                )
            else:
                removed = _remove_path(path, no_sudo=args.no_sudo)
            if removed:
                removed_paths += 1
        s.detail(f"{removed_paths}/{len(existing)} path(s)")

    with step("Arming browser wipe", spinner=False) as s:
        token = _write_browser_cleanup_sentinel()
        if not token:
            s.skip()

    console.print("\n[bold success]✓ Cleanup complete[/bold success]")
    if total_bytes > 0:
        print(f"   Reclaimed approximately {C_BOLD}{_format_bytes(total_bytes)}{C_RESET} from disk.")
    print(f"\n{C_CYAN}🌐 Browser data (chat history, theme, login) will auto-clear the")
    print(f"   next time you open http://localhost:3000.")
    print(f"   To clear immediately: DevTools → Application → Storage → Clear site data.{C_RESET}")
    return True
