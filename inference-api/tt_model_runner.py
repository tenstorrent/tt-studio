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
    catalog --catalog F --arch A [--query Q] [--limit N]
                                              verified community bundles for this arch
    inspect <repo_id>                         deployable metadata for one bundle
    serve   <repo_id> [options]               event stream for one deployment
    stop    <repo_id> [--profile P]           stop one running bundle
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

# vLLM bundles are always chat servers, so they need no Hub task lookup (see _task).
# Which engines can be deployed at all is tt_kernel's own launcher registry; which
# page drives a deployed bundle is TT Studio's call (community_overrides.toml).
VLLM_KINDS = ("vllm-plugin", "vllm-fork")

# Container log lines quoted in a startup-failure message.
_READY_TAIL_LINES = 20

# tt-cli's community_catalog.json format this reads.
CATALOG_SCHEMA_VERSION = 1

# Manifests are read concurrently for the whole catalog listing. Measured at ~1.1s
# for 43 bundles cold and ~0.4s warm, against ~0.2s each serially; the backend caches
# the result, so this is paid once per refresh rather than per page view.
_MANIFEST_WORKERS = 8


def _protocol_stream():
    """A private duplicate of stdout, so events survive ``_quiet_tt_kernel``'s fd mute."""
    try:
        return os.fdopen(os.dup(1), "w", buffering=1)
    except OSError:
        return sys.stdout


_OUT = _protocol_stream()
# The download monitor emits from its own thread.
_OUT_LOCK = threading.Lock()


def emit(event: str, **fields: Any) -> None:
    """Write one NDJSON event. Flushed so the reader sees progress live."""
    line = json.dumps({"event": event, **fields}, default=str) + "\n"
    with _OUT_LOCK:
        _OUT.write(line)
        _OUT.flush()


@contextlib.contextmanager
def _quiet_tt_kernel():
    """Keep everything tt_kernel prints away from stdout, which carries the NDJSON.

    Redirected at the fd level: tt_kernel's progress console is bound to
    ``sys.__stdout__``, which ``redirect_stdout`` alone does not reach.
    """
    sys.stdout.flush()
    try:
        saved = os.dup(1)
    except OSError:
        with contextlib.redirect_stdout(sys.stderr):
            yield
        return
    try:
        os.dup2(2, 1)
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        sys.stdout.flush()
        os.dup2(saved, 1)
        os.close(saved)


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


def _launchable(kind: Optional[str]) -> bool:
    """True for an engine tt-model-manager has a launcher for."""
    from tt_kernel.launchers import KINDS

    return kind in KINDS


