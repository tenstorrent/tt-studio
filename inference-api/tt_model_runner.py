# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Host-side bridge to tt-model-manager (``tt_kernel``), run under its own interpreter.

Why a subprocess instead of an import: inference-api pins ``pydantic<2`` (FastAPI
<0.69 requires it) while tt_kernel requires ``pydantic>=2``, so the two cannot share
a venv. This module therefore imports nothing from inference-api — stdlib plus
tt_kernel only — and is executed with the model-manager artifact's interpreter.

Why not tt_kernel's own CLI: it has no machine-readable output. Its library layer is
pure, so we drive that directly and emit our own NDJSON on stdout. tt_kernel's rich
console writes to stdout, so it is redirected to stderr for the whole run and can
never corrupt the stream.

Commands (all emit JSON objects, one per line, on stdout):
    catalog --arch A [--query Q] [--limit N]  community bundles for this arch
    inspect <repo_id>                         deployable metadata for one bundle
    serve   <repo_id> [options]               event stream for one deployment
    stop    <repo_id> [--profile P]           stop one running bundle
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional

# Engines this build of TT Studio can present as a chat model. tt_kernel may support
# more kinds than we have a UI for (an image/DiT launcher is expected), so an unknown
# kind is refused by name rather than deployed into a route that would 404.
SUPPORTED_KINDS = ("vllm-plugin", "vllm-fork")


def emit(event: str, **fields: Any) -> None:
    """Write one NDJSON event. Flushed so the reader sees progress live."""
    sys.stdout.write(json.dumps({"event": event, **fields}, default=str) + "\n")
    sys.stdout.flush()


@contextlib.contextmanager
def _quiet_tt_kernel():
    """Send tt_kernel's console output to stderr so stdout stays pure NDJSON."""
    with contextlib.redirect_stdout(sys.stderr):
        yield


# --------------------------------------------------------------------- metadata


def _parse_mesh(mesh_device: str) -> Optional[tuple]:
    """The (rows, cols) a mesh string denotes, via tt_kernel when it is importable.

    The local fallback keeps the pure helpers testable without the artifact installed
    and covers the two shapes bundles actually use: "(4, 1)" and "P150x4".
    """
    try:
        from tt_kernel.container_manifest import parse_mesh_device

        return parse_mesh_device(mesh_device)
    except Exception:
        pass
    grid = re.fullmatch(r"\(\s*(\d+)\s*,\s*(\d+)\s*\)", mesh_device.strip())
    if grid:
        return int(grid.group(1)), int(grid.group(2))
    label = re.fullmatch(r"[a-zA-Z]+\d+x(\d+)", mesh_device.strip())
    return (int(label.group(1)), 1) if label else None


def _chips_for(mesh_device: Optional[str], hardware: Optional[str]) -> int:
    r"""Chip count a profile occupies, agreeing with tt_kernel.

    The ``hardware`` label is asked first, via tt_kernel's own ``hardware_chip_count``:
    it is what ``tt-model serve`` sizes its device pin from, and a count that disagrees
    with it would be rejected outright ("--device-id gave N chip(s) but profile needs M").
    It also knows the per-board chip counts a multiplier cannot express -- "p300" and
    "n300" are two chips each, which the ``x(\d+)`` reading below scores as one.

    The mesh grid and the multiplier remain as fallbacks, so the helper stays correct
    for an unrecognised label and testable without the artifact installed.
    """
    try:
        from tt_kernel.container_manifest import hardware_chip_count

        count = hardware_chip_count(hardware or "")
        if count:
            return count
    except Exception:
        pass
    if mesh_device:
        grid = _parse_mesh(mesh_device)
        if grid and grid[0] and grid[1]:
            return max(1, grid[0] * grid[1])
    match = re.search(r"x(\d+)$", (hardware or "").lower())
    return int(match.group(1)) if match else 1


