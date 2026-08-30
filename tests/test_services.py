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

try:
    from tt_setup.services import _docker_control as _docker_control_mod
except ImportError:
    _docker_control_mod = M


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


class TestContainerHealth(unittest.TestCase):
    def test_probe_container_health_uses_docker_inspect(self):
        result = MagicMock(returncode=0, stdout="healthy\n")
        with patch("subprocess.run", return_value=result) as run:
            self.assertTrue(M.probe_container_health("tt_studio_docker_control"))
        self.assertIn("docker", run.call_args.args[0])
        self.assertIn("tt_studio_docker_control", run.call_args.args[0])

    def test_probe_container_health_rejects_starting_container(self):
        result = MagicMock(returncode=0, stdout="starting\n")
        with patch("subprocess.run", return_value=result):
            self.assertFalse(M.probe_container_health("tt_studio_docker_control"))


class TestLegacyDockerControlCleanup(unittest.TestCase):
    def test_stops_identified_listener_when_pid_file_is_missing(self):
        legacy_command = f"python {M.DOCKER_CONTROL_SERVICE_DIR}/start_docker_control.py"

        def run_command(command, **kwargs):
            if command[0] == "lsof":
                return MagicMock(stdout="4242\n", returncode=0)
            if command[0] == "ps":
                return MagicMock(stdout=legacy_command, returncode=0)
            self.fail(f"Unexpected command: {command}")

        def kill_process(pid, sig):
            if sig == 0:
                raise ProcessLookupError

        with tempfile.TemporaryDirectory() as directory, \
             patch.object(_docker_control_mod, "DOCKER_CONTROL_PID_FILE", os.path.join(directory, "missing.pid")), \
             patch.object(_docker_control_mod.subprocess, "run", side_effect=run_command), \
             patch.object(_docker_control_mod.os, "kill", side_effect=kill_process) as kill, \
             patch.object(_docker_control_mod.time, "sleep"):
            M.cleanup_docker_control_service(no_sudo=True)

        kill.assert_any_call(4242, _docker_control_mod.signal.SIGTERM)
        self.assertNotIn(
            unittest.mock.call(4242, _docker_control_mod.signal.SIGKILL),
            kill.call_args_list,
        )

    def test_stale_pid_file_does_not_hide_identified_listener(self):
        legacy_command = f"python {M.DOCKER_CONTROL_SERVICE_DIR}/start_docker_control.py"

        def run_command(command, **kwargs):
            if command[0] == "lsof":
                return MagicMock(stdout="4242\n", returncode=0)
            if command[0] == "ps" and command[2] == "9999":
                return MagicMock(stdout="python unrelated_service.py", returncode=0)
            if command[0] == "ps" and command[2] == "4242":
                return MagicMock(stdout=legacy_command, returncode=0)
            self.fail(f"Unexpected command: {command}")

        def kill_process(pid, sig):
            if sig == 0:
                raise ProcessLookupError

        with tempfile.TemporaryDirectory() as directory:
            pid_file = os.path.join(directory, "docker-control.pid")
            with open(pid_file, "w") as handle:
                handle.write("9999")
            with patch.object(_docker_control_mod, "DOCKER_CONTROL_PID_FILE", pid_file), \
                 patch.object(_docker_control_mod.subprocess, "run", side_effect=run_command), \
                 patch.object(_docker_control_mod.os, "kill", side_effect=kill_process) as kill, \
                 patch.object(_docker_control_mod.time, "sleep"):
                M.cleanup_docker_control_service(no_sudo=True)

        kill.assert_any_call(4242, _docker_control_mod.signal.SIGTERM)

    def test_leaves_unidentified_port_8002_listener_running(self):
        def run_command(command, **kwargs):
            if command[0] == "lsof":
                return MagicMock(stdout="4242\n", returncode=0)
            if command[0] == "ps":
                return MagicMock(stdout="python unrelated_service.py", returncode=0)
            self.fail(f"Unexpected command: {command}")

        with tempfile.TemporaryDirectory() as directory, \
             patch.object(_docker_control_mod, "DOCKER_CONTROL_PID_FILE", os.path.join(directory, "missing.pid")), \
             patch.object(_docker_control_mod.subprocess, "run", side_effect=run_command), \
             patch.object(_docker_control_mod.os, "kill") as kill:
            M.cleanup_docker_control_service(no_sudo=True)

        kill.assert_not_called()


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


