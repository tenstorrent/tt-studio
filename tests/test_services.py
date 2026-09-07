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

# Docker Control lifecycle helpers live in the _docker_control submodule.
try:
    from tt_setup.services import _docker_control as _dc_mod
except ImportError:
    _dc_mod = M


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


class TestDockerControlAdoptsHealthyService(unittest.TestCase):
    """A healthy service on 8002 must be adopted, never replaced.

    Regression guard: the adopt check used to run AFTER the port was freed, so it
    could never succeed. Every `python run.py` therefore spawned another
    supervisor, and because the port was freed by killing only the listener, the
    previous supervisor respawned it and the two fought over 8002. They
    accumulated across runs (five were seen, restart counters in the thousands).
    Each change of ownership dropped in-flight image pulls, which surfaced in the
    UI as an unexplained "Deployment failed".
    """

    def test_healthy_service_is_adopted_without_killing_or_spawning(self):
        with patch.object(_dc_mod, "check_docker_access", return_value=True), \
             patch.object(_dc_mod, "_service_is_healthy", return_value=True), \
             patch.object(_dc_mod, "kill_process_on_port") as kill_port, \
             patch.object(_dc_mod, "_stop_previous_supervisor") as stop_prev, \
             patch.object(_dc_mod, "subprocess") as sub:
            result = _dc_mod.start_docker_control_service()

        self.assertTrue(result)
        kill_port.assert_not_called()
        stop_prev.assert_not_called()
        sub.Popen.assert_not_called()

    def test_unhealthy_port_holder_stops_previous_supervisor_first(self):
        """Killing the listener alone leaves its restart loop to respawn it."""
        call_order = []
        with patch.object(_dc_mod, "check_docker_access", return_value=True), \
             patch.object(_dc_mod, "_service_is_healthy", return_value=False), \
             patch.object(_dc_mod, "_stop_previous_supervisor",
                          side_effect=lambda **kw: call_order.append("stop_supervisor")), \
             patch.object(_dc_mod, "check_port_available",
                          side_effect=lambda *a, **kw: call_order.append("check_port") or False), \
             patch.object(_dc_mod, "kill_process_on_port",
                          side_effect=lambda *a, **kw: call_order.append("kill_port") or False):
            result = _dc_mod.start_docker_control_service()

        self.assertFalse(result)  # could not free the port
        self.assertEqual(call_order[0], "stop_supervisor",
                         "the previous supervisor must be stopped before the port is freed")
        self.assertIn("kill_port", call_order)


class TestDockerControlSupervisorPid(unittest.TestCase):
    def test_reads_pid_written_by_wrapper(self):
        with tempfile.NamedTemporaryFile("w", suffix=".pid", delete=False) as f:
            f.write("4242\n")
            path = f.name
        with patch.object(_dc_mod, "DOCKER_CONTROL_PID_FILE", path):
            self.assertEqual(_dc_mod._read_supervisor_pid(), 4242)
        os.unlink(path)

    def test_missing_file_returns_none(self):
        with patch.object(_dc_mod, "DOCKER_CONTROL_PID_FILE", "/nonexistent/xyz.pid"):
            self.assertIsNone(_dc_mod._read_supervisor_pid())

    def test_garbage_contents_return_none(self):
        with tempfile.NamedTemporaryFile("w", suffix=".pid", delete=False) as f:
            f.write("not-a-pid")
            path = f.name
        with patch.object(_dc_mod, "DOCKER_CONTROL_PID_FILE", path):
            self.assertIsNone(_dc_mod._read_supervisor_pid())
        os.unlink(path)

    def test_dead_previous_supervisor_is_not_signalled(self):
        with patch.object(_dc_mod, "_read_supervisor_pid", return_value=4242), \
             patch.object(_dc_mod, "_process_is_alive", return_value=False), \
             patch.object(_dc_mod, "_terminate_pid") as term:
            _dc_mod._stop_previous_supervisor()
        term.assert_not_called()

    def test_live_previous_supervisor_is_terminated(self):
        with patch.object(_dc_mod, "_read_supervisor_pid", return_value=4242), \
             patch.object(_dc_mod, "_process_is_alive", return_value=True), \
             patch.object(_dc_mod, "_terminate_pid") as term:
            _dc_mod._stop_previous_supervisor()
        term.assert_called_once()
        self.assertEqual(term.call_args[0][0], 4242)


class TestDockerControlRestartLoopIsBounded(unittest.TestCase):
    """An unbounded loop turned a permanent fault (port taken) into thousands of
    restarts and an ever-growing log, hiding the real cause."""

    def _wrapper_source(self):
        import inspect
        return inspect.getsource(_dc_mod.start_docker_control_service)

    def test_loop_gives_up_after_repeated_rapid_failures(self):
        src = self._wrapper_source()
        self.assertIn("MAX_CONSECUTIVE_FAILURES", src)
        self.assertIn("CONSECUTIVE_FAILURES", src)
        self.assertNotIn("while true; do\n    \"$3/bin/uvicorn\"", src,
                         "the bare unbounded loop must be gone")

    def test_a_long_healthy_run_resets_the_failure_budget(self):
        src = self._wrapper_source()
        self.assertIn("MIN_HEALTHY_SECONDS", src)
        self.assertIn("CONSECUTIVE_FAILURES=0", src)

    def test_giving_up_points_at_the_port(self):
        src = self._wrapper_source()
        self.assertIn("8002", src)
        self.assertIn("Giving up", src)