def _profile_summary(manifest, profile) -> Dict[str, Any]:
    caps = profile.capabilities
    return {
        "name": profile.name,
        "description": profile.description,
        "hardware": profile.hardware,
        "mesh_device": profile.mesh_device,
        "chips_required": _chips_for(profile.mesh_device, profile.hardware),
        "port": profile.port,
        "max_model_len": profile.max_model_len,
        "max_num_seqs": profile.max_num_seqs,
        "tool_parser": getattr(caps, "tool_parser", None) if caps else None,
        "reasoning_parser": getattr(caps, "reasoning_parser", None) if caps else None,
    }


def _describe(repo_id: str, manifest) -> Dict[str, Any]:
    """Everything TT Studio needs to build a model_impl and a deploy plan."""
    from tt_kernel import container

    spec = manifest.container
    profiles = [
        _profile_summary(manifest, spec.resolve_profile(name))
        for name in spec.profile_names()
    ]
    default_profile = spec.resolved_default()
    image = container.image_ref(manifest)
    return {
        "repo_id": repo_id,
        "name": manifest.name,
        "arch": manifest.arch,
        "kind": spec.kind,
        "supported": spec.kind in SUPPORTED_KINDS,
        "image": image,
        "image_present": container.image_present(image),
        "weights_repo": manifest.weights.repo_id if manifest.weights else None,
        "default_profile": default_profile,
        "profiles": profiles,
        "tt_metal_version": (spec.built or {}).get("tt_metal_version"),
    }


def _load_manifest(repo_id: str, *, allow_fetch: bool):
    """The manifest of an installed bundle, or the Hub's if fetching is allowed."""
    from tt_kernel import container_cli, hub

    manifest = container_cli.load_pulled(repo_id)
    if manifest is not None:
        return manifest, True
    if not allow_fetch:
        return None, False
    with _quiet_tt_kernel():
        manifest = hub.fetch_manifest(repo_id, None)
    if not manifest.is_container:
        raise RuntimeError(
            f"{repo_id} is not a container package; TT Studio can only deploy those"
        )
    return manifest, False


# ---------------------------------------------------------------------- commands


def cmd_catalog(args: argparse.Namespace) -> int:
    """The community catalog, annotated with what is already installed locally."""
    from tt_kernel import hub, localdb

    installed = {e.get("repo_id"): e for e in localdb.all_entries() if e.get("repo_id")}
    tags = [args.arch] if args.arch else []
    with _quiet_tt_kernel():
        found = hub.search(
            args.query or "", limit=args.limit, catalog_only=True, tags=tags
        )
    bundles = []
    for row in found:
        repo_id = row.get("id")
        if not repo_id:
            continue
        entry = installed.get(repo_id) or {}
        bundles.append(
            {
                "repo_id": repo_id,
                "author": repo_id.split("/")[0],
                "downloads": row.get("downloads"),
                "last_modified": row.get("last_modified"),
                "installed": bool(entry),
                "arch": entry.get("arch") or args.arch,
                "default_profile": entry.get("profile"),
                "profiles": entry.get("profiles") or [],
            }
        )
    emit("catalog", arch=args.arch, bundles=bundles)
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    manifest, installed = _load_manifest(args.repo_id, allow_fetch=True)
    if manifest is None:
        raise RuntimeError(f"{args.repo_id} is not installed and could not be fetched")
    emit("bundle", installed=installed, **_describe(args.repo_id, manifest))
    return 0


def _resolve_profile(manifest, name: Optional[str], port: Optional[int]):
    """The merged profile, with TT Studio's port applied.

    The port has to be overridden before composition because it moves two things at
    once — docker's ``--publish`` mapping and the engine's own ``--port`` — which is
    what lets a community container keep TT Studio's ``7000 + device_id`` convention.
    """
    profile = manifest.container.resolve_profile(name)
    return profile.model_copy(update={"port": port}) if port is not None else profile


def _resolve_device_ids(raw: Optional[str], chip_count: int, profile_name: str) -> List[int]:
    """Chips to scope the container to: the caller's pin, else the lowest free ones.

    Both paths go through tt_kernel so the host-wide scan that rejects an already-claimed
    chip runs either way, rather than being trusted from TT Studio's own slot bookkeeping.
    """
    from tt_kernel import container, container_cli

    ids = container_cli.parse_device_id(raw, chip_count=chip_count, profile_name=profile_name)
    if ids is None:
        return container.pick_free_devices(chip_count)
    container.ensure_devices_free(ids)
    return ids


