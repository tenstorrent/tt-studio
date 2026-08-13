# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the release flags: version planning and the git/gh command
sequences (all subprocess use mocked — no real git, gh, or network)."""
import subprocess
import unittest
from unittest.mock import patch

from tt_setup import release as M


def _proc(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(args=["git"], returncode=returncode,
                                       stdout=stdout, stderr=stderr)


class _Recorder:
    """Fake _git/_gh: records argv tuples and answers from a script of
    responses keyed by argv prefix (first match in insertion order wins)."""

    def __init__(self, responses=None):
        self.calls = []
        self._responses = responses or {}

    def __call__(self, *argv, **kwargs):
        self.calls.append(argv)
        for key, proc in self._responses.items():
            if argv[:len(key)] == key:
                return proc
        return _proc()

    def prefixes(self, *key):
        return [c for c in self.calls if c[:len(key)] == key]


# --- pure planners ------------------------------------------------------------

class TestVersionPlanning(unittest.TestCase):
    def test_parse_version_strict(self):
        self.assertEqual(M.parse_version("v2.9.1"), (2, 9, 1))
        self.assertIsNone(M.parse_version("v0.0.0-ghcr-test"))  # suffixes rejected
        self.assertIsNone(M.parse_version("rc-v2.9.1"))
        self.assertIsNone(M.parse_version("2.9.1"))
        self.assertIsNone(M.parse_version(""))

    def test_bump_version(self):
        self.assertEqual(M.bump_version("v2.9.1", "major"), "v3.0.0")
        self.assertEqual(M.bump_version("v2.9.1", "minor"), "v2.10.0")
        self.assertEqual(M.bump_version("v2.9.1", "patch"), "v2.9.2")

    def test_bump_version_rejects_junk(self):
        with self.assertRaises(ValueError):
            M.bump_version("banana", "minor")
        with self.assertRaises(ValueError):
            M.bump_version("v2.9.1", "huge")

    def test_find_last_rc_version_each_source(self):
        self.assertEqual(M.find_last_rc_version(["v2.8.0", "v1.0.0"], [], []), "v2.8.0")
        self.assertEqual(M.find_last_rc_version([], ["  origin/rc-v2.9.0"], []), "v2.9.0")
        self.assertEqual(M.find_last_rc_version([], [], ["Rc v2.9.1 (#1196)"]), "v2.9.1")

    def test_find_last_rc_version_takes_max_across_sources(self):
        # The real drift: tags stop at v2.8.0 while RC merges reached v2.9.1.
        self.assertEqual(
            M.find_last_rc_version(
                ["v2.8.0", "v0.0.0-ghcr-test"],
                ["origin/rc-v2.9.0", "origin/jashan/release-automation"],
                ["Rc v2.9.1 (#1196)", "Rc v2.9.0 (#1157)",
                 "Release Candidate v2.5.1 (#726)", "rc-2.3.1 (#579)"],
            ),
            "v2.9.1",
        )

    def test_find_last_rc_version_empty(self):
        self.assertIsNone(M.find_last_rc_version([], [], ["unrelated subject"]))

    def test_parse_oneline(self):
        self.assertEqual(
            M.parse_oneline(["abc123 fix: one thing", "", "def456 feat: another"]),
            [("abc123", "fix: one thing"), ("def456", "feat: another")],
        )

    def test_render_test_plan_mentions_version_and_health_checks(self):
        body = M.render_test_plan("v2.10.0")
        self.assertIn("Rc v2.10.0", body)
        for probe in ("localhost:8000/up/", "localhost:8001/health", "localhost:3000"):
            self.assertIn(probe, body)


# --- shared fixtures ----------------------------------------------------------

_LAST_RC_STATE = {
    ("tag", "-l"): _proc(stdout="v2.8.0\nv0.0.0-ghcr-test\n"),
    ("branch", "-r"): _proc(stdout="  origin/dev\n  origin/rc-v2.9.0\n"),
    ("log", "origin/main"): _proc(stdout="Rc v2.9.1 (#1196)\nRc v2.9.0 (#1157)\n"),
    ("rev-parse", "--verify"): _proc(returncode=1),  # no local/remote rc for the new version
}


def _with_gh(test):
    """Patch gh presence + auth so preflight passes."""
    return patch.object(M.shutil, "which", return_value="/usr/bin/gh")(test)


# --- make_rc_branch -----------------------------------------------------------

class TestMakeRcBranch(unittest.TestCase):
    def test_refuses_dirty_worktree_before_anything_else(self):
        git = _Recorder({("status",): _proc(stdout=" M run.py\n")})
        gh = _Recorder()
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh):
            self.assertEqual(M.make_rc_branch("minor"), 1)
        self.assertEqual([c[0] for c in git.calls], ["status"])
        self.assertEqual(gh.calls, [])

    def test_missing_gh_is_a_clean_failure(self):
        git = _Recorder()
        with patch.object(M, "_git", git), \
             patch.object(M.shutil, "which", return_value=None):
            self.assertEqual(M.make_rc_branch("minor"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_logged_out_gh_is_a_clean_failure(self):
        git = _Recorder()
        gh = _Recorder({("auth", "status"): _proc(returncode=1, stderr="not logged in")})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.make_rc_branch("minor"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_existing_branch_refused(self):
        responses = dict(_LAST_RC_STATE)
        responses[("rev-parse", "--verify")] = _proc(returncode=0)  # branch exists
        git = _Recorder(responses)
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.make_rc_branch("minor"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_existing_tag_refused(self):
        responses = dict(_LAST_RC_STATE)
        responses[("ls-remote",)] = _proc(stdout="deadbeef\trefs/tags/v2.10.0\n")
        git = _Recorder(responses)
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.make_rc_branch("minor"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_bare_flag_without_tty_fails_with_hint(self):
        git = _Recorder(_LAST_RC_STATE)
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch("sys.stdin.isatty", return_value=False):
            from tt_setup.constants import _RC_BUMP_PICKER
            self.assertEqual(M.make_rc_branch(_RC_BUMP_PICKER), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_explicit_minor_bumps_last_rc_and_opens_pr(self):
        # Last known version is v2.9.1 (from a merge subject, not a tag) →
        # minor bump cuts rc-v2.10.0.
        git = _Recorder(_LAST_RC_STATE)
        gh = _Recorder({("pr", "create"): _proc(stdout="https://github.com/x/pull/1\n")})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.make_rc_branch("minor"), 0)
        self.assertIn(("checkout", "-B", "rc-v2.10.0", "origin/main"), git.calls)
        self.assertIn(("push", "-u", "origin", "rc-v2.10.0"), git.calls)
        pr_create = gh.prefixes("pr", "create")
        self.assertEqual(len(pr_create), 1)
        self.assertIn("Rc v2.10.0", pr_create[0])
        self.assertIn("main", pr_create[0])

    def test_bare_flag_prompts_for_part(self):
        git = _Recorder(_LAST_RC_STATE)
        gh = _Recorder({("pr", "create"): _proc(stdout="https://github.com/x/pull/1\n")})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch("sys.stdin.isatty", return_value=True), \
             patch.object(M, "ask", return_value="patch") as asked:
            from tt_setup.constants import _RC_BUMP_PICKER
            self.assertEqual(M.make_rc_branch(_RC_BUMP_PICKER), 0)
        asked.assert_called_once()
        self.assertIn(("checkout", "-B", "rc-v2.9.2", "origin/main"), git.calls)

    def test_garbage_value_is_rejected(self):
        git = _Recorder(_LAST_RC_STATE)
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.make_rc_branch("hueg"), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])


# --- update_rc_branch ---------------------------------------------------------

class TestUpdateRcBranch(unittest.TestCase):
    def _base(self, extra=None):
        responses = {
            ("branch", "-r"): _proc(stdout="  origin/dev\n  origin/rc-v2.10.0\n"),
        }
        responses.update(extra or {})
        return responses

    def test_no_rc_branch_is_a_clean_failure(self):
        git = _Recorder({("branch", "-r"): _proc(stdout="  origin/dev\n")})
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.update_rc_branch(), 1)
        self.assertNotIn("checkout", [c[0] for c in git.calls])

    def test_up_to_date_rc_exits_zero_without_picks(self):
        git = _Recorder(self._base({("log", "--cherry-pick"): _proc(stdout="")}))
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.update_rc_branch(), 0)
        self.assertNotIn("cherry-pick", [c[0] for c in git.calls])

    def test_happy_path_picks_all_and_pushes(self):
        git = _Recorder(self._base({
            ("log", "--cherry-pick"): _proc(stdout="abc123 fix: one\ndef456 fix: two\n"),
        }))
        gh = _Recorder({("pr", "view"): _proc(stdout="https://github.com/x/pull/1\n")})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch("sys.stdin.isatty", return_value=True), \
             patch.object(M, "ask", return_value="all"):
            self.assertEqual(M.update_rc_branch(), 0)
        self.assertIn(("checkout", "rc-v2.10.0"), git.calls)
        self.assertIn(("pull", "--ff-only", "origin", "rc-v2.10.0"), git.calls)
        # Applied oldest-first, in the order git listed them.
        picks = git.prefixes("cherry-pick")
        self.assertEqual(picks, [("cherry-pick", "abc123"), ("cherry-pick", "def456")])
        self.assertIn(("push", "origin", "rc-v2.10.0"), git.calls)

    def test_subset_selection_only_picks_chosen(self):
        git = _Recorder(self._base({
            ("log", "--cherry-pick"): _proc(stdout="abc123 fix: one\ndef456 fix: two\n"),
        }))
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch("sys.stdin.isatty", return_value=True), \
             patch.object(M, "ask", return_value="2"):
            self.assertEqual(M.update_rc_branch(), 0)
        self.assertEqual(git.prefixes("cherry-pick"), [("cherry-pick", "def456")])

    def test_conflict_aborts_the_pick_and_fails(self):
        git = _Recorder(self._base({
            ("log", "--cherry-pick"): _proc(stdout="abc123 fix: one\n"),
            ("cherry-pick", "--abort"): _proc(),
            ("cherry-pick",): _proc(returncode=1, stderr="CONFLICT (content)"),
        }))
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch("sys.stdin.isatty", return_value=True), \
             patch.object(M, "ask", return_value="all"):
            self.assertEqual(M.update_rc_branch(), 1)
        self.assertIn(("cherry-pick", "--abort"), git.calls)
        self.assertNotIn(("push", "origin", "rc-v2.10.0"), git.calls)

    def test_non_tty_with_candidates_fails_cleanly(self):
        git = _Recorder(self._base({
            ("log", "--cherry-pick"): _proc(stdout="abc123 fix: one\n"),
        }))
        with patch.object(M, "_git", git), patch.object(M, "_gh", _Recorder()), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch("sys.stdin.isatty", return_value=False):
            self.assertEqual(M.update_rc_branch(), 1)
        self.assertNotIn("cherry-pick", [c[0] for c in git.calls])


# --- merge_rc_branch ----------------------------------------------------------

_APPROVED_PR = (
    '{"number": 123, "url": "https://github.com/x/pull/123", "state": "OPEN",'
    ' "reviewDecision": "APPROVED",'
    ' "statusCheckRollup": [{"name": "ci", "conclusion": "SUCCESS"}]}'
)


class TestMergeRcBranch(unittest.TestCase):
    def _git_base(self, extra=None):
        responses = {
            ("branch", "-r"): _proc(stdout="  origin/rc-v2.10.0\n"),
            ("rev-parse", "origin/main"): _proc(stdout="feedc0de\n"),
            ("log", "-1"): _proc(stdout="Rc v2.10.0 (#123)\n"),
        }
        responses.update(extra or {})
        return responses

    def test_already_tagged_version_refused(self):
        git = _Recorder(self._git_base({
            ("ls-remote",): _proc(stdout="deadbeef\trefs/tags/v2.10.0\n"),
        }))
        gh = _Recorder()
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.merge_rc_branch(), 1)
        self.assertEqual(gh.prefixes("pr", "merge"), [])

    def test_unapproved_pr_refused_without_merge(self):
        git = _Recorder(self._git_base())
        gh = _Recorder({("pr", "view"): _proc(stdout=_APPROVED_PR.replace(
            "APPROVED", "REVIEW_REQUIRED"))})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.merge_rc_branch(), 1)
        self.assertEqual(gh.prefixes("pr", "merge"), [])

    def test_failing_checks_refused_without_merge(self):
        git = _Recorder(self._git_base())
        gh = _Recorder({("pr", "view"): _proc(stdout=_APPROVED_PR.replace(
            "SUCCESS", "FAILURE"))})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(M.merge_rc_branch(), 1)
        self.assertEqual(gh.prefixes("pr", "merge"), [])

    def test_declined_confirmation_merges_nothing(self):
        git = _Recorder(self._git_base())
        gh = _Recorder({("pr", "view"): _proc(stdout=_APPROVED_PR)})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch.object(M, "confirm", return_value=False):
            self.assertEqual(M.merge_rc_branch(), 0)
        self.assertEqual(gh.prefixes("pr", "merge"), [])
        self.assertNotIn("tag", [c[0] for c in git.calls])

    def test_happy_path_merges_tags_and_releases_in_order(self):
        git = _Recorder(self._git_base())
        gh = _Recorder({
            ("pr", "view"): _proc(stdout=_APPROVED_PR),
            ("api",): _proc(stdout="## What's Changed\n- stuff\n"),
            ("release", "create"): _proc(stdout="https://github.com/x/releases/v2.10.0\n"),
        })
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch.object(M, "confirm", return_value=True):
            self.assertEqual(M.merge_rc_branch(), 0)
        merge = gh.prefixes("pr", "merge")
        self.assertEqual(len(merge), 1)
        self.assertIn("--squash", merge[0])
        self.assertIn("Rc v2.10.0", merge[0])
        self.assertIn(("tag", "v2.10.0", "feedc0de"), git.calls)
        self.assertIn(("push", "origin", "v2.10.0"), git.calls)
        self.assertEqual(len(gh.prefixes("release", "create")), 1)
        # Tag is only pushed after the PR merge, release only after the tag.
        self.assertLess(gh.calls.index(merge[0]),
                        len(gh.calls))  # merge happened
        self.assertLess(git.calls.index(("tag", "v2.10.0", "feedc0de")),
                        git.calls.index(("push", "origin", "v2.10.0")))

    def test_moved_main_tip_refuses_to_tag(self):
        git = _Recorder(self._git_base({
            ("log", "-1"): _proc(stdout="Add unrelated workflow (#1205)\n"),
        }))
        gh = _Recorder({("pr", "view"): _proc(stdout=_APPROVED_PR)})
        with patch.object(M, "_git", git), patch.object(M, "_gh", gh), \
             patch.object(M.shutil, "which", return_value="/usr/bin/gh"), \
             patch.object(M, "confirm", return_value=True):
            self.assertEqual(M.merge_rc_branch(), 1)
        self.assertNotIn("tag", [c[0] for c in git.calls])
        self.assertEqual(gh.prefixes("release", "create"), [])


if __name__ == "__main__":
    unittest.main()
