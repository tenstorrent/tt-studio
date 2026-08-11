# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""--purge-model orchestration: uninstall everything belonging to one or more
named models (weights dirs, docker volume, env file, containers, and the image
when no kept model shares it), or pick interactively when run bare."""

import difflib
import json
import os
import re
import sys
from rich.table import Table
from tt_setup.constants import *
from tt_setup.constants import _CLEANUP_VOLUME_PREFIX, _PURGE_MODEL_PICKER
from tt_setup.console import ask, console, notice_panel, step
from tt_setup.docker import check_docker_access
from tt_setup.env_config import get_env_var
from tt_setup.cleanup._confirm import _confirm_purge
from tt_setup.cleanup._resource_ops import (
    _containers_using_volume,
    _docker_daemon_status,
    _docker_object_sizes,
    _docker_volume_mountpoints,
    _docker_volume_names,
    _format_bytes,
    _image_present,
    _path_size,
    _remove_docker_containers,
    _remove_docker_volumes,
    _remove_image_ref,
    _remove_path,
    _running_container_names,
    _write_file_with_docker,
)


# --- pure helpers (no docker, no console beyond warnings) --------------------

def _model_catalog_path():
    return os.path.join(TT_STUDIO_ROOT, "app", "backend", "shared_config",
                        "models_from_inference_server.json")


def _load_catalog(catalog_path):
    """Model entries from the synced catalog JSON; [] if missing/corrupt."""
    try:
        with open(catalog_path) as f:
            data = json.load(f)
        return [m for m in (data.get("models") or []) if m.get("model_name")]
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"{C_YELLOW}⚠️  Could not read model catalog ({catalog_path}): {e}{C_RESET}")
        return []


def _hf_home():
    """Host Hugging Face cache root, mirroring tt-inference-server's
    defaulting: HOST_HF_HOME → HF_HOME → ~/.cache/huggingface."""
    return get_env_var("HOST_HF_HOME") or get_env_var("HF_HOME") or \
        os.path.join(os.path.expanduser("~"), ".cache", "huggingface")


def _hf_cache_dirs_for_repo(hf_home, repo_id):
    """Existing host HF-cache dirs belonging to one repo id, across the hub/
    and legacy layouts plus the hub .locks entry. Weights for forge/vLLM
    models are downloaded here (often tens/hundreds of GB), NOT under the
    persistent volume. [] for non-namespaced ids ("vit", "resnet-50", …) —
    those are built-in model names, not HF repos, and have no cache dir."""
    if not hf_home or not repo_id or "/" not in repo_id:
        return []
    leaf = "models--" + repo_id.strip().replace("/", "--")
    candidates = [
        os.path.join(hf_home, "hub", leaf),
        os.path.join(hf_home, leaf),  # legacy pre-hub cache layout
        os.path.join(hf_home, "hub", ".locks", leaf),
    ]
    return [p for p in candidates if os.path.exists(p)]


def _hf_cache_kept_by(model, selected_names, installed):
    """Kept (installed, not-being-purged) model names that share `model`'s
    hf_model_id — its HF cache dir must then survive the purge, mirroring the
    docker-image reference counting."""
    repo = (model.get("hf_model_id") or "").casefold()
    if not repo:
        return []
    return sorted(o["name"] for o in installed
                  if o["name"] not in selected_names
                  and (o.get("hf_model_id") or "").casefold() == repo)


def _display_path(path):
    """Repo-relative for paths inside the repo, ~-abbreviated for paths in the
    user's home (the HF cache), absolute otherwise."""
    p = os.path.abspath(path)
    root = TT_STUDIO_ROOT.rstrip(os.sep)
    if p == root or p.startswith(root + os.sep):
        return os.path.relpath(p, TT_STUDIO_ROOT)
    home = os.path.expanduser("~").rstrip(os.sep)
    if p == home or p.startswith(home + os.sep):
        return "~" + p[len(home):]
    return p


