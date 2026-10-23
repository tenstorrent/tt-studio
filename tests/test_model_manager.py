# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the tt-model-manager artifact setup (tt_setup/model_manager/_orchestrator.py)."""

import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tt_setup.model_manager import _orchestrator as O


class TestSetupTtModelManager(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.artifact = self._dir.name
        self.python = O.model_manager_python(self.artifact)
        self.override = ""
        patcher = patch.object(O, "get_env_var", side_effect=lambda name: self.override)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _fake_venv(self, venv_dir):
        os.makedirs(os.path.dirname(self.python), exist_ok=True)
        open(self.python, "w").close()
        return True

    def _setup(self, ref, installed=True):
        """Run setup pinned to ``ref``, with a fake venv and an install that succeeds or not."""
        self.override = ref
        with patch.object(O, "_create_venv", side_effect=self._fake_venv), \
                patch.object(O, "_install_package", return_value=(installed, "boom")):
            return O.setup_tt_model_manager(self.artifact)

    def test_installs_the_pin(self):
        self.assertTrue(self._setup("abc"))
        self.assertEqual(O._installed_ref(self.artifact), "abc")

    def test_without_a_pin_installs_the_default(self):
        self.assertTrue(self._setup(""))
        self.assertEqual(O._installed_ref(self.artifact), O.MODEL_MANAGER_DEFAULT_REF)

    def test_failed_upgrade_keeps_the_working_install(self):
        self._setup("abc")
        marker = os.path.join(os.path.dirname(self.python), "abc-marker")
        open(marker, "w").close()
        self.assertTrue(self._setup("def", installed=False))
        self.assertEqual(O._installed_ref(self.artifact), "abc")
        self.assertTrue(os.path.exists(marker))
        self.assertFalse(os.path.exists(os.path.join(self.artifact, O._PREVIOUS_VENV)))

    def test_failed_first_install_is_unusable(self):
        self.assertFalse(self._setup("abc", installed=False))

    def test_interrupted_upgrade_is_rolled_back(self):
        self._setup("abc")
        marker = os.path.join(os.path.dirname(self.python), "abc-marker")
        open(marker, "w").close()
        os.rename(os.path.join(self.artifact, ".venv"), os.path.join(self.artifact, O._PREVIOUS_VENV))
        os.makedirs(os.path.join(self.artifact, ".venv"))  # the half-built new venv
        with patch.object(O, "_install_package") as install:
            self.assertTrue(O.setup_tt_model_manager(self.artifact))
        install.assert_not_called()
        self.assertTrue(os.path.exists(marker))

    def test_successful_upgrade_drops_the_old_venv(self):
        self._setup("abc")
        self.assertTrue(self._setup("def"))
        self.assertEqual(O._installed_ref(self.artifact), "def")
        for name in (O._PREVIOUS_VENV, O._DISCARDED_VENV):
            self.assertFalse(os.path.exists(os.path.join(self.artifact, name)))


def _fake_installer(calls, returncode=1, stderr="error: ref does-not-exist not found"):
    """A subprocess.run stand-in for a uv-created venv, which has no bin/pip."""
    def fake_run(command, **kwargs):
        calls.append(command)
        if command[0].endswith("/pip"):
            raise FileNotFoundError(2, "No such file", command[0])
        return subprocess.CompletedProcess(command, returncode, "", stderr)
    return fake_run


class TestInstallPackage(unittest.TestCase):
    """_install_package runs the real run_command; only subprocess.run is faked."""

    def _run(self, uv, returncode=1):
        calls = []
        with patch.object(O.shutil, "which", return_value="/usr/bin/uv" if uv else None), \
                patch("tt_setup.shell.subprocess.run", side_effect=_fake_installer(calls, returncode)):
            return O._install_package("/venv/bin/python", "does-not-exist"), calls

    def test_failed_uv_install_reports_instead_of_exiting(self):
        (ok, detail), calls = self._run(uv=True)
        self.assertFalse(ok)
        self.assertEqual(detail, "error: ref does-not-exist not found")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:3], ["uv", "pip", "install"])

    def test_without_uv_installs_with_the_venv_interpreter(self):
        (ok, _), calls = self._run(uv=False, returncode=0)
        self.assertTrue(ok)
        self.assertEqual(calls[0][:4], ["/venv/bin/python", "-m", "pip", "install"])

    def test_failed_upgrade_with_uv_restores_the_working_venv(self):
        with tempfile.TemporaryDirectory() as artifact:
            python = O.model_manager_python(artifact)

            def fake_venv(venv_dir):
                os.makedirs(os.path.dirname(python), exist_ok=True)
                open(python, "w").close()
                return True

            with patch.object(O, "get_env_var", return_value="abc"), \
                    patch.object(O, "_create_venv", side_effect=fake_venv), \
                    patch.object(O, "_install_package", return_value=(True, "")):
                O.setup_tt_model_manager(artifact)
            marker = os.path.join(os.path.dirname(python), "abc-marker")
            open(marker, "w").close()

            with patch.object(O, "get_env_var", return_value="does-not-exist"), \
                    patch.object(O, "_create_venv", side_effect=fake_venv), \
                    patch.object(O.shutil, "which", return_value="/usr/bin/uv"), \
                    patch("tt_setup.shell.subprocess.run", side_effect=_fake_installer([])):
                self.assertTrue(O.setup_tt_model_manager(artifact))
            self.assertTrue(os.path.exists(marker))
            self.assertEqual(O._installed_ref(artifact), "abc")
            self.assertFalse(os.path.exists(os.path.join(artifact, O._PREVIOUS_VENV)))


if __name__ == "__main__":
    unittest.main()
