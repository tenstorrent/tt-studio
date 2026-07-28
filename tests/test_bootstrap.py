# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the first-run dependency bootstrap (no real venv is created)."""
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from tt_setup import bootstrap as B


class TestReadDeps(unittest.TestCase):
    def test_reads_project_dependencies(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "pyproject.toml")
            with open(p, "w") as f:
                f.write(
                    '[project]\nname = "x"\nversion = "0"\n'
                    'dependencies = ["rich>=13", "typer>=0.12"]\n'
                )
            self.assertEqual(B._read_deps(p), ["rich>=13", "typer>=0.12"])

    def test_missing_file_raises(self):
        # Hardened bootstrap fails loudly rather than silently returning [].
        with self.assertRaises(OSError):
            B._read_deps("/nope/pyproject.toml")

    def test_deps_hash_is_order_independent(self):
        self.assertEqual(B._deps_hash(["a", "b"]), B._deps_hash(["b", "a"]))
        self.assertNotEqual(B._deps_hash(["a"]), B._deps_hash(["a", "b"]))


class TestEnsureEnvironment(unittest.TestCase):
    def test_noop_when_flag_set(self):
        with patch.dict(os.environ, {B._FLAG: "1"}), patch("os.execve") as execve, \
             patch.object(B, "_ensure_venv_with_deps") as ensure:
            B.ensure_environment()
            execve.assert_not_called()
            ensure.assert_not_called()

    def test_noop_when_already_in_target_venv(self):
        with patch.dict(os.environ, {}, clear=False), \
             patch.object(B, "_in_target_venv", return_value=True), \
             patch("os.execve") as execve, \
             patch.object(B, "_ensure_venv_with_deps") as ensure:
            os.environ.pop(B._FLAG, None)
            B.ensure_environment()
            execve.assert_not_called()
            ensure.assert_not_called()

    def test_empty_deps_exits_without_reexec(self):
        # No declared deps -> refuse to bootstrap an empty venv (clean exit, no re-exec).
        with patch.dict(os.environ, {}, clear=False), \
             patch.object(B, "_in_target_venv", return_value=False), \
             patch.object(B, "_read_deps", return_value=[]), \
             patch("os.execve") as execve:
            os.environ.pop(B._FLAG, None)
            with self.assertRaises(SystemExit):
                B.ensure_environment()
            execve.assert_not_called()

    def test_reexecs_when_outside_venv_with_deps(self):
        with patch.dict(os.environ, {}, clear=False), \
             patch.object(B, "_in_target_venv", return_value=False), \
             patch.object(B, "_read_deps", return_value=["rich>=13"]), \
             patch.object(B, "_ensure_venv_with_deps") as ensure, \
             patch("os.execve") as execve:
            os.environ.pop(B._FLAG, None)
            B.ensure_environment()
            ensure.assert_called_once()
            execve.assert_called_once()
            # re-exec sets the loop-guard flag and targets the venv python
            args = execve.call_args[0]
            self.assertIn(B._FLAG, args[2])
            self.assertEqual(args[2][B._FLAG], "1")


class TestEnsureVenvWithDeps(unittest.TestCase):
    def test_creates_and_installs_when_missing(self):
        with patch.object(B, "recreate_venv_if_stale", return_value=True), \
             patch("os.path.exists", return_value=False), \
             patch("subprocess.run") as run, \
             patch.object(B, "_install") as install, \
             patch.object(B, "_write_marker") as wm:
            B._ensure_venv_with_deps("/tmp/venv", ["rich>=13"])
            run.assert_called_once()        # python -m venv
            install.assert_called_once()
            wm.assert_called_once()

    def test_reinstalls_when_marker_stale(self):
        with patch.object(B, "recreate_venv_if_stale", return_value=False), \
             patch("os.path.exists", return_value=True), \
             patch.object(B, "_read_marker", return_value="OLD"), \
             patch.object(B, "_install") as install, \
             patch.object(B, "_write_marker") as wm:
            B._ensure_venv_with_deps("/tmp/venv", ["rich>=13"])
            install.assert_called_once()
            wm.assert_called_once()

    def test_skips_install_when_marker_matches(self):
        deps = ["rich>=13"]
        with patch.object(B, "recreate_venv_if_stale", return_value=False), \
             patch("os.path.exists", return_value=True), \
             patch.object(B, "_read_marker", return_value=B._deps_hash(deps)), \
             patch.object(B, "_install") as install:
            B._ensure_venv_with_deps("/tmp/venv", deps)
            install.assert_not_called()


if __name__ == "__main__":
    unittest.main()
