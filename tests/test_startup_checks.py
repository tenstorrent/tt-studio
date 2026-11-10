# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the startup freshness check's branch-sync policy."""
import io
import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

try:
    from tt_setup import startup_checks as M
except ImportError:  # pre-refactor
    import run as M


class TestIsReleaseBranch(unittest.TestCase):
    def test_named_release_branches(self):
        for branch in ("main", "dev", "tt_qb2_launch_branch"):
            self.assertTrue(M.is_release_branch(branch), branch)

    def test_release_prefixes(self):
        for branch in ("rc/1.2.0", "release/v2"):
            self.assertTrue(M.is_release_branch(branch), branch)

    def test_feature_branches_are_not_release(self):
        for branch in ("aramchandran/voice-rag", "fix/thing", "devtools", "maintenance"):
            self.assertFalse(M.is_release_branch(branch), branch)

    def test_empty_or_detached_is_not_release(self):
        self.assertFalse(M.is_release_branch(""))
        self.assertFalse(M.is_release_branch("HEAD"))


class TestBlocksStartup(unittest.TestCase):
    def test_release_branch_behind_blocks(self):
        self.assertTrue(M.blocks_startup(behind=True, branch_is_release=True, dev_mode=False))

    def test_dev_mode_never_blocks(self):
        self.assertFalse(M.blocks_startup(behind=True, branch_is_release=True, dev_mode=True))

    def test_feature_branch_behind_does_not_block(self):
        self.assertFalse(M.blocks_startup(behind=True, branch_is_release=False, dev_mode=False))

    def test_up_to_date_does_not_block(self):
        self.assertFalse(M.blocks_startup(behind=False, branch_is_release=True, dev_mode=False))
        self.assertFalse(M.blocks_startup(behind=False, branch_is_release=True, dev_mode=True))


class TestPyPiAndVersionUtils(unittest.TestCase):
    def test_release_tuple(self):
        self.assertEqual(M._release_tuple("1.2.3"), (1, 2, 3))
        self.assertEqual(M._release_tuple("0.10.25"), (0, 10, 25))
        self.assertIsNone(M._release_tuple("invalid"))
        self.assertIsNone(M._release_tuple(""))
        self.assertIsNone(M._release_tuple(None))

    def test_pypi_update_available(self):
        self.assertTrue(M.pypi_update_available("1.0.0", "1.1.0"))
        self.assertTrue(M.pypi_update_available("1.0.0", "2.0.0"))
        self.assertFalse(M.pypi_update_available("1.1.0", "1.0.0"))
        self.assertFalse(M.pypi_update_available("1.0.0", "1.0.0"))
        self.assertFalse(M.pypi_update_available("bad", "1.0.0"))

    def test_fetch_github_sha(self):
        # Dict response
        mock_resp = io.BytesIO(json.dumps({"object": {"sha": "1234567890abcdef"}}).encode())
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertEqual(M._fetch_github_sha("owner", "repo", "main"), "1234567890abcdef")

        # List response
        mock_resp = io.BytesIO(json.dumps([{"object": {"sha": "abcdef1234567890"}}]).encode())
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertEqual(M._fetch_github_sha("owner", "repo", "main"), "abcdef1234567890")

        # Network error
        with patch("urllib.request.urlopen", side_effect=Exception("error")):
            self.assertIsNone(M._fetch_github_sha("owner", "repo", "main"))

    def test_fetch_pypi_latest(self):
        mock_resp = io.BytesIO(json.dumps({"info": {"version": "3.0.0"}}).encode())
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertEqual(M._fetch_pypi_latest("tt-studio"), "3.0.0")

        with patch("urllib.request.urlopen", side_effect=Exception("error")):
            self.assertIsNone(M._fetch_pypi_latest("tt-studio"))


