# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""On-demand fetching of per-model tt-inference-server builds.

TT-Studio normally runs one globally pinned tt-inference-server artifact,
extracted to ``.artifacts/tt-inference-server/`` at startup from the
``TT_INFERENCE_ARTIFACT_BRANCH``/``_VERSION`` pin in ``.env``. A model that only
exists on a feature branch of tt-inference-server can't be deployed from that
build, and pinning ``.env`` to the feature branch just moves the problem onto
every other model (and is erased by ``run.py --purge-all``).

A catalog entry can instead name the build it needs per board. This module
fetches those builds and caches them beside the global one, so a dev-catalog
deploy can be pointed at its own artifact without disturbing anything else.

Deliberately self-contained: ``inference-api`` runs from its own virtualenv and
cannot import ``tt_setup`` (which pulls in the launcher's console dependencies),
so the small amount of download/extract logic here intentionally mirrors
``tt_setup/inference_server/_orchestrator.py`` rather than sharing code with it.
"""

import logging
import os
import shutil
import tarfile
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict

logger = logging.getLogger(__name__)

_REPO_ARCHIVE_BASE = "https://github.com/tenstorrent/tt-inference-server/archive"

# Serializes fetches of the same ref so two concurrent deploys don't download and
# extract into the same destination at once. Different refs still fetch in
# parallel. _locks itself is guarded by _locks_guard.
_locks_guard = threading.Lock()
_locks: Dict[str, threading.Lock] = {}


class ArtifactRefError(Exception):
    """A cited tt-inference-server ref could not be fetched or validated.

    Raised rather than silently falling back to the global artifact: deploying a
    model against a build that doesn't contain it fails much later with an opaque
    "invalid choice" argparse error that reads like a TT-Studio bug.
    """


def _sanitize(ref: str) -> str:
    """Filesystem-safe form of a ref ('a/b' -> 'a-b'), matching GitHub's own
    archive naming so the extracted directory name is predictable."""
    return ref.replace("/", "-")


def _is_commit_sha(ref: str) -> bool:
    """True if ref looks like a full 40-char hex commit SHA.

    Mirrors tt_setup.inference_server._git._is_commit_sha; GitHub serves SHAs and
    branch names from different archive paths.
    """
    return bool(ref) and len(ref) == 40 and all(c in "0123456789abcdefABCDEF" for c in ref)


def _archive_url(ref: str) -> str:
    if _is_commit_sha(ref):
        return f"{_REPO_ARCHIVE_BASE}/{ref}.tar.gz"
    return f"{_REPO_ARCHIVE_BASE}/refs/heads/{ref}.tar.gz"


def _is_valid_artifact_dir(path: Path) -> bool:
    """True if `path` looks like a usable tt-inference-server checkout.

    Same structural check the launcher uses (validate_artifact_structure): a
    non-empty workflows/utils.py is the cheapest reliable signal, and it is
    written late enough in extraction that a partial tree fails it.
    """
    utils = path / "workflows" / "utils.py"
    try:
        return utils.is_file() and utils.stat().st_size > 0
    except OSError:
        return False


def _is_valid_targz(path: Path) -> bool:
    """True if `path` is a readable, non-empty gzip tarball.

    An interrupted download leaves a truncated .tar.gz that fails deep inside
    extraction with an opaque EOFError, so walk the member headers up front
    before trusting a cached file.
    """
    try:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        with tarfile.open(path, "r:gz") as tar:
            for _ in tar:
                pass
        return True
    except Exception:
        return False


def _download(url: str, dest: Path, ref: str) -> None:
    """Download `url` to `dest`, leaving no partial file behind on failure."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as fh:
            shutil.copyfileobj(resp, fh)
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        if e.code == 404:
            raise ArtifactRefError(
                f"tt-inference-server ref '{ref}' not found (HTTP 404): {url}. "
                f"Check the branch/tag/commit named in the model's "
                f"inference_artifact_ref catalog field."
            ) from e
        raise ArtifactRefError(
            f"Failed to download tt-inference-server ref '{ref}' (HTTP {e.code}): {url}"
        ) from e
    except Exception as e:
        tmp.unlink(missing_ok=True)
        raise ArtifactRefError(
            f"Failed to download tt-inference-server ref '{ref}' from {url}: {e}"
        ) from e

    if tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise ArtifactRefError(
            f"Downloaded tt-inference-server ref '{ref}' is empty: {url}"
        )
    os.replace(tmp, dest)


def _extract(tarball: Path, refs_root: Path, dest: Path, ref: str, url: str) -> None:
    """Extract `tarball` and move the resulting tree into `dest` atomically.

    Extraction happens in a sibling temp directory and only lands at `dest` via a
    single rename, so an interrupted fetch can never leave a half-extracted tree
    that a later call would mistake for a warm cache.
    """
    staging = Path(tempfile.mkdtemp(prefix=f".tmp-{dest.name}-", dir=str(refs_root)))
    try:
        try:
            with tarfile.open(tarball, "r:gz") as tar:
                # "data" refuses members that would escape the destination via
                # absolute paths, "..", or links -- worth having on an archive
                # fetched over the network. Feature-detected because the argument
                # only exists on newer Pythons (it becomes the default in 3.14).
                extract_kwargs = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
                tar.extractall(staging, **extract_kwargs)
        except Exception as e:
            raise ArtifactRefError(
                f"Failed to extract tt-inference-server ref '{ref}' from {url}: {e}. "
                f"The cached tarball may be corrupt; it has been removed, so retrying "
                f"will download it again."
            ) from e

        # GitHub archives contain a single top-level tt-inference-server-<ref> dir.
        candidates = [p for p in staging.iterdir() if p.is_dir()]
        extracted = next(
            (p for p in candidates if p.name.startswith("tt-inference-server")),
            candidates[0] if len(candidates) == 1 else None,
        )
        if extracted is None:
            raise ArtifactRefError(
                f"tt-inference-server ref '{ref}' extracted no recognizable directory "
                f"(found: {[p.name for p in candidates]}) from {url}"
            )
        if not _is_valid_artifact_dir(extracted):
            raise ArtifactRefError(
                f"tt-inference-server ref '{ref}' is missing workflows/utils.py -- "
                f"it does not look like a tt-inference-server checkout ({url})"
            )

        # dest can exist here only if a previous attempt left an invalid tree.
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        os.replace(extracted, dest)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def resolve_artifact_dir(ref: str, artifacts_root) -> Path:
    """Return a validated tt-inference-server directory for `ref`, fetching it if needed.

    Cached under ``<artifacts_root>/refs/<sanitized-ref>/``. The nesting is
    deliberate: the launcher's own setup scans ``.artifacts/`` for any entry whose
    name starts with "tt-inference-server" and adopts the first match as the
    global artifact when its expected directory is missing
    (tt_setup/inference_server/_orchestrator.py). Per-ref builds sitting at that
    level could be silently adopted as the global build, so they live one
    directory down where that scan can't see them.

    Raises ArtifactRefError if the ref cannot be fetched or doesn't validate.
    """
    if not ref or not ref.strip():
        raise ArtifactRefError("Empty tt-inference-server ref")
    ref = ref.strip()

    refs_root = Path(artifacts_root) / "refs"
    sanitized = _sanitize(ref)
    dest = refs_root / sanitized

    if _is_valid_artifact_dir(dest):
        return dest

    with _locks_guard:
        lock = _locks.setdefault(sanitized, threading.Lock())

    with lock:
        # Another thread may have completed the fetch while we waited.
        if _is_valid_artifact_dir(dest):
            return dest

        refs_root.mkdir(parents=True, exist_ok=True)
        tarball = refs_root / f"{sanitized}.tar.gz"
        url = _archive_url(ref)

        if _is_valid_targz(tarball):
            logger.info("Using cached tt-inference-server tarball for ref '%s'", ref)
        else:
            tarball.unlink(missing_ok=True)
            logger.info("Fetching tt-inference-server ref '%s' from %s", ref, url)
            _download(url, tarball, ref)

        try:
            _extract(tarball, refs_root, dest, ref, url)
        except ArtifactRefError:
            # A corrupt cached tarball would otherwise fail identically forever.
            tarball.unlink(missing_ok=True)
            raise

        logger.info("tt-inference-server ref '%s' ready at %s", ref, dest)
        return dest
