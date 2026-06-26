# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for service helpers (ports, git, frontend config)."""
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

try:
    from tt_setup import services as M
except ImportError:  # pre-refactor
    import run as M


class TestGetFrontendConfig(unittest.TestCase):
    def test_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            host, port, timeout = M.get_frontend_config()
        self.assertEqual(host, "localhost")
        self.assertEqual(port, 3000)
        self.assertEqual(timeout, 60)

    def test_env_overrides(self):
        env = {"FRONTEND_HOST": "h", "FRONTEND_PORT": "8080", "FRONTEND_TIMEOUT": "5"}
        with patch.dict(os.environ, env):
            host, port, timeout = M.get_frontend_config()
        self.assertEqual((host, port, timeout), ("h", 8080, 5))


class TestIsValidGitRepo(unittest.TestCase):
    def test_missing_dir_returns_none(self):
        self.assertIsNone(M.is_valid_git_repo("/nonexistent/path/xyz"))

    def test_non_git_dir_returns_false(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(M.is_valid_git_repo(d))

    def test_real_repo_returns_true(self):
        # The project root is a git repository.
        self.assertTrue(M.is_valid_git_repo(M.TT_STUDIO_ROOT))


class TestCheckPortAvailable(unittest.TestCase):
    def test_available_when_nothing_listening(self):
        lsof = MagicMock(stdout="", returncode=1)
        nc = MagicMock(stdout="", returncode=1)
        with patch("subprocess.run", side_effect=[lsof, nc]):
            self.assertTrue(M.check_port_available(12345))

    def test_unavailable_when_listener_present(self):
        lsof = MagicMock(stdout="999\n", returncode=0)
        nc = MagicMock(stdout="", returncode=0)
        with patch("subprocess.run", side_effect=[lsof, nc]):
            self.assertFalse(M.check_port_available(12345))


class TestPortFreeingNeverKillsDocker(unittest.TestCase):
    """Regression guard: on macOS/Docker Desktop a *published* container port is
    held by `com.docker.backend`. The port-freeing step must NOT kill that PID —
    doing so crashes the Docker engine, and the later build then fails with
    "Cannot connect to the Docker daemon"."""

    def test_kill_process_on_port_leaves_docker_alone(self):
        # lsof finds a PID holding the port; that PID belongs to Docker.
        kill_calls = []

        def fake_run_command(cmd, **kwargs):
            if any("lsof" in str(c) for c in cmd):
                return MagicMock(returncode=0, stdout="4242\n", stderr="")
            kill_calls.append(cmd)          # any kill / check-alive command
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch.object(M, "run_command", side_effect=fake_run_command), \
             patch("shutil.which", return_value="/usr/bin/lsof"), \
             patch.object(M, "_process_is_docker", return_value=True):
            result = M.kill_process_on_port(3000, no_sudo=True, quiet=True)

        self.assertEqual(result, "docker")
        self.assertFalse(
            any("kill" in str(c) for c in kill_calls),
            "must never run kill on a Docker-owned process holding the port",
        )

    def test_check_and_free_ports_treats_docker_held_as_ok(self):
        # A Docker-held port is not a failure — compose recreates our own
        # containers, so startup should proceed (ok=True, nothing reported failed).
        with patch.object(M, "check_port_available", return_value=False), \
             patch.object(M, "kill_process_on_port", return_value="docker"):
            ok, failed = M.check_and_free_ports([(3000, "Frontend")], no_sudo=True)

        self.assertTrue(ok)
        self.assertEqual(failed, [])

    def test_non_docker_holder_is_still_freed(self):
        # A genuine foreign process on the port is still killed (returns True).
        with patch.object(M, "check_port_available", return_value=False), \
             patch.object(M, "kill_process_on_port", return_value=True):
            ok, failed = M.check_and_free_ports([(8080, "Agent Service")], no_sudo=True)

        self.assertTrue(ok)
        self.assertEqual(failed, [])


if __name__ == "__main__":
    unittest.main()
