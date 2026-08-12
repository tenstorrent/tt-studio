# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for docker/compose diagnostics."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

try:
    from tt_setup import docker_diag as M
except ImportError:  # pre-refactor
    import run as M

try:
    from tt_setup.docker_diag import _diagnostics as _diag
except ImportError:  # pre-refactor
    _diag = M


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

    def test_clean_exit_0_is_not_reported_as_unknown_failure(self):
        # A clean exit is not an unrecognized failure (issue #1214).
        d = M.diagnose_container_failure("c", 0, "")
        self.assertEqual(d["cause"], "Exited cleanly")
        self.assertNotIn("Unknown", d["cause"])


class TestVerifyDockerContainers(unittest.TestCase):
    """Startup verification must judge only the Compose stack (issue #1214)."""

    def _run_with(self, stdout):
        recorded = {}

        def fake_run(cmd, **kwargs):
            recorded["cmd"] = cmd
            return SimpleNamespace(stdout=stdout, stderr="", returncode=0)

        with patch.object(_diag.subprocess, "run", side_effect=fake_run):
            return M.verify_docker_containers(), recorded["cmd"]

    def test_filters_on_compose_project_label_and_name(self):
        # Name alone is a substring match that catches tt_studio_app_* marketplace
        # containers; the label restricts it to Compose-managed containers, and the
        # name keeps an unrelated Compose project on the same host out.
        _, cmd = self._run_with("tt_studio_backend_api_dev\ttt_studio_backend\tUp 2 minutes\n")
        self.assertIn("name=tt_studio", cmd)
        self.assertIn("label=com.docker.compose.service", cmd)

    def test_parses_service_label_and_running_state(self):
        stdout = (
            "tt_studio_backend_api_dev\ttt_studio_backend\tUp 2 minutes (healthy)\n"
            "tt_studio_chroma_dev\ttt_studio_chroma\tExited (1) 3 minutes ago\n"
        )
        containers, _ = self._run_with(stdout)

        self.assertEqual(set(containers), {"tt_studio_backend_api_dev", "tt_studio_chroma_dev"})
        self.assertTrue(containers["tt_studio_backend_api_dev"]["running"])
        self.assertFalse(containers["tt_studio_chroma_dev"]["running"])
        self.assertEqual(containers["tt_studio_backend_api_dev"]["service"], "tt_studio_backend")

    def test_malformed_lines_are_skipped(self):
        containers, _ = self._run_with("garbage\n\ntt_studio_agent_dev\ttt_studio_agent\tUp 1 minute\n")
        self.assertEqual(list(containers), ["tt_studio_agent_dev"])


class TestFriendlyContainerName(unittest.TestCase):
    """Diagnosis panels must name the service, not the raw container (issue #1214)."""

    def test_resolves_through_compose_service_not_container_name(self):
        # Container names carry a mode suffix (_dev/_prod) the service name does
        # not, so the old raw-name lookup matched nothing in any mode.
        for container in ("tt_studio_backend_api_dev", "tt_studio_backend_api_prod"):
            self.assertEqual(
                _diag._friendly_container_name(container, {"service": "tt_studio_backend"}),
                "Backend",
            )

    def test_covers_litellm_gateway(self):
        self.assertEqual(
            _diag._friendly_container_name("tt_studio_litellm", {"service": "tt_studio_litellm"}),
            "LiteLLM gateway",
        )

    def test_falls_back_to_service_then_container_name(self):
        self.assertEqual(
            _diag._friendly_container_name("weird_name", {"service": "tt_studio_future"}),
            "tt_studio_future",
        )
        self.assertEqual(_diag._friendly_container_name("weird_name", {}), "weird_name")
        self.assertEqual(_diag._friendly_container_name("weird_name"), "weird_name")


# Real `docker compose pull` output (piped / non-TTY), captured from compose v2.
PULL_OK = """ Image python:3.12-slim Pulling 
 b3c7a9bdb4f2 Pulling fs layer 0B
 c85ad0bcaca8 Downloading 1.049MB
 c85ad0bcaca8 Downloading 12.11MB
 c85ad0bcaca8 Download complete 0B
 c85ad0bcaca8 Extracting 1B
 c85ad0bcaca8 Pull complete 0B
 Image python:3.12-slim Pulled
"""

PULL_MISSING = """ Image ghcr.io/tenstorrent/tt-studio/backend:sha-205aedf73de2 Pulling 
 Image alpine:3.19 Pulling 
 Image ghcr.io/tenstorrent/tt-studio/backend:sha-205aedf73de2 Error failed to resolve reference "ghcr.io/tenstorrent/tt-studio/backend:sha-205aedf73de2": ghcr.io/tenstorrent/tt-studio/backend:sha-205aedf73de2: not found
 Image alpine:3.19 Interrupted 
Error response from daemon: failed to resolve reference "ghcr.io/tenstorrent/tt-studio/backend:sha-205aedf73de2": ghcr.io/tenstorrent/tt-studio/backend:sha-205aedf73de2: not found
"""


