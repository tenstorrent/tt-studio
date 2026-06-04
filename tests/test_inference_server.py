# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for inference-server artifact helpers."""
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    from tt_setup import inference_server as M
except ImportError:  # pre-refactor
    import run as M


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
            with patch.object(M, "INFERENCE_ARTIFACT_DIR", d):
                self.assertEqual(M.get_inference_server_version(), "v9.9.9")


if __name__ == "__main__":
    unittest.main()