class TestWaitForPortRelease(unittest.TestCase):
    def test_returns_true_as_soon_as_the_port_frees(self):
        states = iter([False, False, True])
        with patch.object(_ports_mod, "check_port_available", lambda p: next(states)), \
             patch.object(_ports_mod.time, "sleep", lambda s: None):
            self.assertTrue(_ports_mod.wait_for_port_release(8002, timeout=5, interval=0))

    def test_gives_up_after_the_timeout(self):
        clock = iter([0.0, 0.0, 10.0])
        with patch.object(_ports_mod, "check_port_available", return_value=False), \
             patch.object(_ports_mod.time, "monotonic", lambda: next(clock)), \
             patch.object(_ports_mod.time, "sleep", lambda s: None):
            self.assertFalse(_ports_mod.wait_for_port_release(8002, timeout=1, interval=0))


class TestKillProcessOnPortWaitsForRelease(unittest.TestCase):
    """The bind-after-kill race: a killed uvicorn --reload hands its socket to a
    child, so one kill can leave the port taken."""

    def test_retries_until_the_port_is_actually_free(self):
        released = iter([False, True])
        with patch.object(_ports_mod, "_kill_port_holder", return_value=True) as kill, \
             patch.object(_ports_mod, "wait_for_port_release", lambda p: next(released)):
            self.assertTrue(_ports_mod.kill_process_on_port(8002, quiet=True))
        self.assertEqual(kill.call_count, 2)

    def test_docker_holder_is_returned_untouched(self):
        with patch.object(_ports_mod, "_kill_port_holder", return_value="docker"):
            self.assertEqual(_ports_mod.kill_process_on_port(8002, quiet=True), "docker")

    def test_reports_failure_when_the_port_never_frees(self):
        with patch.object(_ports_mod, "_kill_port_holder", return_value=True), \
             patch.object(_ports_mod, "wait_for_port_release", return_value=False), \
             patch.object(_ports_mod, "check_port_available", return_value=False):
            self.assertFalse(_ports_mod.kill_process_on_port(8002, quiet=True, attempts=2))


class TestDiagnoseServiceLog(unittest.TestCase):
    def test_address_in_use(self):
        log = ("INFO:     Will watch for changes in these directories: ['/x']\n"
               "ERROR:    [Errno 98] Address already in use")
        d = M.diagnose_service_log(log, port=8002, log_file="/tmp/dc.log")
        self.assertIn("8002", d["cause"])
        self.assertIn("Errno 98", d["evidence"])
        self.assertTrue(any("lsof -i :8002" in a for a in d["actions"]))

    def test_missing_dependency(self):
        d = M.diagnose_service_log("ModuleNotFoundError: No module named 'fastapi'")
        self.assertIn("dependency", d["cause"])
        self.assertTrue(any(".venv" in a for a in d["actions"]))

    def test_permission_denied_points_at_docker_access(self):
        d = M.diagnose_service_log("PermissionError: [Errno 13] Permission denied: /var/run/docker.sock")
        self.assertIn("permission", d["cause"])

    def test_unrecognized_log_falls_back_to_the_log_file(self):
        d = M.diagnose_service_log("INFO: started\nINFO: waiting", log_file="/tmp/x.log")
        self.assertIn("health check", d["cause"])
        self.assertEqual(d["actions"], ["tail -50 /tmp/x.log"])

    def test_empty_log_is_safe(self):
        d = M.diagnose_service_log("", port=8001, log_file="/tmp/x.log")
        self.assertEqual(d["evidence"], "")


if __name__ == "__main__":
    unittest.main()