def _dir_matches_model(name, model_name):
    """Whether a `volume_id_*` name (host weights dir OR docker named volume)
    belongs to `model_name`. Both follow `volume_id_{impl_id}-{model}[-v{ver}]`
    with a varying impl_id, so match on the model segment — never plain
    substring, or model `X` would claim `X-FP8`'s volume. Also accepts legacy
    glued ids like `volume_id_yolov4v0.0.1`."""
    if not name.startswith(_CLEANUP_VOLUME_PREFIX):
        return False
    rest = name[len(_CLEANUP_VOLUME_PREFIX):].casefold()
    m = model_name.casefold()
    if rest.endswith("-" + m) or ("-" + m + "-v") in rest:
        return True
    if rest.startswith(m):
        tail = rest[len(m):]
        return not tail or bool(re.match(r"^-?v?\d", tail))
    return False


def _resolve_model_names(requested, known_names):
    """Map user-supplied names onto catalog/orphan names.

    Accepts comma-separated tokens; matches exact → case-insensitive → unique
    substring. Returns (resolved, errors): resolved is ordered, de-duplicated
    (requested, matched) pairs; errors is (requested, suggestions) pairs."""
    resolved, errors, seen = [], [], set()
    for token in requested:
        for name in (n.strip() for n in token.split(",")):
            if not name or name == _PURGE_MODEL_PICKER:
                continue
            match = _match_model_name(name, known_names)
            if match is None:
                errors.append((name, _suggestions_for(name, known_names)))
            elif match not in seen:
                seen.add(match)
                resolved.append((name, match))
    return resolved, errors


def _match_model_name(name, known_names):
    if name in known_names:
        return name
    folded = name.casefold()
    ci = [k for k in known_names if k.casefold() == folded]
    if len(ci) == 1:
        return ci[0]
    sub = [k for k in known_names if folded in k.casefold()]
    if len(sub) == 1:
        return sub[0]
    return None


def _suggestions_for(name, known_names, limit=3):
    folded = name.casefold()
    contains = [k for k in known_names if folded in k.casefold()]
    if contains:
        return contains[:limit]
    return difflib.get_close_matches(name, list(known_names), n=limit, cutoff=0.5)


def _deployments_for_model(deployments_path, model_name):
    """Deployment records for a model from backend_volume/deployments.json —
    the only host-readable mapping from model name to container, since model
    containers are named `tt-inference-server-<uuid>`. [] if missing/corrupt."""
    try:
        with open(deployments_path) as f:
            records = json.load(f).get("records") or []
    except Exception:
        return []
    folded = model_name.casefold()
    return [r for r in records
            if isinstance(r, dict) and (r.get("model_name") or "").casefold() == folded]


def _partition_images(catalog, purge_names, installed_names):
    """Reference-count images before removal: an image tag is removable only
    when every INSTALLED model using it is being purged (uninstalled catalog
    entries don't pin an image). Returns (removable_tags,
    {tag: sorted kept-model names}) for tags the purge touches."""
    purge = {n.casefold() for n in purge_names}
    installed = {n.casefold() for n in installed_names}
    refs = {}
    for m in catalog:
        name = m["model_name"]
        image = m.get("docker_image")
        if not image or name.casefold() not in installed:
            continue
        slot = refs.setdefault(image, {"purged": set(), "kept": set()})
        slot["purged" if name.casefold() in purge else "kept"].add(name)
    removable = sorted(t for t, s in refs.items() if s["purged"] and not s["kept"])
    shared = {t: sorted(s["kept"]) for t, s in refs.items() if s["purged"] and s["kept"]}
    return removable, shared


def _parse_picker_selection(raw, count):
    """Parse picker input like "1 3", "2,4", or "all" into sorted unique
    1-based indexes; None on anything invalid or out of range."""
    raw = (raw or "").strip().lower()
    if not raw:
        return None
    if raw == "all":
        return list(range(1, count + 1))
    indexes = []
    for token in re.split(r"[\s,]+", raw):
        if not token.isdigit():
            return None
        i = int(token)
        if not 1 <= i <= count:
            return None
        if i not in indexes:
            indexes.append(i)
    return sorted(indexes)


