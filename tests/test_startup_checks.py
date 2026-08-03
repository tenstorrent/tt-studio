# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the startup freshness check's branch-sync policy."""
import unittest

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


if __name__ == "__main__":
    unittest.main()