def _ensure_installed(repo_id: str, manifest, installed: bool, *, no_weights: bool):
    """Load the image (and weights) if this bundle has never been pulled here."""
    from tt_kernel import container, container_cli

    if installed and container.image_present(container.image_ref(manifest)):
        return manifest
    emit("stage", stage="model_preparation", progress=10,
         message=f"Installing bundle {repo_id}…")
    with _quiet_tt_kernel():
        container_cli.pull_container(repo_id, None, manifest, no_weights=no_weights)
        return container_cli.load_pulled(repo_id) or manifest


def _connect_network(name: str, network: str) -> None:
    """Attach the container to TT Studio's bridge.

    tt_kernel composes no ``--network``, so the container lands on the default
    bridge. The backend resolves a deployment's internal URL only for containers on
    tt_studio_network, so without this the model would run but never be reachable.
    """
    result = subprocess.run(
        ["docker", "network", "connect", network, name],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        emit("log", level="INFO", message=f"connected {name} to {network}")
    else:
        emit("warning", message=f"could not connect {name} to {network}: "
                                f"{result.stderr.strip()}")


def cmd_serve(args: argparse.Namespace) -> int:
    from tt_kernel import container, launchers

    emit("stage", stage="initialization", progress=2, message="Resolving bundle…")
    manifest, installed = _load_manifest(args.repo_id, allow_fetch=True)
    if manifest is None:
        raise RuntimeError(f"{args.repo_id} could not be resolved")

    spec = manifest.container
    if spec.kind not in SUPPORTED_KINDS:
        raise RuntimeError(
            f"bundle engine {spec.kind!r} is not supported by this TT Studio build "
            f"(supported: {', '.join(SUPPORTED_KINDS)})"
        )

    failures = [r for r in container.preflight(need_devices=True) if not r.ok]
    if failures:
        raise RuntimeError(
            "host is not ready: "
            + "; ".join(f"{r.name} ({r.detail})" for r in failures)
        )

    profile = _resolve_profile(manifest, args.profile, args.port)
    chip_count = _chips_for(profile.mesh_device, profile.hardware)
    # Ahead of the install, which can pull an image and hundreds of GB of weights: a
    # bad pin or a full board should be reported now rather than after the download.
    _resolve_device_ids(args.device_id, chip_count, profile.name)

    manifest = _ensure_installed(
        args.repo_id, manifest, installed, no_weights=args.no_weights
    )
    profile = _resolve_profile(manifest, args.profile, args.port)
    chip_count = _chips_for(profile.mesh_device, profile.hardware)
    launcher = launchers.launcher_for(spec.kind)
    argv = launcher.serve_argv(manifest, profile)
    env = launcher.serve_env(manifest, profile)
    # Re-resolved rather than reusing the pre-check: nothing is reserved, and the
    # install above can run for hours, so a chip picked back then may now be taken.
    device_ids = _resolve_device_ids(args.device_id, chip_count, profile.name)
    run_argv = container.compose_run(
        manifest, profile, argv, env, detach=True, device_ids=device_ids
    )
    name = container.container_name(manifest, profile)
    port = profile.port or 8000

    if container.is_running(name):
        raise RuntimeError(f"{name} is already running; stop it before redeploying")
    if container.container_exists(name):
        # `docker run` creates the container before binding ports, so a previous
        # failed start can leave one holding the name. Clearing it keeps retry viable.
        container.remove(name, force=True)
    container.ensure_mount_sources(manifest)

    emit("stage", stage="container_setup", progress=60,
         message=f"Starting {name} on port {port}…")
    try:
        container.run_checked(run_argv)
    except container.ContainerError:
        if container.container_exists(name):
            container.remove(name, force=True)
        raise

    if args.network:
        _connect_network(name, args.network)

    container_id = container.run_or_empty(
        ["docker", "inspect", "--format", "{{.Id}}", name]
    ).strip()
    emit(
        "started",
        container_name=name,
        container_id=container_id,
        port=port,
        image=container.image_ref(manifest),
        profile=profile.name,
        device_ids=device_ids,
    )

    if args.wait_ready:
        emit("stage", stage="model_preparation", progress=80,
             message="Waiting for the server to report ready…")
        ready = container.wait_ready(
            name, launcher.ready_probe(manifest),
            timeout_s=args.ready_timeout,
            echo=lambda line: emit("log", level="INFO", message=str(line).rstrip()),
        )
        if not ready:
            raise RuntimeError(f"{name} did not report ready within "
                               f"{args.ready_timeout}s")

    emit(
        "result",
        status="success",
        container_name=name,
        container_id=container_id,
        port=port,
        profile=profile.name,
        device_ids=device_ids,
    )
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    """Stop through tt_kernel so the mesh is closed (and reset) correctly.

    A plain ``docker stop`` that escalates to SIGKILL leaves the eth cores dirty and
    the next boot on those chips fails. tt_kernel's stop detects that and resets the
    mesh from the model's own image, so this must not be replaced by a docker call.
    """
    from tt_kernel import container

    manifest, _ = _load_manifest(args.repo_id, allow_fetch=False)
    if manifest is None:
        raise RuntimeError(f"{args.repo_id} is not installed on this host")
    profile = manifest.container.resolve_profile(args.profile)
    name = container.container_name(manifest, profile)
    was_running = container.is_running(name)
    with _quiet_tt_kernel():
        clean = container.stop(name, image=container.image_ref(manifest))
    emit(
        "result",
        status="success",
        container_name=name,
        was_running=was_running,
        clean_shutdown=clean,
        # stop() resets the mesh itself when docker had to SIGKILL; surfacing it lets
        # the UI explain why the board was reset.
        mesh_reset=not clean,
    )
    return 0


# ------------------------------------------------------------------------- entry


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tt_model_runner", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    catalog = sub.add_parser("catalog")
    catalog.add_argument("--arch")
    catalog.add_argument("--query")
    catalog.add_argument("--limit", type=int, default=100)
    catalog.set_defaults(func=cmd_catalog)

    inspect = sub.add_parser("inspect")
    inspect.add_argument("repo_id")
    inspect.set_defaults(func=cmd_inspect)

    serve = sub.add_parser("serve")
    serve.add_argument("repo_id")
    serve.add_argument("--profile")
    serve.add_argument("--port", type=int)
    # Comma-separated chip indices, as tt-model's own --device-id takes them. Omitted
    # means "pick the lowest free chips", which is tt_kernel's default behaviour.
    serve.add_argument("--device-id", dest="device_id")
    serve.add_argument("--network")
    serve.add_argument("--no-weights", action="store_true")
    serve.add_argument("--wait-ready", action="store_true")
    serve.add_argument("--ready-timeout", type=int, default=1800)
    serve.set_defaults(func=cmd_serve)

    stop = sub.add_parser("stop")
    stop.add_argument("repo_id")
    stop.add_argument("--profile")
    stop.set_defaults(func=cmd_stop)
    return parser


def main(raw_args: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(raw_args)
    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001 - the boundary: every failure is one event
        # tt_kernel classifies Hub failures (404/gated/offline) into
        # {cause, detail, evidence, actions} — a message the UI can act on rather
        # than a stack trace. Non-Hub failures keep their own message.
        details: Dict[str, Any] = {}
        repo_id = getattr(args, "repo_id", None)
        if repo_id:
            try:
                from tt_kernel import hub

                details = hub.classify_hub_error(exc, repo_id) or {}
            except Exception:
                details = {}
        emit(
            "error",
            message=details.get("cause") or str(exc) or exc.__class__.__name__,
            detail=details.get("detail"),
            evidence=details.get("evidence"),
            actions=details.get("actions") or [],
            kind=exc.__class__.__name__,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
