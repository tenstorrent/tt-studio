# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for inference-server artifact helpers."""
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    from tt_setup import inference_server as M
    # After the subpackage split, get_inference_server_version() reads
    # INFERENCE_ARTIFACT_DIR from the _metadata submodule's namespace, so patches
    # of that constant must target _metadata (not the re-export on the package).
    from tt_setup.inference_server import _metadata as _version_mod
    from tt_setup.inference_server import _orchestrator as _orch
except ImportError:  # pre-refactor
    import run as M
    _version_mod = _orch = M


class TestValidateArtifactStructure(unittest.TestCase):
    def test_missing_dir_is_invalid(self):
        self.assertFalse(M.validate_artifact_structure("/nope/xyz"))

    def test_missing_workflows_is_invalid(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(M.validate_artifact_structure(d))

    def test_valid_structure(self):
        with tempfile.TemporaryDirectory() as d:
            wf = os.path.join(d, "workflows")
            os.makedirs(wf)
            with open(os.path.join(wf, "utils.py"), "w") as f:
                f.write("# not empty\n")
            self.assertTrue(M.validate_artifact_structure(d))

    def test_empty_utils_is_invalid(self):
        with tempfile.TemporaryDirectory() as d:
            wf = os.path.join(d, "workflows")
            os.makedirs(wf)
            open(os.path.join(wf, "utils.py"), "w").close()  # empty
            self.assertFalse(M.validate_artifact_structure(d))


class TestWriteArtifactInfo(unittest.TestCase):
    def test_writes_machine_readable_markers(self):
        with tempfile.TemporaryDirectory() as d:
            M._write_artifact_info(d, "branch", "main", commit_sha="abc123")
            with open(os.path.join(d, "artifact-info.txt")) as f:
                content = f.read()
        self.assertIn("artifact_type=branch", content)
        self.assertIn("artifact_value=main", content)
        self.assertIn("commit_sha=abc123", content)


class TestGetInferenceServerVersion(unittest.TestCase):
    def test_reads_version_file(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "VERSION"), "w") as f:
                f.write("v9.9.9\n")
            with patch.object(_version_mod, "INFERENCE_ARTIFACT_DIR", d):
                self.assertEqual(M.get_inference_server_version(), "v9.9.9")


class TestSyncModelCatalog(unittest.TestCase):
    def setUp(self):
        from tt_setup.inference_server import _catalog
        self.catalog = _catalog

    def test_retries_without_the_spec_when_the_sync_fails(self):
        with patch.object(self.catalog, "_run_sync", side_effect=[False, True]) as run:
            self.assertTrue(M._sync_model_catalog())
        self.assertEqual(run.call_args_list[-1].args, ("--no-model-support",))

    def test_no_retry_when_the_sync_succeeds(self):
        with patch.object(self.catalog, "_run_sync", return_value=True) as run:
            self.assertTrue(M._sync_model_catalog())
        run.assert_called_once_with()

    def _matches(self, built_from, installed):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "catalog.json")
            with open(path, "w") as f:
                f.write('{"source": {"artifact_version": "%s"}}' % built_from)
            with patch.object(self.catalog, "CATALOG_JSON", path), \
                 patch.object(self.catalog, "_installed_version", return_value=installed):
                return M.catalog_matches_artifact()

    def test_catalog_matches_artifact(self):
        self.assertTrue(self._matches("0.23.0", "0.23.0"))
        self.assertTrue(self._matches("v0.23.0", "0.23.0"))
        self.assertFalse(self._matches("0.22.0", "0.23.0"))

    def test_unknown_versions_count_as_matching(self):
        self.assertTrue(self._matches("0.22.0", None))
        self.assertTrue(self._matches("", "0.23.0"))


if __name__ == "__main__":
    unittest.main()


class TestArtifactMountStub(unittest.TestCase):
    """Before the first download the artifact dir holds only the empty
    workflow_logs/ bind-mount source; that must not read as a broken download,
    but anything else must."""

    def test_empty_workflow_logs_stub_is_recognised(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "workflow_logs", "run_logs"))
            self.assertTrue(_orch._is_mount_stub(root))

    def test_partial_download_is_not_a_stub(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "workflow_logs"))
            with open(os.path.join(root, "VERSION"), "w") as f:
                f.write("0.22.0")
            self.assertFalse(_orch._is_mount_stub(root))

    def test_extraction_that_left_only_directories_is_not_a_stub(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "workflow_logs"))
            os.makedirs(os.path.join(root, "workflows", "utils"))
            self.assertFalse(_orch._is_mount_stub(root))
