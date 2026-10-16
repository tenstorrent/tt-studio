# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for _ensure_artifact_git_marker: the artifact must find a git repo at its
own root, because workflows/utils.py walks up for a ".git" at import time and run.py
runs `git rev-parse HEAD` early in main().

A source checkout gets that from TT-Studio's own repo above .artifacts/. A pip
install (~/.tt-studio) has no repo anywhere above it, which used to stop the
inference server at startup with "Repository root not found".
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

INFERENCE_API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(INFERENCE_API_DIR))

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="requires git")


def _api():
    """Import lazily: api.py monkey-patches the tt-inference-server artifact at
    import time, so importing it is only viable when that artifact is present."""
    return pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )


def _head(path: Path) -> str:
    """What the artifact's run.py runs in get_current_commit_sha()."""
    return subprocess.check_output(
        ["git", "-C", str(path), "rev-parse", "HEAD"], text=True
    ).strip()


@pytest.fixture
def no_git_above(tmp_path):
    """A folder with no git checkout anywhere above it, like ~/.tt-studio."""
    if any((p / ".git").exists() for p in tmp_path.parents):
        pytest.skip("the temp dir is inside a git checkout")
    return tmp_path


def _studio_root(api, root: Path):
    return mock.patch.object(api, "_tt_studio_root", root)


class TestPipInstallLayout:
    def test_artifact_gets_a_repo_of_its_own(self, no_git_above):
        api = _api()
        artifact = no_git_above / "tt-inference-server"
        artifact.mkdir()
        with _studio_root(api, no_git_above):
            api._ensure_artifact_git_marker(artifact)
        assert (artifact / ".git").is_dir()
        assert _head(artifact)

    def test_replaces_a_pointer_at_a_missing_repo(self, no_git_above):
        # What older code wrote on a pip install: a gitfile pointing at
        # ~/.tt-studio/.git, which doesn't exist, so rev-parse failed.
        api = _api()
        artifact = no_git_above / "tt-inference-server"
        artifact.mkdir()
        (artifact / ".git").write_text(f"gitdir: {no_git_above / '.git'}\n")
        with _studio_root(api, no_git_above):
            api._ensure_artifact_git_marker(artifact)
        assert (artifact / ".git").is_dir()
        assert _head(artifact)

    def test_leaves_an_existing_repo_alone(self, no_git_above):
        api = _api()
        artifact = no_git_above / "tt-inference-server"
        artifact.mkdir()
        with _studio_root(api, no_git_above):
            api._ensure_artifact_git_marker(artifact)
            first = _head(artifact)
            api._ensure_artifact_git_marker(artifact)
        assert _head(artifact) == first


class TestSourceCheckoutLayout:
    def test_points_at_tt_studios_repo(self, no_git_above):
        api = _api()
        studio = no_git_above / "tt-studio"
        artifact = studio / ".artifacts" / "tt-inference-server"
        artifact.mkdir(parents=True)
        with _studio_root(api, no_git_above):
            api._ensure_artifact_git_marker(studio)  # stand-in for a clone
        with _studio_root(api, studio):
            api._ensure_artifact_git_marker(artifact)
        assert (artifact / ".git").read_text() == f"gitdir: {studio / '.git'}\n"
        assert _head(artifact) == _head(studio)


def _artifact_source():
    candidates = []
    if os.getenv("TT_INFERENCE_ARTIFACT_PATH"):
        candidates.append(Path(os.environ["TT_INFERENCE_ARTIFACT_PATH"]))
    candidates.append(INFERENCE_API_DIR.parent / ".artifacts" / "tt-inference-server")
    for path in candidates:
        if (path / "workflows" / "utils.py").exists():
            return path
    return None


def test_api_starts_with_no_git_above_the_artifact(no_git_above):
    source = _artifact_source()
    if source is None:
        pytest.skip("requires the tt-inference-server artifact")
    artifact = no_git_above / "tt-inference-server"
    shutil.copytree(
        source,
        artifact,
        ignore=shutil.ignore_patterns(
            ".git", ".env", ".workflow_venvs", "workflow_logs", "__pycache__"
        ),
    )
    result = subprocess.run(
        [sys.executable, "-c", "import api"],
        cwd=INFERENCE_API_DIR,
        env={**os.environ, "TT_INFERENCE_ARTIFACT_PATH": str(artifact)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert _head(artifact)