def _installed_models(persistent_volume, catalog, deployments_path,
                      docker_volumes=(), live_containers=None, hf_home=None):
    """Discover models with something to remove. Returns ordered entries:
    {name, weight_dirs, hf_cache_dirs, hf_model_id, env_file, volumes,
    deployments, running, image, orphan}.
    Catalog models come first; leftover `volume_id_*` dirs/volumes matching no
    catalog model are appended as orphans (purgeable under their raw name).

    `live_containers` is the list of actually-running container names, or None
    when docker couldn't be queried. When it IS available, a deployment
    record's `status: "running"` alone is not trusted — a record whose write-
    back failed after a purge would otherwise resurrect the model as
    "deployed" forever."""
    try:
        disk_entries = sorted(
            e for e in os.listdir(persistent_volume)
            if e.startswith(_CLEANUP_VOLUME_PREFIX)
            and os.path.isdir(os.path.join(persistent_volume, e))
        )
    except OSError:
        disk_entries = []
    verified = live_containers is not None
    live = set(live_containers or ())
    claimed_dirs, claimed_vols = set(), set()
    models = []
    for entry in catalog:
        name = entry["model_name"]
        weight_dirs = [os.path.join(persistent_volume, d)
                       for d in disk_entries if _dir_matches_model(d, name)]
        hf_model_id = entry.get("hf_model_id")
        hf_cache_dirs = _hf_cache_dirs_for_repo(hf_home, hf_model_id)
        volumes = [v for v in docker_volumes if _dir_matches_model(v, name)]
        env_file = os.path.join(persistent_volume, "model_envs", f"{name}.env")
        if not os.path.isfile(env_file):
            env_file = None
        deployments = _deployments_for_model(deployments_path, name)
        running = [r for r in deployments
                   if r.get("container_name") in live
                   or (not verified and r.get("status") == "running")]
        if not (weight_dirs or hf_cache_dirs or volumes or env_file or running):
            continue
        claimed_dirs.update(os.path.basename(d) for d in weight_dirs)
        claimed_vols.update(volumes)
        models.append({
            "name": name, "weight_dirs": weight_dirs,
            "hf_cache_dirs": hf_cache_dirs, "hf_model_id": hf_model_id,
            "env_file": env_file,
            "volumes": volumes, "deployments": deployments, "running": running,
            "image": entry.get("docker_image"), "orphan": False,
        })
    for entry in disk_entries:
        if entry in claimed_dirs:
            continue
        volumes = [v for v in docker_volumes if v == entry and v not in claimed_vols]
        claimed_vols.update(volumes)
        models.append({
            "name": entry, "weight_dirs": [os.path.join(persistent_volume, entry)],
            "hf_cache_dirs": [], "hf_model_id": None,
            "env_file": None, "volumes": volumes, "deployments": [], "running": [],
            "image": None, "orphan": True,
        })
    for vol in docker_volumes:
        if vol in claimed_vols:
            continue
        models.append({
            "name": vol, "weight_dirs": [], "hf_cache_dirs": [],
            "hf_model_id": None, "env_file": None, "volumes": [vol],
            "deployments": [], "running": [], "image": None, "orphan": True,
        })
    return models


def _mark_deployments_stopped(deployments_path, model_names):
    """Flip records of purged models to stopped so the backend doesn't list
    ghosts. Atomic tmp+replace like the backend's own writer; a concurrent
    backend write can lose this one update, which is acceptable — the
    container itself is already gone. The store is usually owned by the
    backend container's user, so on PermissionError fall back to writing via
    an ephemeral root container (same pattern as _remove_path)."""
    from datetime import datetime, timezone
    folded = {n.casefold() for n in model_names}
    try:
        with open(deployments_path) as f:
            data = json.load(f)
        changed = False
        for record in data.get("records") or []:
            if not isinstance(record, dict):
                continue
            if (record.get("model_name") or "").casefold() in folded \
                    and record.get("status") == "running":
                record["status"] = "stopped"
                record["stopped_at"] = datetime.now(timezone.utc).isoformat()
                record["stopped_by_user"] = True
                changed = True
        if not changed:
            return True
        payload = json.dumps(data, indent=2, default=str)
        try:
            tmp = deployments_path + ".tmp"
            with open(tmp, "w") as f:
                f.write(payload)
            os.replace(tmp, deployments_path)
            return True
        except PermissionError:
            return _write_file_with_docker(deployments_path, payload)
    except FileNotFoundError:
        return True
    except Exception:
        return False


