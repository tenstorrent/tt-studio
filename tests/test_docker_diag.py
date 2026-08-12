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
            ("step", 22, "tt_studio_backend", 2, 8, "RUN apt-get update && apt-get install -y curl"),
        )

    def test_step_header_with_leading_spaces(self):
        line = "   #5 [tt_studio_frontend 3/9] COPY package.json ."
        self.assertEqual(
            M.parse_build_line(line),
            ("step", 5, "tt_studio_frontend", 3, 9, "COPY package.json ."),
        )

    def test_cached_step_is_a_step(self):
        # CACHED steps still surface a header line and should render.
        line = "#7 [tt_studio_agent 4/6] COPY requirements.txt ."
        kind, n, svc, x, y, _ = M.parse_build_line(line)
        self.assertEqual((kind, n, svc, x, y), ("step", 7, "tt_studio_agent", 4, 6))

    def test_built_line(self):
        self.assertEqual(
            M.parse_build_line(" ✔ tt_studio_backend  Built"),
            ("built", "tt_studio_backend"),
        )

    def test_started_line(self):
        # Container start is a distinct event — image-only services (chroma)
        # start without ever building, and must not be labeled "built".
        self.assertEqual(
            M.parse_build_line(" ✔ Container tt_studio_chroma_dev  Started"),
            ("started", "tt_studio_chroma_dev"),
        )

    def test_pulled_line_service_name(self):
        # `docker compose pull` completion, rendered as "✓ backend pulled".
        self.assertEqual(
            M.parse_build_line(" ✔ tt_studio_backend  Pulled"),
            ("pulled", "tt_studio_backend"),
        )

    def test_pulled_line_image_ref(self):
        # Non-TTY compose prints image refs instead of service names.
        line = " Image ghcr.io/tenstorrent/tt-studio/backend:sha-3f6cccd191d2 Pulled "
        self.assertEqual(M.parse_build_line(line), ("pulled", "backend"))

    def test_pulling_line_is_ignored(self):
        self.assertIsNone(
            M.parse_build_line(" Image ghcr.io/tenstorrent/tt-studio/backend:sha-3f6cccd191d2 Pulling ")
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
