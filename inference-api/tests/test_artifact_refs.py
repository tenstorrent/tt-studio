# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for on-demand per-model tt-inference-server builds (artifact_refs.py).

No network: every test builds a real tarball on disk and points the fetcher at a
file:// URL, so the download, integrity check, extraction and atomic-rename paths
are all genuinely exercised.
"""

import sys
import tarfile
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import artifact_refs  # noqa: E402
from artifact_refs import ArtifactRefError, resolve_artifact_dir  # noqa: E402


def _make_artifact_tarball(dest: Path, ref: str = "some-branch", valid: bool = True) -> Path:
    """Build a tarball shaped like a GitHub source archive of tt-inference-server."""
    root = dest / "src" / f"tt-inference-server-{ref}"
    (root / "workflows").mkdir(parents=True)
    if valid:
        (root / "workflows" / "utils.py").write_text("# stand-in for the real module\n")
    (root / "VERSION").write_text("0.0.0\n")

    tarball = dest / "archive.tar.gz"
    with tarfile.open(tarball, "w:gz") as tar:
        tar.add(root, arcname=root.name)
    return tarball


@pytest.fixture
def served(tmp_path, monkeypatch):
    """Serve a locally-built tarball in place of the GitHub archive URL."""
    tarball = _make_artifact_tarball(tmp_path)
    monkeypatch.setattr(artifact_refs, "_archive_url", lambda ref: tarball.as_uri())
    return tarball


def test_fetches_and_validates(tmp_path, served):
    artifacts = tmp_path / ".artifacts"

    result = resolve_artifact_dir("feat/some-branch", artifacts)

    # Sanitized name, nested under refs/ so the launcher's "tt-inference-server*"
    # scan of .artifacts/ can never adopt it as the global artifact.
    assert result == artifacts / "refs" / "feat-some-branch"
    assert (result / "workflows" / "utils.py").is_file()
    assert not list(artifacts.glob("tt-inference-server*"))


def test_cache_hit_skips_download(tmp_path, served, monkeypatch):
    artifacts = tmp_path / ".artifacts"
    resolve_artifact_dir("some-branch", artifacts)

    def _fail(*a, **k):
        raise AssertionError("re-downloaded an already-cached ref")

    monkeypatch.setattr(artifact_refs, "_download", _fail)
    assert resolve_artifact_dir("some-branch", artifacts).is_dir()


def test_concurrent_same_ref_downloads_once(tmp_path, served, monkeypatch):
    """Two deploys of the same model must not extract into one destination at once."""
    artifacts = tmp_path / ".artifacts"
    calls = []
    real_download = artifact_refs._download

    def counting_download(url, dest, ref):
        calls.append(ref)
        return real_download(url, dest, ref)

    monkeypatch.setattr(artifact_refs, "_download", counting_download)

    results, errors = [], []

    def worker():
        try:
            results.append(resolve_artifact_dir("some-branch", artifacts))
        except Exception as e:  # pragma: no cover - only on regression
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert len(calls) == 1
    assert len(set(results)) == 1


def test_missing_ref_raises_with_ref_and_url(tmp_path, monkeypatch):
    """A deleted branch must fail loudly rather than silently using the global
    build, which would surface much later as an opaque argparse error."""
    monkeypatch.setattr(
        artifact_refs, "_archive_url", lambda ref: (tmp_path / "absent.tar.gz").as_uri()
    )

    with pytest.raises(ArtifactRefError) as exc:
        resolve_artifact_dir("no-such-branch", tmp_path / ".artifacts")

    assert "no-such-branch" in str(exc.value)
    assert "absent.tar.gz" in str(exc.value)


def test_tarball_without_workflows_is_rejected(tmp_path, monkeypatch):
    tarball = _make_artifact_tarball(tmp_path, valid=False)
    monkeypatch.setattr(artifact_refs, "_archive_url", lambda ref: tarball.as_uri())
    artifacts = tmp_path / ".artifacts"

    with pytest.raises(ArtifactRefError, match="workflows/utils.py"):
        resolve_artifact_dir("some-branch", artifacts)

    # No partial tree left behind that a later call would take as a cache hit.
    assert not (artifacts / "refs" / "some-branch").exists()
    assert not list((artifacts / "refs").glob(".tmp-*"))


def test_corrupt_tarball_is_discarded_so_retry_can_recover(tmp_path, monkeypatch):
    """A truncated cached tarball would otherwise fail identically forever."""
    artifacts = tmp_path / ".artifacts"
    refs_root = artifacts / "refs"
    refs_root.mkdir(parents=True)
    corrupt = refs_root / "some-branch.tar.gz"
    corrupt.write_bytes(b"not a gzip stream at all")

    good = _make_artifact_tarball(tmp_path)
    monkeypatch.setattr(artifact_refs, "_archive_url", lambda ref: good.as_uri())

    # The corrupt cache is detected up front and re-downloaded, not trusted.
    result = resolve_artifact_dir("some-branch", artifacts)
    assert (result / "workflows" / "utils.py").is_file()


def test_empty_ref_rejected(tmp_path):
    with pytest.raises(ArtifactRefError):
        resolve_artifact_dir("   ", tmp_path / ".artifacts")


def test_commit_sha_uses_bare_archive_path():
    sha = "a" * 40
    assert artifact_refs._archive_url(sha).endswith(f"/archive/{sha}.tar.gz")
    assert artifact_refs._archive_url("my-branch").endswith(
        "/archive/refs/heads/my-branch.tar.gz"
    )
