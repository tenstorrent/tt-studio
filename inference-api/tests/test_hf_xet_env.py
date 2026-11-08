# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Hugging Face Xet opt-out and the byte counting it relies on.

Xet transfer used to be force-disabled for every deploy (HF_HUB_DISABLE_XET=1), which
capped weight downloads at a single HTTPS stream (~20 MB/s). It is now on by default
and TT_STUDIO_DISABLE_HF_XET is the escape hatch. Xet writes the file straight into
the HF cache's `blobs/<sha>.<rand>.incomplete` partial, so the weights-progress
monitor must keep counting in-progress blobs or the bar would sit at 0% until the
download finishes.
"""

import os
from unittest import mock

import pytest


def _api():
    """Import lazily: api.py monkey-patches the tt-inference-server artifact at
    import time, so importing it is only viable when that artifact is present."""
    return pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )


# The hub's cache-wide shared blob store must stay off for every deploy: it turns the
# per-repo blobs/ entries into symlinks that escape the container bind-mount.
XET_ON = {"HF_HUB_DISABLE_SHARED_BLOBS": "1"}
XET_OFF = {"HF_HUB_DISABLE_SHARED_BLOBS": "1", "HF_HUB_DISABLE_XET": "1"}


class TestHfXetEnvOverrides:
    def test_default_leaves_xet_enabled(self):
        env = {k: v for k, v in os.environ.items() if k != "TT_STUDIO_DISABLE_HF_XET"}
        with mock.patch.dict(os.environ, env, clear=True):
            assert _api()._hf_xet_env_overrides() == XET_ON

    @pytest.mark.parametrize("value", ["false", "False", "0", "", "  ", "no", "off"])
    def test_falsy_values_leave_xet_enabled(self, value):
        assert (
            _api()._hf_xet_env_overrides({"TT_STUDIO_DISABLE_HF_XET": value}) == XET_ON
        )

    @pytest.mark.parametrize("value", ["true", "True", " TRUE ", "1", "yes", "on"])
    def test_truthy_values_disable_xet(self, value):
        assert (
            _api()._hf_xet_env_overrides({"TT_STUDIO_DISABLE_HF_XET": value}) == XET_OFF
        )

    def test_reads_process_environment_by_default(self):
        with mock.patch.dict(os.environ, {"TT_STUDIO_DISABLE_HF_XET": "true"}):
            assert _api()._hf_xet_env_overrides() == XET_OFF

    def test_shared_blob_store_always_disabled(self):
        for value in ("", "false", "true"):
            overrides = _api()._hf_xet_env_overrides(
                {"TT_STUDIO_DISABLE_HF_XET": value}
            )
            assert overrides["HF_HUB_DISABLE_SHARED_BLOBS"] == "1"


class TestDownloadedBytesWithXetPartials:
    REPO = "Motif-Technologies/Motif-Image-6B-Preview"

    def _make_cache(self, hf_home, layout_hub=True):
        repo_dir = (hf_home / "hub" if layout_hub else hf_home) / (
            "models--" + self.REPO.replace("/", "--")
        )
        blobs = repo_dir / "blobs"
        blobs.mkdir(parents=True)
        return repo_dir, blobs

    def test_counts_in_progress_incomplete_blob(self, tmp_path):
        """Mid-download, Xet's only on-disk footprint for the file is the .incomplete
        partial in blobs/ (the $HF_HOME/xet dir holds a few hundred KB of chunk
        metadata, not the payload). Progress must track that partial."""
        _repo_dir, blobs = self._make_cache(tmp_path)
        (blobs / "8d3e2c40.ec6a48a5.incomplete").write_bytes(b"x" * 4096)
        (blobs / "aabbccdd").write_bytes(b"y" * 512)  # an already-finished small file
        xet = tmp_path / "xet" / "chunk-cache"
        xet.mkdir(parents=True)
        (xet / "meta").write_bytes(b"z" * 100)

        assert (
            _api()._get_downloaded_bytes_from_hf_cache(tmp_path, self.REPO)
            == 4096 + 512
        )

    def test_counts_finished_blob_after_rename(self, tmp_path):
        """When Xet finishes it renames the partial to the bare sha; the count must
        not drop (same bytes, different name)."""
        _repo_dir, blobs = self._make_cache(tmp_path)
        (blobs / "8d3e2c40").write_bytes(b"x" * 4096)

        assert _api()._get_downloaded_bytes_from_hf_cache(tmp_path, self.REPO) == 4096

    def test_follows_symlink_into_shared_blob_store(self, tmp_path):
        """huggingface_hub >= 1.32 finishes a Xet download by moving the payload to
        $HF_HOME/hub/blobs/<xx>/<xet-hash> and leaving a symlink in the per-repo
        blobs/ dir. The count must follow it, otherwise a completed download reads
        as 0 B and a pre-cached repo is never recognised as cached."""
        _repo_dir, blobs = self._make_cache(tmp_path)
        shared = tmp_path / "hub" / "blobs" / "03"
        shared.mkdir(parents=True)
        target = (
            shared / "034700ba1833ce0167f478f78b7193a398b74d1d436d8f98fa4c8b086c1ecc8f"
        )
        target.write_bytes(b"x" * 8192)
        (blobs / "8d3e2c40").symlink_to(os.path.relpath(target, blobs))

        assert _api()._get_downloaded_bytes_from_hf_cache(tmp_path, self.REPO) == 8192

    def test_dangling_symlink_is_ignored(self, tmp_path):
        _repo_dir, blobs = self._make_cache(tmp_path)
        (blobs / "8d3e2c40").symlink_to("../../blobs/03/does-not-exist")
        (blobs / "aabbccdd").write_bytes(b"y" * 512)

        assert _api()._get_downloaded_bytes_from_hf_cache(tmp_path, self.REPO) == 512

    def test_legacy_layout_without_hub_segment(self, tmp_path):
        _repo_dir, blobs = self._make_cache(tmp_path, layout_hub=False)
        (blobs / "deadbeef.00000000.incomplete").write_bytes(b"x" * 2048)

        assert _api()._get_downloaded_bytes_from_hf_cache(tmp_path, self.REPO) == 2048

    def test_missing_repo_dir_is_zero(self, tmp_path):
        assert _api()._get_downloaded_bytes_from_hf_cache(tmp_path, self.REPO) == 0
