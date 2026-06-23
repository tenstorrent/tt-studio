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


class TestParseBuildLine(unittest.TestCase):
    def test_step_header(self):
        line = "#22 [tt_studio_backend 2/8] RUN apt-get update && apt-get install -y curl"
        self.assertEqual(
            M.parse_build_line(line),
            ("step", "tt_studio_backend", 2, 8, "RUN apt-get update && apt-get install -y curl"),
        )

    def test_step_header_with_leading_spaces(self):
        line = "   #5 [tt_studio_frontend 3/9] COPY package.json ."
        self.assertEqual(
            M.parse_build_line(line),
            ("step", "tt_studio_frontend", 3, 9, "COPY package.json ."),
        )

    def test_cached_step_is_a_step(self):
        # CACHED steps still surface a header line and should render.
        line = "#7 [tt_studio_agent 4/6] COPY requirements.txt ."
        kind, svc, x, y, _ = M.parse_build_line(line)
        self.assertEqual((kind, svc, x, y), ("step", "tt_studio_agent", 4, 6))

    def test_built_line(self):
        self.assertEqual(
            M.parse_build_line(" ✔ tt_studio_backend  Built"),
            ("built", "tt_studio_backend"),
        )

    def test_started_line_counts_as_built(self):
        self.assertEqual(
            M.parse_build_line(" ✔ Container tt_studio_chroma  Started"),
            ("built", "tt_studio_chroma"),
        )

    def test_internal_stage_is_ignored(self):
        # "[svc internal]" has no X/Y -> not a step we render.
        self.assertIsNone(M.parse_build_line("#3 [tt_studio_backend internal] load build definition"))

    def test_noise_returns_none(self):
        self.assertIsNone(M.parse_build_line("#22 DONE 5.3s"))
        self.assertIsNone(M.parse_build_line("some random log output"))
        self.assertIsNone(M.parse_build_line(""))


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