# --- user-facing flow ---------------------------------------------------------

def _inventory_table():
    t = Table(box=None, show_header=False, padding=(0, 2), pad_edge=False)
    t.add_column(no_wrap=True)                                  # icon
    t.add_column(overflow="fold")                               # name
    t.add_column(justify="right", no_wrap=True, style="muted")  # size
    t.add_column(style="muted", overflow="fold")                # description
    return t


def _model_storage_locations(m):
    """Short human list of WHERE a model's data lives right now: host weight
    dirs, its HF cache dir, and docker volume names. Lock stubs are elided."""
    where = [_display_path(d) for d in m.get("weight_dirs", ())]
    where += [_display_path(d) for d in m.get("hf_cache_dirs", ())
              if ".locks" not in d.split(os.sep)]
    where += [f"docker volume {v}" for v in m.get("volumes", ())]
    return where


def _pick_models_interactively(installed, volume_sizes=None):
    """Numbered multi-select over the installed models. Returns the chosen
    entries, or None when the user cancels (empty input / q / Ctrl-C)."""
    volume_sizes = volume_sizes or {}
    console.print("\n[bold]Installed models[/bold]")
    listing = _inventory_table()
    for i, m in enumerate(installed, start=1):
        size = sum(_path_size(d)
                   for d in m["weight_dirs"] + m.get("hf_cache_dirs", []))
        size += sum(volume_sizes.get(v, 0) for v in m.get("volumes", ()))
        tags = []
        if m["running"]:
            tags.append("[accent]deployed[/accent]")
        if m["orphan"]:
            tags.append("leftover files (not in catalog)")
        tags += _model_storage_locations(m)
        listing.add_row(f"{i}.", m["name"],
                        _format_bytes(size) if size > 0 else "—",
                        " · ".join(tags))
    console.print(listing)
    while True:
        try:
            raw = ask("Models to purge (e.g. '1 3', or 'all'; Enter to cancel)", default="")
        except (KeyboardInterrupt, EOFError):
            raw = ""
        raw = (raw or "").strip()
        if raw.lower() in ("", "q", "quit", "n", "no"):
            console.print("\n[info]🛑 Aborted — nothing was deleted.[/info]")
            return None
        selection = _parse_picker_selection(raw, len(installed))
        if selection:
            return [installed[i - 1] for i in selection]
        console.print(f"[muted]Enter numbers between 1 and {len(installed)} "
                      f"(space/comma separated), or 'all'.[/muted]")


