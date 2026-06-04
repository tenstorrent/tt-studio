# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for docker/compose diagnostics."""
import unittest

try:
    from tt_setup import docker_diag as M
except ImportError:  # pre-refactor
    import run as M


class TestParseDockerBuildFailure(unittest.TestCase):
    def test_empty_output(self):
        self.assertEqual(M.parse_docker_build_failure(""), (None, None, None))

    def test_target_failed_to_solve(self):
        out = "=> ERROR target tt_studio_backend: failed to solve: something"
        name, friendly, section = M.parse_docker_build_failure(out)
        self.assertEqual(name, "tt_studio_backend")
        self.assertEqual(friendly, "Backend")
        self.assertIsNotNone(section)

    def test_no_match_returns_none(self):
        name, friendly, section = M.parse_docker_build_failure("all good, no errors here")
        self.assertIsNone(name)


class TestDiagnoseContainerFailure(unittest.TestCase):
    def test_oom_exit_137(self):
        d = M.diagnose_container_failure("c", 137, "")
        self.assertEqual(d["severity"], "critical")
        self.assertIn("Out of Memory", d["cause"])

    def test_segfault_exit_139(self):
        d = M.diagnose_container_failure("c", 139, "")
        self.assertIn("Segmentation", d["cause"])

    def test_sigterm_exit_143_is_warning(self):
        d = M.diagnose_container_failure("c", 143, "")
        self.assertEqual(d["severity"], "warning")

    def test_port_conflict_from_logs(self):
        d = M.diagnose_container_failure("c", 1, "Error: address already in use :8000")
        self.assertIn("Port conflict", d["cause"])

    def test_missing_module_from_logs(self):
        d = M.diagnose_container_failure("c", 1, "ModuleNotFoundError: No module named 'foo'")
        self.assertIn("Missing Python module", d["cause"])
        self.assertIn("foo", d["cause"])

    def test_unknown_failure_default(self):
        d = M.diagnose_container_failure("c", 42, "nothing recognizable")
        self.assertIn("Unknown failure", d["cause"])
        self.assertIn("42", d["cause"])


if __name__ == "__main__":
    unittest.main()
