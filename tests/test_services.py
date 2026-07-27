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

# Port helpers moved to the _ports submodule; intra-module patches must target it.
try:
    from tt_setup.services import _ports as _ports_mod
except ImportError:
    _ports_mod = M

# Browser/health helpers live in the _health submodule; patch the names it looks
# up (wait_for_service_health, webbrowser) there.
try:
    from tt_setup.services import _health as _health_mod
except ImportError:
    _health_mod = M


class TestWaitForFrontendAndOpenBrowser(unittest.TestCase):
    """URL assembly for the browser open — path + optional auto-deploy query."""

    def _opened_url(self, **kwargs):
        with patch.object(_health_mod, "wait_for_service_health", return_value=True), \
             patch.object(_health_mod, "webbrowser") as wb:
            ok = _health_mod.wait_for_frontend_and_open_browser(**kwargs)
        self.assertTrue(ok)
        wb.open.assert_called_once()
        return wb.open.call_args[0][0]

    def test_plain_root(self):
        url = self._opened_url(host="localhost", port=3000)
        self.assertEqual(url, "http://localhost:3000/")

    def test_path_opens_subpage(self):
        url = self._opened_url(host="localhost", port=3000, path="models-deployed")
        self.assertEqual(url, "http://localhost:3000/models-deployed")

    def test_auto_deploy_without_device_id(self):
        url = self._opened_url(host="localhost", port=3000, auto_deploy_model="Qwen3-32B")
        self.assertIn("auto-deploy=Qwen3-32B", url)
        self.assertNotIn("device-id", url)  # unset -> backend allocates by model

    def test_auto_deploy_with_device_id(self):
        url = self._opened_url(host="localhost", port=3000,
                               auto_deploy_model="Qwen3-32B", device_id=2)
        self.assertIn("auto-deploy=Qwen3-32B", url)
        self.assertIn("device-id=2", url)

    def test_returns_false_when_frontend_never_ready(self):
        with patch.object(_health_mod, "wait_for_service_health", return_value=False), \
             patch.object(_health_mod, "webbrowser") as wb:
            ok = _health_mod.wait_for_frontend_and_open_browser(timeout=0)
        self.assertFalse(ok)
        wb.open.assert_not_called()


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

        with patch.object(_ports_mod, "run_command", side_effect=fake_run_command), \
             patch("shutil.which", return_value="/usr/bin/lsof"), \
             patch.object(_ports_mod, "_process_is_docker", return_value=True):
            result = M.kill_process_on_port(3000, no_sudo=True, quiet=True)

        self.assertEqual(result, "docker")
        self.assertFalse(
            any("kill" in str(c) for c in kill_calls),
            "must never run kill on a Docker-owned process holding the port",
        )

    def test_check_and_free_ports_treats_docker_held_as_ok(self):
        # A Docker-held port is not a failure — compose recreates our own
        # containers, so startup should proceed (ok=True, nothing reported failed).
        with patch.object(_ports_mod, "check_port_available", return_value=False), \
             patch.object(_ports_mod, "kill_process_on_port", return_value="docker"):
            ok, failed = M.check_and_free_ports([(3000, "Frontend")], no_sudo=True)

        self.assertTrue(ok)
        self.assertEqual(failed, [])

    def test_non_docker_holder_is_still_freed(self):
        # A genuine foreign process on the port is still killed (returns True).
        with patch.object(_ports_mod, "check_port_available", return_value=False), \
             patch.object(_ports_mod, "kill_process_on_port", return_value=True):
            ok, failed = M.check_and_free_ports([(8080, "Agent Service")], no_sudo=True)

        self.assertTrue(ok)
        self.assertEqual(failed, [])


if __name__ == "__main__":
    unittest.main()