def purge_models(args):
    """Entry point for --purge-model. Returns an exit code: 0 on success or a
    clean user abort, 1 when a requested model can't be resolved (nothing is
    touched in that case), the bare picker has no terminal to run on, or some
    of the selected artifacts could not actually be removed."""
    requested = list(getattr(args, "purge_model", None) or [])
    picker_requested = all(t == _PURGE_MODEL_PICKER for t in requested)

    persistent_volume = get_env_var("HOST_PERSISTENT_STORAGE_VOLUME") or \
        os.path.join(TT_STUDIO_ROOT, "tt_studio_persistent_volume")
    deployments_path = os.path.join(persistent_volume, "backend_volume", "deployments.json")
    catalog = _load_catalog(_model_catalog_path())

    has_docker_access = check_docker_access()
    daemon = _docker_daemon_status()
    docker_usable = daemon in ("ok", "sudo")
    docker_volumes = _docker_volume_names(has_docker_access) if docker_usable else []
    # None (not []) when docker can't be queried: discovery then falls back to
    # trusting deployment records instead of treating "unknown" as "not running".
    live_containers = _running_container_names(has_docker_access) if docker_usable else None

    installed = _installed_models(persistent_volume, catalog, deployments_path,
                                  docker_volumes, live_containers, _hf_home())
    # Fetched before the picker so its size column can include docker volumes
    # (the daemon computes those; _path_size can't see inside a volume).
    volume_sizes, image_sizes = (
        _docker_object_sizes(has_docker_access) if docker_usable else ({}, {})
    )

    # --- choose what to purge ---
    if picker_requested:
        if not installed:
            hint = (" (Docker is not running, so docker volumes could not be checked)"
                    if not docker_usable else "")
            console.print(f"\n[info]No models installed{hint} — nothing to purge.[/info]")
            return 0
        if not sys.stdin.isatty():
            console.print()
            console.print(notice_panel(
                "[bold]--purge-model needs a terminal for its picker[/bold]",
                ["No model names were given and stdin is not interactive.",
                 "Pass names directly:  [accent]python run.py --purge-model MODEL[/accent]"],
                border_style="error",
            ))
            return 1
        selected = _pick_models_interactively(installed, volume_sizes)
        if selected is None:
            return 0
    else:
        known = [m["name"] for m in installed] + \
            [m["model_name"] for m in catalog
             if m["model_name"] not in {i["name"] for i in installed}]
        resolved, errors = _resolve_model_names(requested, known)
        if errors:
            lines = []
            for name, suggestions in errors:
                hint = f" — did you mean: {', '.join(suggestions)}?" if suggestions else ""
                lines.append(f"Unknown model [bold]{name}[/bold]{hint}")
            lines.append("Run bare [accent]python run.py --purge-model[/accent] "
                         "to pick from installed models.")
            console.print()
            console.print(notice_panel("[bold]Model not found[/bold]", lines,
                                       border_style="error"))
            return 1
        by_name = {m["name"]: m for m in installed}
        selected = []
        for requested_name, matched in resolved:
            if requested_name != matched:
                console.print(f"[muted]{requested_name} → {matched}[/muted]")
            if matched in by_name:
                selected.append(by_name[matched])
            else:
                hint = (" on disk — Docker is not running, so its docker volumes "
                        "could not be checked" if not docker_usable else "")
                console.print(f"[info]{matched}: nothing installed{hint} — skipping.[/info]")
        if not selected:
            console.print("\n[info]Nothing to remove.[/info]")
            return 0

    # --- inventory ---
    volume_mounts = _docker_volume_mountpoints(
        [v for m in selected for v in m["volumes"]],
        has_docker_access) if docker_usable else {}
    purge_names = [m["name"] for m in selected]
    installed_names = [m["name"] for m in installed]
    removable_images, shared_images = _partition_images(
        catalog, purge_names, installed_names)
    # The catalog's docker_image may never have been pulled (or was already
    # removed) — only images actually on disk belong in the inventory, or the
    # run would promise bytes and then "remove" 0 images.
    if docker_usable:
        removable_images = [i for i in removable_images
                            if _image_present(i, has_docker_access)]
    # Same reference-counting story for the HF cache: models can share a repo,
    # so a purged model's cache dir survives while a kept model still needs it.
    selected_names = set(purge_names)
    hf_kept = {m["name"]: _hf_cache_kept_by(m, selected_names, installed)
               for m in selected}

    console.print()
    console.print(notice_panel(
        f"[bold]⚠  --purge-model · remove {len(selected)} model(s)[/bold]",
        ["Deletes the listed weights, volumes, and configs for these models only.",
         "[bold]Everything below is permanently deleted — this cannot be undone.[/bold]"],
        border_style="error",
    ))

    total_bytes = 0
    path_sizes = {}  # host path → bytes, to keep the reclaim total honest on failures
    for m in selected:
        console.print(f"\n[bold]{m['name']}[/bold]")
        table = _inventory_table()
        rows = 0
        for d in m["weight_dirs"]:
            size = path_sizes[d] = _path_size(d)
            total_bytes += size
            table.add_row("📁", _display_path(d),
                          _format_bytes(size) if size > 0 else "—", "model weights")
            rows += 1
        kept_by = hf_kept.get(m["name"]) or []
        for d in m.get("hf_cache_dirs", []):
            if ".locks" in d.split(os.sep):
                continue  # lock stubs — removed/kept silently with the cache
            if kept_by:
                table.add_row("📁", _display_path(d), "",
                              f"Hugging Face cache kept — shared with {', '.join(kept_by)}")
            else:
                size = path_sizes[d] = _path_size(d)
                total_bytes += size
                table.add_row("📁", _display_path(d),
                              _format_bytes(size) if size > 0 else "—",
                              "Hugging Face weights cache")
            rows += 1
        if m["env_file"]:
            size = path_sizes[m["env_file"]] = _path_size(m["env_file"])
            total_bytes += size
            table.add_row("⚙️ ", _display_path(m["env_file"]),
                          "—", "model env file")
            rows += 1
        for v in m["volumes"]:
            size = volume_sizes.get(v, 0)
            total_bytes += size
            where = volume_mounts.get(v)
            table.add_row("💾", v, f"~{_format_bytes(size)}" if size > 0 else "",
                          "docker model-weight volume"
                          + (f" · {where}" if where else ""))
            rows += 1
        for r in m["running"]:
            table.add_row("🐳", r.get("container_name") or r.get("container_id", "?"),
                          "", "running — will be stopped")
            rows += 1
        if not docker_usable:
            # Volumes can't even be listed without the daemon, so m["volumes"]
            # being empty means "unknown", not "none".
            table.add_row("🐳", "docker volumes", "",
                          "not checked — Docker is not running")
            rows += 1
        image = m["image"]
        if image:
            if image in removable_images:
                size = image_sizes.get(image, 0)
                table.add_row("🐳", image,
                              f"~{_format_bytes(size)}" if size > 0 else "", "image")
                rows += 1
            elif image in shared_images:
                kept = ", ".join(shared_images[image])
                table.add_row("🐳", image, "",
                              f"image kept — shared with {kept}")
                rows += 1
        if rows:
            console.print(table)
        else:
            console.print("  [muted]none found[/muted]")
    total_bytes += sum(image_sizes.get(i, 0) for i in removable_images)

    if total_bytes > 0:
        console.print(f"\n[bold]Reclaims ≈ {_format_bytes(total_bytes)}[/bold] "
                      f"[error]· cannot be undone[/error]")
    else:
        console.print("\n[error]This cannot be undone.[/error]")

    if not _confirm_purge(getattr(args, "yes", False),
                          f"Remove {len(selected)} model(s)?"):
        return 0

    # --- removal: container → volume → host dirs → env file, then images ---
    console.print(f"\n[bold]🧹 Removing {len(selected)} model(s)[/bold]")
    docker_spinner = has_docker_access
    no_sudo = bool(getattr(args, "no_sudo", False))
    volumes_in_use = []
    failed_paths = []
    failed_bytes = 0
    for m in selected:
        name = m["name"]
        containers = list(dict.fromkeys(
            (r.get("container_name") or r.get("container_id"))
            for r in m["running"]))
        with step(f"Stopping {name} container", spinner=docker_spinner) as s:
            if not containers:
                s.skip("not deployed")
            elif not docker_usable:
                s.skip("Docker not running")
            else:
                removed = _remove_docker_containers(containers, has_docker_access)
                s.detail(f"{removed} container(s)")

        with step(f"Removing {name} model volume", spinner=docker_spinner) as s:
            if not docker_usable:
                # Without the daemon we could not even list volumes — say so
                # instead of claiming there were none.
                s.skip("not checked — Docker is not running")
            elif not m["volumes"]:
                s.skip("none found")
            else:
                removed, in_use = _remove_docker_volumes(m["volumes"], has_docker_access)
                if in_use:
                    volumes_in_use.extend(in_use)
                    s.fail()
                    s.detail("in use by a container that could not be removed")
                else:
                    s.detail(f"{len(removed)} volume(s)")

        with step(f"Removing {name} weights", spinner=False) as s:
            targets = list(m["weight_dirs"])
            if not hf_kept.get(name):
                targets += m.get("hf_cache_dirs", [])
            if not targets:
                s.skip("none found")
            else:
                failed = [d for d in targets
                          if not _remove_path(d, no_sudo=no_sudo)]
                if failed:
                    # fail() also surfaces _remove_path's captured warnings,
                    # which otherwise only land in startup.log.
                    failed_paths.extend(failed)
                    failed_bytes += sum(path_sizes.get(d, 0) for d in failed)
                    s.fail()
                s.detail(f"{len(targets) - len(failed)}/{len(targets)} path(s)")

        with step(f"Removing {name} env file", spinner=False) as s:
            if not m["env_file"]:
                s.skip("none found")
            elif not _remove_path(m["env_file"], no_sudo=no_sudo):
                failed_paths.append(m["env_file"])
                failed_bytes += path_sizes.get(m["env_file"], 0)
                s.fail()

    with step("Removing unreferenced images", spinner=docker_spinner) as s:
        if not docker_usable:
            s.skip("not checked — Docker is not running")
        elif not removable_images:
            s.skip("all images shared" if shared_images else "none found")
        else:
            missed = [i for i in removable_images
                      if not _remove_image_ref(i, has_docker_access)]
            failed_bytes += sum(image_sizes.get(i, 0) for i in missed)
            s.detail(f"{len(removable_images) - len(missed)} image(s)")

    records_failed = False
    with step("Updating deployment records", spinner=False) as s:
        if not docker_usable:
            # We didn't stop anything, so don't rewrite history: a record
            # marked stopped here could strand a container still running.
            s.skip("not checked — Docker is not running")
        elif not _mark_deployments_stopped(deployments_path, purge_names):
            records_failed = True
            s.fail()
            s.detail("could not write deployments.json")

    # Don't claim bytes we failed to free — a volume still in use or an
    # undeletable weights dir stays on disk.
    reclaimed_bytes = total_bytes - failed_bytes - \
        sum(volume_sizes.get(v, 0) for v in volumes_in_use)
    problems = bool(failed_paths or volumes_in_use or records_failed)
    if problems:
        console.print("\n[bold warning]⚠  Cleanup finished with issues[/bold warning]")
    else:
        console.print("\n[bold success]✓ Cleanup complete[/bold success]")
    if reclaimed_bytes > 0:
        console.print(f"   Reclaimed approximately [bold]{_format_bytes(reclaimed_bytes)}[/bold] from disk.")
    for image, kept in sorted(shared_images.items()):
        console.print(f"   [muted]{image} kept — still used by {', '.join(kept)}[/muted]")
    for m in selected:
        kept_by = hf_kept.get(m["name"])
        if kept_by and m.get("hf_cache_dirs"):
            console.print(f"   [muted]{m['name']} Hugging Face cache kept — "
                          f"still used by {', '.join(kept_by)}[/muted]")
    if not docker_usable:
        console.print("   [warning]⚠  Docker is not running — this model's docker volumes "
                      "were not checked or removed. Start Docker and re-run to "
                      "reclaim them.[/warning]")
    for vol in volumes_in_use:
        holders = _containers_using_volume(vol, has_docker_access)
        hint = (f"remove its container(s) with [accent]docker rm -f {' '.join(holders)}[/accent]"
                if holders else
                f"check [accent]docker ps -a --filter volume={vol}[/accent]")
        console.print(f"   [warning]⚠  {vol} was not removed (still in use) — "
                      f"{hint}, then re-run.[/warning]")
    for path in failed_paths:
        console.print(f"   [warning]⚠  Could not remove "
                      f"{_display_path(path)} — likely needs "
                      f"elevated permissions; remove it manually with "
                      f"[accent]sudo rm -rf[/accent].[/warning]")
    if records_failed:
        console.print(f"   [warning]⚠  Could not update {deployments_path} — "
                      f"the backend may still list the purged model(s) as "
                      f"deployed.[/warning]")
    return 1 if problems else 0