class TestParsePullLine(unittest.TestCase):
    def test_image_status_line(self):
        self.assertEqual(
            M.parse_pull_line(" Image ghcr.io/tt/backend:sha-abc Pulled"),
            ("image", "ghcr.io/tt/backend:sha-abc", "Pulled", ""),
        )

    def test_image_error_line_keeps_detail(self):
        kind, ref, state, detail = M.parse_pull_line(
            ' Image ghcr.io/tt/backend:sha-abc Error failed to resolve reference "x": not found')
        self.assertEqual((kind, state), ("image", "Error"))
        self.assertTrue(detail.startswith("failed to resolve reference"))

    def test_layer_line_with_size(self):
        self.assertEqual(
            M.parse_pull_line(" c85ad0bcaca8 Downloading 12.11MB"),
            ("layer", "c85ad0bcaca8", "Downloading", 12110000.0),
        )

    def test_layer_line_without_size(self):
        self.assertEqual(
            M.parse_pull_line(" c85ad0bcaca8 Verifying Checksum"),
            ("layer", "c85ad0bcaca8", "Verifying Checksum", None),
        )

    def test_unrelated_line(self):
        self.assertIsNone(M.parse_pull_line("Error response from daemon: nope"))

    def test_short_image_name(self):
        self.assertEqual(M.short_image_name("ghcr.io/tenstorrent/tt-studio/backend:sha-abc"), "backend")
        self.assertEqual(M.short_image_name("python:3.12-slim"), "python")


class TestParseSizeAndFormat(unittest.TestCase):
    def test_decimal_units(self):
        self.assertEqual(M.parse_size("1.049MB"), 1049000.0)
        self.assertEqual(M.parse_size("512kB"), 512000.0)
        self.assertEqual(M.parse_size("0B"), 0.0)

    def test_bad_size(self):
        self.assertIsNone(M.parse_size(""))
        self.assertIsNone(M.parse_size("lots"))

    def test_format_bytes(self):
        self.assertEqual(M.format_bytes(0), "0 B")
        self.assertEqual(M.format_bytes(12_110_000), "12.1 MB")
        self.assertEqual(M.format_bytes(2_400_000_000), "2.4 GB")

    def test_progress_bar_fills(self):
        self.assertEqual(M.progress_bar(0, 0), "")
        self.assertEqual(M.progress_bar(0, 4, width=4), "▕░░░░▏")
        self.assertEqual(M.progress_bar(2, 4, width=4), "▕██░░▏")
        self.assertEqual(M.progress_bar(4, 4, width=4), "▕████▏")


class TestPullProgress(unittest.TestCase):
    def _feed(self, text):
        p = M.PullProgress()
        events = [p.feed(line) for line in text.splitlines()]
        return p, [e for e in events if e]

    def test_successful_pull_counts_image_and_bytes(self):
        p, events = self._feed(PULL_OK)
        self.assertEqual(events, [("pulled", "python")])
        self.assertEqual(p.counts(), (1, 1))
        # Per-layer lines restate a running total; completion re-reports 0B.
        self.assertEqual(p.bytes_downloaded(), 12110000.0)
        self.assertIn("1/1 images", p.activity())
        self.assertIn("12.1 MB", p.activity())

    def test_activity_before_any_output(self):
        self.assertEqual(M.PullProgress().activity(), "Pulling prebuilt images…")

    def test_failed_pull_records_failure_and_resolves_bar(self):
        p, events = self._feed(PULL_MISSING)
        self.assertEqual([e[0] for e in events], ["error"])
        self.assertEqual(events[0][1], "backend")
        self.assertEqual(len(p.failures), 1)
        # Errored images still count as resolved so the bar can complete.
        self.assertEqual(p.counts(), (1, 2))


class TestClassifyPullFailure(unittest.TestCase):
    def test_unpublished_tag(self):
        self.assertEqual(M.classify_pull_failure(PULL_MISSING), "unpublished")

    def test_auth_required(self):
        out = "Error response from daemon: unauthorized: authentication required"
        self.assertEqual(M.classify_pull_failure(out), "auth")

    def test_offline_wins_over_missing_manifest(self):
        out = ('failed to resolve reference: dial tcp: lookup ghcr.io: '
               'no such host\nmanifest unknown')
        self.assertEqual(M.classify_pull_failure(out), "unreachable")

    def test_empty_output(self):
        self.assertEqual(M.classify_pull_failure(""), "unknown")

    def test_unrecognized_output(self):
        self.assertEqual(M.classify_pull_failure("something odd happened"), "unknown")


if __name__ == "__main__":
    unittest.main()