class TestArtifactCommitShaUtils(unittest.TestCase):
    def test_read_artifact_commit_sha(self):
        with tempfile.TemporaryDirectory() as root:
            # Missing file
            self.assertIsNone(M._read_artifact_commit_sha(root))

            # Existing file with sha
            art_dir = os.path.join(root, ".artifacts")
            os.makedirs(art_dir)
            info_file = os.path.join(art_dir, "artifact-info.txt")
            with open(info_file, "w") as f:
                f.write("artifact_value=main\ncommit_sha=abcdef123456\n")
            self.assertEqual(M._read_artifact_commit_sha(root), "abcdef123456")

    def test_backfill_artifact_commit_sha(self):
        with tempfile.TemporaryDirectory() as root:
            # Missing file
            self.assertFalse(M._backfill_artifact_commit_sha(root, "sha123"))

            # Existing file without sha
            art_dir = os.path.join(root, ".artifacts")
            os.makedirs(art_dir)
            info_file = os.path.join(art_dir, "artifact-info.txt")
            with open(info_file, "w") as f:
                f.write("     artifact_value=main\n")
            self.assertTrue(M._backfill_artifact_commit_sha(root, "sha123"))

            with open(info_file) as f:
                content = f.read()
            self.assertIn("     commit_sha=sha123\n", content)


class TestCheckStartupFreshness(unittest.TestCase):
    def test_pip_install_freshness_update_available(self):
        with patch.object(M.install_mode, "is_pip_install", return_value=True), \
             patch.object(M.install_mode, "package_version", return_value="1.0.0"), \
             patch.object(M, "_fetch_pypi_latest", return_value="1.2.0"), \
             patch.object(M.console, "print"):
            res = M.check_startup_freshness("/fake", lambda k: "")
            self.assertTrue(res["tt_studio_behind"])

    def test_pip_install_freshness_up_to_date(self):
        with patch.object(M.install_mode, "is_pip_install", return_value=True), \
             patch.object(M.install_mode, "package_version", return_value="1.2.0"), \
             patch.object(M, "_fetch_pypi_latest", return_value="1.2.0"), \
             patch.object(M, "is_verbose", return_value=True), \
             patch.object(M.console, "print"):
            res = M.check_startup_freshness("/fake", lambda k: "")
            self.assertFalse(res["tt_studio_behind"])

    def test_git_checkout_freshness_behind_release_branch(self):
        sha_proc = MagicMock(stdout="local_sha_123\n")
        branch_proc = MagicMock(stdout="main\n")
        with patch.object(M.install_mode, "is_pip_install", return_value=False), \
             patch("subprocess.run", side_effect=[sha_proc, branch_proc]), \
             patch.object(M, "_fetch_github_sha", side_effect=["remote_sha_456", "art_remote_789"]), \
             patch.object(M, "_read_artifact_commit_sha", return_value="art_local_000"), \
             patch.object(M.console, "print"):
            res = M.check_startup_freshness("/fake", lambda k: "main" if "ARTIFACT" in k else "", dev_mode=False)
            self.assertTrue(res["tt_studio_behind"])
            self.assertTrue(res["tt_studio_blocks_startup"])
            self.assertTrue(res["artifact_behind"])

    def test_git_checkout_freshness_up_to_date(self):
        sha_proc = MagicMock(stdout="common_sha_123\n")
        branch_proc = MagicMock(stdout="main\n")
        with patch.object(M.install_mode, "is_pip_install", return_value=False), \
             patch("subprocess.run", side_effect=[sha_proc, branch_proc]), \
             patch.object(M, "_fetch_github_sha", side_effect=["common_sha_123", "art_common_789"]), \
             patch.object(M, "_read_artifact_commit_sha", return_value="art_common_789"), \
             patch.object(M, "is_verbose", return_value=True), \
             patch.object(M.console, "print"):
            res = M.check_startup_freshness("/fake", lambda k: "main" if "ARTIFACT" in k else "", dev_mode=False)
            self.assertFalse(res["tt_studio_behind"])
            self.assertFalse(res["tt_studio_blocks_startup"])
            self.assertFalse(res["artifact_behind"])


if __name__ == "__main__":
    unittest.main()
