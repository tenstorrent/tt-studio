# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for --switch: ref classification and the git command sequence (mocked)."""
import subprocess
import unittest
from unittest.mock import patch

try:
    from tt_setup import switch as M
except ImportError:
    import run as M


def _proc(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(args=["git"], returncode=returncode,
                                       stdout=stdout, stderr=stderr)


class TestPlanSwitch(unittest.TestCase):
    def test_plan_switch_prefers_branch_over_tag(self):
        self.assertEqual(M.plan_switch(True, True, True), "branch")
        self.assertEqual(M.plan_switch(True, False, False), "branch")

    def test_plan_switch_remote_branch_counts(self):
        self.assertEqual(M.plan_switch(False, True, False), "branch")

    def test_plan_switch_tag_only(self):
        self.assertEqual(M.plan_switch(False, False, True), "tag")

    def test_plan_switch_unknown_returns_none(self):
        self.assertIsNone(M.plan_switch(False, False, False))


class _GitRecorder:
    """Fake _git: records argv tuples and answers from a script of responses."""

    def __init__(self, responses):
        self.calls = []
        self._responses = responses  # dict: first argv token (or tuple) -> proc

    def __call__(self, *argv):
        self.calls.append(argv)
        for key, proc in self._responses.items():
            if argv[:len(key)] == key:
                return proc
        return _proc()


class TestSwitchCheckout(unittest.TestCase):
    def test_switch_refuses_dirty_worktree(self):
        git = _GitRecorder({("status",): _proc(stdout=" M run.py\n")})
        with patch.object(M, "_git", git):
            self.assertEqual(M.switch_checkout("dev"), 1)
        # Refused before touching the network or the checkout.
        self.assertEqual([c[0] for c in git.calls], ["status"])

    def test_switch_fetch_failure_returns_error(self):
        git = _GitRecorder({("fetch",): _proc(returncode=1, stderr="no route to host")})
        with patch.object(M, "_git", git):
            self.assertEqual(M.switch_checkout("dev"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_switch_unknown_ref_returns_error(self):
        git = _GitRecorder({("rev-parse", "--verify"): _proc(returncode=1)})
        with patch.object(M, "_git", git):
            self.assertEqual(M.switch_checkout("nonsense"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_switch_branch_checkout_and_ff_pull(self):
        calls = []

        def fake_git(*argv):
            calls.append(argv)
            if argv[:2] == ("rev-parse", "--verify"):
                # Branch exists (locally and on origin); no tag of the same name.
                ok = argv[-1].startswith(("refs/heads/", "refs/remotes/"))
                return _proc(returncode=0 if ok else 1)
            return _proc()

        with patch.object(M, "_git", fake_git):
            self.assertEqual(M.switch_checkout("dev"), 0)
        self.assertIn(("checkout", "dev"), calls)
        self.assertIn(("pull", "--ff-only", "origin", "dev"), calls)

    def test_switch_tag_detached_checkout(self):
        calls = []

        def fake_git(*argv):
            calls.append(argv)
            if argv[:2] == ("rev-parse", "--verify"):
                return _proc(returncode=0 if argv[-1].startswith("refs/tags/") else 1)
            if argv[:2] == ("rev-parse", "--short"):
                return _proc(stdout="abc1234\n")
            return _proc()

        with patch.object(M, "_git", fake_git):
            self.assertEqual(M.switch_checkout("v2.9.0-rc1"), 0)
        self.assertIn(("checkout", "tags/v2.9.0-rc1"), calls)
        self.assertNotIn(("pull", "--ff-only", "origin", "v2.9.0-rc1"), calls)

    def test_switch_diverged_branch_pull_failure_returns_error(self):
        def fake_git(*argv):
            if argv[:2] == ("rev-parse", "--verify"):
                return _proc(returncode=0 if argv[-1].startswith("refs/heads/") else 1)
            if argv[0] == "pull":
                return _proc(returncode=1, stderr="fatal: Not possible to fast-forward")
            return _proc()

        with patch.object(M, "_git", fake_git):
            self.assertEqual(M.switch_checkout("dev"), 1)


if __name__ == "__main__":
    unittest.main()
