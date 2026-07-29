# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the tt-studio shell shortcut: path extraction, uninstall, repair."""
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    from tt_setup import shortcut as M
except ImportError:
    import run as M


def _block_for(path):
    return (
        f"{M._MARKER_START}\n"
        f'tt-studio() {{ ( cd "{path}" && python3 run.py "$@" ); }}\n'
        f"{M._MARKER_END}\n"
    )


class TestExtractShortcutPath(unittest.TestCase):
    def test_extract_shortcut_path_from_block(self):
        content = "export FOO=1\n" + _block_for("/opt/tt-studio")
        self.assertEqual(M.extract_shortcut_path(content), "/opt/tt-studio")

    def test_extract_shortcut_path_none_when_absent(self):
        self.assertIsNone(M.extract_shortcut_path("export FOO=1\nalias ll='ls -l'\n"))
        self.assertIsNone(M.extract_shortcut_path(""))


class _RcFileCase(unittest.TestCase):
    """Base: a temp dir with an rc file, and _detect_shell_rc patched to it."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.rc_path = os.path.join(self._tmp.name, ".zshrc")

    def _write_rc(self, content):
        with open(self.rc_path, "w") as f:
            f.write(content)

    def _read_rc(self):
        with open(self.rc_path, "r") as f:
            return f.read()

    def _patch_shell(self):
        return patch.object(M, "_detect_shell_rc", return_value=("zsh", self.rc_path))


class TestInstalledShortcutPath(_RcFileCase):
    def test_installed_shortcut_path_reads_rc_file(self):
        self._write_rc("# prelude\n" + _block_for("/repos/tt-studio"))
        self.assertEqual(M.installed_shortcut_path(self.rc_path), "/repos/tt-studio")

    def test_installed_shortcut_path_missing_file_returns_none(self):
        self.assertIsNone(M.installed_shortcut_path(self.rc_path))

    def test_installed_shortcut_path_no_block_returns_none(self):
        self._write_rc("export FOO=1\n")
        self.assertIsNone(M.installed_shortcut_path(self.rc_path))


class TestStripBlock(unittest.TestCase):
    def test_strip_block_removes_complete_block(self):
        lines = ("before\n" + _block_for("/x") + "after\n").splitlines(keepends=True)
        self.assertEqual(M._strip_block(lines), ["before\n", "after\n"])

    def test_strip_block_leaves_unbalanced_markers_untouched(self):
        lines = f"before\n{M._MARKER_START}\ntt-studio() {{ :; }}\n".splitlines(keepends=True)
        self.assertEqual(M._strip_block(lines), lines)


class TestUninstallShortcut(_RcFileCase):
    def test_uninstall_shortcut_removes_block_and_returns_true(self):
        prelude = "export PATH=$PATH:/bin\nalias ll='ls -l'\n"
        self._write_rc(prelude + _block_for("/repos/tt-studio"))
        with self._patch_shell():
            self.assertTrue(M.uninstall_shortcut())
        content = self._read_rc()
        self.assertNotIn(M._MARKER_START, content)
        self.assertNotIn("tt-studio()", content)
        # The rest of the rc file is preserved.
        self.assertIn("alias ll='ls -l'", content)
        self.assertIn("export PATH=$PATH:/bin", content)

    def test_uninstall_shortcut_returns_false_when_not_installed(self):
        self._write_rc("export FOO=1\n")
        with self._patch_shell():
            self.assertFalse(M.uninstall_shortcut())
        self.assertEqual(self._read_rc(), "export FOO=1\n")

    def test_uninstall_shortcut_refuses_unbalanced_markers(self):
        content = f"export FOO=1\n{M._MARKER_START}\ntt-studio() {{ :; }}\n"
        self._write_rc(content)
        with self._patch_shell():
            self.assertFalse(M.uninstall_shortcut())
        self.assertEqual(self._read_rc(), content)

    def test_uninstall_shortcut_unsupported_shell_returns_false(self):
        with patch.object(M, "_detect_shell_rc", return_value=("fish", None)):
            self.assertFalse(M.uninstall_shortcut())


class TestMaybeRepairShortcut(_RcFileCase):
    def test_maybe_repair_rewrites_stale_path(self):
        self._write_rc("# prelude\n" + _block_for("/old/checkout"))
        with self._patch_shell(), patch.object(M, "TT_STUDIO_ROOT", self._tmp.name):
            M.maybe_repair_shortcut()
        content = self._read_rc()
        self.assertEqual(M.extract_shortcut_path(content), self._tmp.name)
        self.assertNotIn("/old/checkout", content)
        self.assertIn("# prelude", content)
        self.assertEqual(content.count(M._MARKER_START), 1)

    def test_maybe_repair_noop_when_path_matches(self):
        self._write_rc(_block_for(self._tmp.name))
        before = self._read_rc()
        with self._patch_shell(), patch.object(M, "TT_STUDIO_ROOT", self._tmp.name):
            M.maybe_repair_shortcut()
        self.assertEqual(self._read_rc(), before)

    def test_maybe_repair_noop_when_paths_are_symlink_equivalent(self):
        real = os.path.join(self._tmp.name, "repo")
        os.mkdir(real)
        link = os.path.join(self._tmp.name, "repo-link")
        os.symlink(real, link)
        self._write_rc(_block_for(link))
        before = self._read_rc()
        with self._patch_shell(), patch.object(M, "TT_STUDIO_ROOT", real):
            M.maybe_repair_shortcut()
        self.assertEqual(self._read_rc(), before)

    def test_maybe_repair_never_raises(self):
        with patch.object(M, "_detect_shell_rc", side_effect=RuntimeError("boom")):
            M.maybe_repair_shortcut()  # must swallow, not raise


if __name__ == "__main__":
    unittest.main()
