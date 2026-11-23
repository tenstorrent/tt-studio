# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for moving to a new default artifact version (tt_setup/inference_server/_upgrade.py)."""

import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tt_setup.inference_server import _upgrade as U


class TestSetupArtifactWithFallback(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        artifacts = self._dir.name
        self.artifact = os.path.join(artifacts, "tt-inference-server")
        self.info = os.path.join(artifacts, "artifact-info.txt")
        previous = os.path.join(artifacts, "previous")
        paths = {
            "ARTIFACTS_DIR": artifacts,
            "INFERENCE_ARTIFACT_DIR": self.artifact,
            "INFO_FILE": self.info,
            "PREVIOUS_DIR": previous,
            "PREVIOUS_ARTIFACT": os.path.join(previous, "tt-inference-server"),
            "PREVIOUS_INFO": os.path.join(previous, "artifact-info.txt"),
        }
        for name, value in paths.items():
            patcher = patch.object(U, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.previous = previous
        self.env = {}
        for patcher in (
            patch.object(U, "get_env_var", side_effect=lambda name: self.env.get(name, "")),
            patch.dict(os.environ, {}, clear=False),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        os.environ.pop("TT_INFERENCE_ARTIFACT_VERSION", None)
        self._install("0.22.0")
        self.calls = []

    def _install(self, version):
        os.makedirs(self.artifact, exist_ok=True)
        with open(os.path.join(self.artifact, "VERSION"), "w") as f:
            f.write(version)
        with open(self.info, "w") as f:
            f.write(f"artifact_type=version\nartifact_value=v{version}\n")

    def _version(self):
        with open(os.path.join(self.artifact, "VERSION")) as f:
            return f.read()

    def _run(self, fail=()):
        """Run the upgrade; versions in `fail` leave a partial download and fail."""

        def fake_setup(pull_branch, version):
            self.calls.append(version)
            if version in fail:
                os.makedirs(self.artifact, exist_ok=True)
                os.environ["TT_INFERENCE_ARTIFACT_VERSION"] = version
                return False
            if not os.path.exists(self.artifact):
                self._install(version.lstrip("v"))
            return True

        with patch.object(U, "setup_tt_inference_server", side_effect=fake_setup):
            return U.setup_artifact_with_fallback("v0.23.0")

    def test_upgrade_replaces_the_artifact(self):
        old_tarball = os.path.join(self._dir.name, "tt-inference-server-v0.22.0.tar.gz")
        open(old_tarball, "w").close()
        self.assertIs(self._run(), True)
        self.assertEqual(self._version(), "0.23.0")
        self.assertFalse(os.path.exists(self.previous))
        self.assertFalse(os.path.exists(old_tarball))

    def test_failed_download_keeps_the_installed_artifact(self):
        self.assertIs(self._run(fail={"v0.23.0"}), False)
        self.assertEqual(self.calls, ["v0.23.0"])
        self.assertEqual(self._version(), "0.22.0")
        with open(self.info) as f:
            self.assertIn("v0.22.0", f.read())
        self.assertFalse(os.path.exists(self.previous))
        self.assertEqual(os.environ["TT_INFERENCE_ARTIFACT_VERSION"], "v0.22.0")
        self.assertEqual(os.environ["TT_INFERENCE_ARTIFACT_PATH"], self.artifact)

    def test_failed_download_keeps_an_installed_branch_artifact(self):
        with open(self.info, "w") as f:
            f.write("artifact_type=branch\nartifact_value=my-branch\n")
        self.assertIs(self._run(fail={"v0.23.0"}), False)
        self.assertEqual(self.calls, ["v0.23.0"])
        with open(self.info) as f:
            self.assertIn("artifact_value=my-branch", f.read())

    def test_interrupted_download_restores_the_artifact(self):
        def interrupted(pull_branch, version):
            os.makedirs(self.artifact, exist_ok=True)
            raise KeyboardInterrupt

        with patch.object(U, "setup_tt_inference_server", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                U.setup_artifact_with_fallback("v0.23.0")
        self.assertEqual(self._version(), "0.22.0")

    def test_killed_upgrade_is_recovered_on_the_next_run(self):
        os.makedirs(self.previous)
        os.rename(self.artifact, os.path.join(self.previous, "tt-inference-server"))
        self.assertIs(self._run(fail={"v0.23.0"}), False)
        self.assertEqual(self._version(), "0.22.0")

    def test_same_version_skips_the_backup(self):
        self._install("0.23.0")
        self.assertIs(self._run(), True)
        self.assertEqual(self.calls, ["v0.23.0"])

    def test_pinned_version_has_no_fallback(self):
        self.env["TT_INFERENCE_ARTIFACT_VERSION"] = "v0.21.0"
        self.assertIsNone(self._run(fail={"v0.23.0"}))
        self.assertEqual(self.calls, ["v0.23.0"])

    def test_external_copy_is_used_as_is(self):
        os.makedirs(os.path.join(self.artifact, "workflows"))
        open(os.path.join(self.artifact, "workflows", "utils.py"), "w").close()
        with patch.object(U, "EXTERNAL_INFERENCE_ARTIFACT_DIR", self.artifact):
            self.assertIs(self._run(), False)  # 0.22.0 is not the target, but is kept
            self._install("0.23.0")
            self.assertIs(self._run(), True)
        self.assertEqual(self.calls, [])
        self.assertFalse(os.path.exists(self.previous))
        self.assertEqual(os.environ["TT_INFERENCE_ARTIFACT_PATH"], self.artifact)

    def test_unusable_external_copy_falls_back_to_our_own(self):
        with patch.object(U, "UNUSABLE_INFERENCE_ARTIFACT_DIR", "/not/a/checkout"):
            self.assertIs(self._run(), True)
        self.assertEqual(self.calls, ["v0.23.0"])
        self.assertEqual(self._version(), "0.23.0")


class TestExternalCopyCheck(unittest.TestCase):
    def _constants(self, path):
        script = (
            "import os, tt_setup.constants as c; "
            "print(c.EXTERNAL_INFERENCE_ARTIFACT_DIR, c.UNUSABLE_INFERENCE_ARTIFACT_DIR, "
            "c.INFERENCE_ARTIFACT_DIR == os.path.join(c.TT_STUDIO_ROOT, '.artifacts', 'tt-inference-server'), "
            "'TT_INFERENCE_SERVER_DIR' in os.environ)"
        )
        env = {**os.environ, "TT_INFERENCE_SERVER_DIR": path}
        result = subprocess.run([sys.executable, "-c", script], env=env,
                                capture_output=True, text=True, check=True)
        return result.stdout.split()

    def test_a_checkout_is_used(self):
        with tempfile.TemporaryDirectory() as path:
            os.makedirs(os.path.join(path, "workflows"))
            open(os.path.join(path, "workflows", "utils.py"), "w").close()
            self.assertEqual(self._constants(path), [path, "None", "False", "True"])

    def test_anything_else_is_ignored(self):
        with tempfile.TemporaryDirectory() as path:
            self.assertEqual(self._constants(path), ["None", path, "True", "False"])


if __name__ == "__main__":
    unittest.main()
