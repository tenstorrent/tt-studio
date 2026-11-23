# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for reporting which artifact copies a run uses (tt_setup/artifact_sources.py)."""

import os
import tempfile
import unittest
from unittest.mock import patch

from tt_setup import artifact_sources as A


class TestArtifactSources(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.artifact = os.path.join(self._dir.name, "tt-inference-server")
        os.makedirs(self.artifact)
        with open(os.path.join(self.artifact, "VERSION"), "w") as f:
            f.write("0.24.0\n")
        for name, value in (
            ("SOURCES_FILE", os.path.join(self._dir.name, "artifact-sources.json")),
            ("INFERENCE_ARTIFACT_DIR", self.artifact),
            ("EXTERNAL_INFERENCE_ARTIFACT_DIR", None),
        ):
            patcher = patch.object(A, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _record(self, status):
        with patch.object(A, "model_manager_status", return_value=status):
            return A.record_artifact_sources()

    def test_own_copies(self):
        self._record({"available": True, "external": False, "python": "/x/python",
                      "ref": "f14f5a87b690e3adadfb", "version": None})
        self.assertEqual(A.artifact_rows(A.load_artifact_sources()), [
            ("Inference server", "v0.24.0 · TT Studio's own"),
            ("Model manager", "f14f5a87 · TT Studio's own"),
        ])

    def test_external_copies_name_their_variable_and_path(self):
        with patch.object(A, "EXTERNAL_INFERENCE_ARTIFACT_DIR", self.artifact):
            self._record({"available": True, "external": True, "python": "/uv/tt-model/bin/python",
                          "ref": None, "version": "0.3.0"})
        rows = dict(A.artifact_rows(A.load_artifact_sources()))
        self.assertEqual(rows["Inference server"],
                         f"v0.24.0 · external (TT_INFERENCE_SERVER_DIR) · {self.artifact}")
        self.assertEqual(rows["Model manager"],
                         "0.3.0 · external (TT_MODEL_MANAGER_PYTHON) · /uv/tt-model/bin/python")

    def test_missing_artifacts_are_left_out(self):
        os.remove(os.path.join(self.artifact, "VERSION"))
        os.rmdir(self.artifact)
        self._record({"available": False})
        self.assertEqual(A.artifact_rows(A.load_artifact_sources()), [])

    def test_no_record_shows_nothing(self):
        self.assertEqual(A.load_artifact_sources(), {})
        self.assertEqual(A.artifact_rows({}), [])


if __name__ == "__main__":
    unittest.main()