def _task(kind: str, repo_id: str, weights_repo: Optional[str]) -> Optional[str]:
    """The Hub task a non-vLLM bundle serves: its own pipeline_tag, else its weights'.

    A tt-dit-server app has no common API, so the task is what tells an image model
    from a robotics policy. Bundles rarely tag themselves; their weights repos do.
    """
    if kind in VLLM_KINDS:
        return None
    from huggingface_hub import HfApi

    api = HfApi()
    for repo in (repo_id, weights_repo):
        if not repo:
            continue
        try:
            tag = api.model_info(repo).pipeline_tag
        except Exception:
            continue
        if tag:
            return tag
    return None


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
    weights_repo = manifest.weights.repo_id if manifest.weights else None
    return {
        "repo_id": repo_id,
        "name": manifest.name,
        "arch": manifest.arch,
        "kind": spec.kind,
        "supported": _launchable(spec.kind),
        "task": _task(spec.kind, repo_id, weights_repo),
        "image": image,
        "image_present": container.image_present(image),
        "weights_repo": weights_repo,
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


def _verified_bundles(path: str, arch: Optional[str], query: Optional[str],
                     limit: int) -> List[Dict[str, Any]]:
    """tt-cli's community_catalog.json rows for ``arch``, filtered by repo substring.

    The file lists the bundles verified to deploy; until the Hub has a verification
    process it is the whole community listing, so nothing is discovered by search.
    """
    doc = json.loads(Path(path).read_text())
    if not isinstance(doc, dict) or doc.get("schema_version") != CATALOG_SCHEMA_VERSION:
        raise ValueError(f"{path} has an unsupported schema_version")
    wanted = (query or "").lower()
    rows = [
        row for row in doc.get("bundles") or []
        if row.get("repo")
        and (not arch or row.get("arch") == arch)
        and wanted in row["repo"].lower()
    ]
    return rows[:limit]


def _catalog_entry(repo_id: str) -> Optional[Dict[str, Any]]:
    """A catalog row's deployable detail, read from its manifest alone.

    The manifest is one small JSON file, so a bundle that has never been pulled is
    described here without touching its image or weights. Profiles come back in the
    same shape ``inspect`` returns, so one code path in TT Studio can build a
    model_impl from either — which matters because a bundle may declare several
    profiles with different meshes, and only the manifest lists them all.

    No image probe: that is a docker call per row and the listing does not report it.
    Best-effort — a bundle the Hub will not serve stays on its catalog row rather
    than failing the whole listing.
    """
    from tt_kernel import hub

    try:
        manifest = hub.fetch_manifest(repo_id, None)
        if not manifest.is_container:
            return None
        spec = manifest.container
        profiles = [
            _profile_summary(manifest, spec.resolve_profile(name))
            for name in spec.profile_names()
        ]
        default = spec.resolve_profile(None)
    except Exception as e:
        emit("log", level="DEBUG", message=f"could not read manifest for {repo_id}: {e}")
        return None
    weights_repo = manifest.weights.repo_id if manifest.weights else None
    return {
        "arch": manifest.arch,
        "kind": spec.kind,
        "supported": _launchable(spec.kind),
        "task": _task(spec.kind, repo_id, weights_repo),
        "weights_repo": weights_repo,
        "default_profile": spec.resolved_default(),
        "profiles": profiles,
        # Kept consistent with `profiles` above rather than left on the catalog row's
        # smallest verified board, which need not be the default profile's.
        "hardware": default.hardware,
        "chips_required": _chips_for(default.mesh_device, default.hardware),
    }


def _annotate_from_manifests(bundles: List[Dict[str, Any]]) -> None:
    """Replace each row's catalog-derived guess with its manifest, in place.

    Concurrent because every row is an independent Hub round-trip; bounded because
    this runs while the deploy page waits. A row whose manifest cannot be read keeps
    what the catalog said.
    """
    if not bundles:
        return
    with ThreadPoolExecutor(max_workers=_MANIFEST_WORKERS) as pool:
        details = pool.map(_catalog_entry, [b["repo_id"] for b in bundles])
    for bundle, detail in zip(bundles, details):
        if detail:
            bundle.update(detail)


def cmd_catalog(args: argparse.Namespace) -> int:
    """The verified community bundles, annotated with what is already installed locally."""
    from tt_kernel import localdb

    try:
        rows = _verified_bundles(args.catalog, args.arch, args.query, args.limit)
    except (OSError, ValueError) as e:
        emit("warning", message=f"could not read the community catalog: {e}")
        rows = []
    installed = {e.get("repo_id"): e for e in localdb.all_entries() if e.get("repo_id")}
    bundles = []
    for row in rows:
        repo_id = row["repo"]
        entry = installed.get(repo_id) or {}
        validated = list(row.get("hardware") or [])
        # Fallback only, for a bundle whose manifest the Hub will not serve: the
        # smallest board it was verified on. None reads as unknown, not one chip.
        hardware = validated[0] if validated else None
        kind = row.get("engine")
        bundles.append(
            {
                "repo_id": repo_id,
                "author": repo_id.split("/")[0],
                "installed": bool(entry),
                "arch": entry.get("arch") or row.get("arch") or args.arch,
                "default_profile": entry.get("profile"),
                "profiles": [],
                "hardware": hardware,
                "validated_hardware": validated,
                "validated_on": row.get("validated_on"),
                "chips_required": _chips_for(None, hardware) if hardware else None,
                "kind": kind,
                "supported": _launchable(kind) if kind else None,
                "weights_repo": None,
            }
        )
    # One block: fetch_manifest writes progress to stdout, which has to stay pure NDJSON,
    # and redirect_stdout is process-wide — so the thread pool must run inside it.
    with _quiet_tt_kernel():
        _annotate_from_manifests(bundles)
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


def _ensure_weights(repo_id: str, manifest, *, no_weights: bool) -> None:
    """Have tt-model-manager fetch or resume the pinned weights before launch.

    Called for installed bundles too: it resumes a partial cache and is a ~1s no-op
    on a complete one, so the engine never boots on missing shards.
    """
    from tt_kernel import container_cli

    ref = getattr(manifest, "weights", None)
    if ref is None:
        return
    if no_weights:
        emit("log", level="INFO",
             message=f"skipping weights {ref.repo_id}; the container must find them itself")
        return

    emit("stage", stage="model_preparation", progress=20,
         message=f"Fetching weights {ref.repo_id}…")
    with _quiet_tt_kernel():
        container_cli.ensure_weights(manifest, repo_id, no_weights=False)
    emit("log", level="INFO", message=f"weights {ref.repo_id} ready")


# ------------------------------------------------------------ download progress

_POLL_SECONDS = 1.0


def _format_bytes(num: Optional[float]) -> str:
    """Decimal units, matching the sizes the Hub and inference-api report."""
    if not num or num <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    idx = 0
    while num >= 1000 and idx < len(units) - 1:
        num /= 1000
        idx += 1
    decimals = 0 if num >= 100 or idx == 0 else 1 if num >= 10 else 2
    return f"{num:.{decimals}f} {units[idx]}"


def _hub_files(repo_id: str, revision: Optional[str], repo_type: str,
               allow_patterns=None, ignore_patterns=None) -> List[tuple]:
    """``(blob name, size)`` for every file ``snapshot_download`` fetches for a pin."""
    from huggingface_hub import HfApi
    from huggingface_hub.utils import filter_repo_objects

    info = HfApi().repo_info(repo_id, revision=revision, repo_type=repo_type,
                             files_metadata=True)
    siblings = filter_repo_objects(
        info.siblings or [], allow_patterns=allow_patterns,
        ignore_patterns=ignore_patterns, key=lambda s: s.rfilename,
    )
    return [(s.lfs.sha256 if s.lfs else s.blob_id, s.size or 0) for s in siblings]


def _cached_bytes(blobs_dir: Path, files: List[tuple]) -> int:
    """Bytes of ``files`` present in an HF cache, counting partial ``.incomplete`` blobs.

    Matched by blob name so other revisions cached for the same repo are not counted.
    """
    total = 0
    for blob, size in files:
        try:
            done = blobs_dir / blob
            if done.is_file():
                total += size
                continue
            total += max((p.stat().st_size for p in blobs_dir.glob(f"{blob}*.incomplete")),
                         default=0)
        except OSError:
            pass
    return total


def _tree_bytes(root: Path) -> int:
    total = 0
    for dirpath, _, names in os.walk(root):
        for name in names:
            try:
                total += os.lstat(os.path.join(dirpath, name)).st_size
            except OSError:
                pass
    return total


class _Download:
    """One download's byte counter, with a smoothed speed."""

    def __init__(self, stage: str, repo: str, total: int, measure: Callable[[], int]):
        self.stage = stage
        self.repo = repo
        self.total = total
        self.measure = measure
        self.done = min(measure(), total) if total else measure()
        self.speed: Optional[float] = None
        self._at = time.monotonic()

    def sample(self) -> bool:
        """Re-measure; True when bytes arrived since the last sample."""
        now = time.monotonic()
        done = min(self.measure(), self.total) if self.total else self.measure()
        grew = done > self.done
        if grew:
            rate = (done - self.done) / max(now - self._at, 1e-3)
            self.speed = rate if self.speed is None else 0.2 * rate + 0.8 * self.speed
        self.done = max(self.done, done)
        self._at = now
        return grew

    def fields(self, expects_weights: bool) -> Dict[str, Any]:
        remaining = self.total - self.done
        eta = remaining / self.speed if self.speed and remaining > 0 else None
        speed = f"{_format_bytes(self.speed)}/s" if self.speed else "—"
        if self.stage == "pulling_image":
            message = ("Loading image into Docker…" if self.done >= self.total
                       else "Pulling Docker Image...")
        elif self.done >= self.total:
            message = "Finalizing model weights and cache..."
        else:
            message = (f"Downloading weights: {_format_bytes(self.done)} / "
                       f"{_format_bytes(self.total)} • {speed}")
        return {
            "stage": self.stage,
            "message": message,
            "weights_repo": self.repo,
            "downloaded_bytes": self.done,
            "total_bytes": self.total or None,
            "speed_bps": self.speed,
            "eta_seconds": eta,
            "expects_weights": expects_weights,
        }


class _DownloadMonitor(threading.Thread):
    """Emits ``download`` events for the bundle image and the weights, once a second.

    Measured from bytes on disk, as inference-api does for its own deploys: tt_kernel's
    byte counter only covers the files in flight, so it cannot give an overall total.
    """

    def __init__(self, repo_id: str, manifest, staging: Path):
        super().__init__(name="download-monitor", daemon=True)
        self._repo_id = repo_id
        self._manifest = manifest
        self._staging = staging
        self._done = threading.Event()

    def stop(self) -> None:
        self._done.set()
        self.join(timeout=1)

    def _downloads(self) -> List[_Download]:
        from tt_kernel import container, hub

        # Tracked even when the image is loaded: tt_kernel reloads on a digest mismatch,
        # and a download that never starts is never reported.
        downloads = []
        try:
            files = _hub_files(self._repo_id, None, getattr(hub, "_REPO_TYPE", "model"))
            downloads.append(_Download(
                "pulling_image", container.image_ref(self._manifest),
                sum(size for _, size in files), lambda: _tree_bytes(self._staging),
            ))
        except Exception as e:  # noqa: BLE001 - progress is advisory
            emit("log", level="DEBUG", message=f"no image download size: {e}")

        ref = self._manifest.weights
        if ref is not None:
            try:
                files = _hub_files(ref.repo_id, ref.revision,
                                   getattr(ref, "repo_type", None) or "model",
                                   ref.allow_patterns, ref.ignore_patterns)
                blobs = (container.hub_cache()
                         / f"models--{ref.repo_id.replace('/', '--')}" / "blobs")
                downloads.append(_Download(
                    "model_preparation", ref.repo_id, sum(size for _, size in files),
                    lambda: _cached_bytes(blobs, files),
                ))
            except Exception as e:  # noqa: BLE001 - progress is advisory
                emit("log", level="DEBUG", message=f"no weights download size: {e}")
        return downloads

    def run(self) -> None:
        downloads = self._downloads()
        expects_weights = self._manifest.weights is not None
        weights = next((d for d in downloads if d.stage == "model_preparation"), None)
        if weights is not None and weights.total and weights.done >= weights.total:
            # Stage-less: a fact about the deploy, still true if the install already ended.
            emit("download", weights_repo=weights.repo, weights_cached=True)
            downloads.remove(weights)
        active: Optional[_Download] = None
        while not self._done.wait(_POLL_SECONDS):
            for download in downloads:
                if download.sample():
                    active = download
            if active is not None and not self._done.is_set():
                emit("download", **active.fields(expects_weights))


@contextlib.contextmanager
def _download_progress(repo_id: str, manifest):
    """Report download progress for the block that installs the bundle.

    tt_kernel stages the bundle in an anonymous temp dir; pointing ``tempfile`` at one
    we own for the duration is what lets its size be measured.
    """
    staging = Path(tempfile.mkdtemp(prefix="tt-studio-bundle-"))
    previous = tempfile.tempdir
    tempfile.tempdir = str(staging)
    monitor = _DownloadMonitor(repo_id, manifest, staging)
    monitor.start()
    try:
        yield
    finally:
        monitor.stop()
        tempfile.tempdir = previous
        shutil.rmtree(staging, ignore_errors=True)


def _ensure_hf_modules_dir() -> None:
    """Create ``$HF_HOME/modules`` as the host user before the container starts.

    transformers writes remote code there for ``trust_remote_code`` models. The
    container runs as the host uid without its supplementary groups, so under a
    group-writable HF_HOME (e.g. a shared ``root:docker`` cache) it cannot create it.
    """
    from tt_kernel import container

    try:
        (container.hf_home() / "modules").mkdir(parents=True, exist_ok=True)
    except OSError as e:
        emit("warning", message=f"could not create {container.hf_home() / 'modules'}: {e}")


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
    if not _launchable(spec.kind):
        raise RuntimeError(
            f"bundle engine {spec.kind!r} has no launcher in this tt-model-manager build"
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

    with _download_progress(args.repo_id, manifest):
        manifest = _ensure_installed(
            args.repo_id, manifest, installed, no_weights=args.no_weights
        )
        _ensure_weights(args.repo_id, manifest, no_weights=args.no_weights)
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
    _ensure_hf_modules_dir()

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
        emit("stage", stage="container_started", progress=80,
             message="Waiting for the server to report ready…")
        # The container's own log is the only account of a startup failure.
        outcome = container.wait_ready(
            name, launcher.ready_probe(manifest),
            timeout_s=args.ready_timeout,
            on_line=lambda line: emit("log", level="INFO", message=str(line).rstrip()),
        )
        if not outcome.ready:
            reason = (
                f"{name} exited during startup"
                if outcome.exited
                else f"{name} did not report ready within {args.ready_timeout}s"
            )
            tail = "\n".join(str(line).rstrip() for line in outcome.tail[-_READY_TAIL_LINES:])
            raise RuntimeError(f"{reason}. Last output:\n{tail}" if tail else reason)

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
    catalog.add_argument("--catalog", required=True)
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


_HUB_ERROR_MODULES = ("huggingface_hub", "httpx", "httpcore", "requests", "urllib3")


def _is_hub_error(exc: BaseException) -> bool:
    """Did this failure come from talking to the Hub?

    ``classify_hub_error`` labels anything it is given a Hub failure, which would
    replace a docker or device error's own message with a generic one.
    """
    seen = 0
    while exc is not None and seen < 10:
        if type(exc).__module__.split(".")[0] in _HUB_ERROR_MODULES:
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


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
        if repo_id and _is_hub_error(exc):
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
