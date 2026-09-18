# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for service helpers (ports, git, frontend config)."""
import os
import signal
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
    from tt_setup.services import _docker_control as _docker_control_mod
except ImportError:
    _docker_control_mod = M

# FastAPI lifecycle helpers live in the _fastapi submodule.
try:
    from tt_setup.services import _fastapi as _fa_mod
except ImportError:
    _fa_mod = M


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
             patch.object(_ports_mod, "run_command", side_effect=lambda cmd, **kw: MagicMock(returncode=0)), \
             patch.object(_docker_control_mod, "kill_process_on_port"), \
             patch.object(_ports_mod.time, "sleep"):
            M.cleanup_docker_control_service(no_sudo=True)

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

        with tempfile.TemporaryDirectory() as directory:
            pid_file = os.path.join(directory, "docker-control.pid")
            with open(pid_file, "w") as handle:
                handle.write("9999")
            with patch.object(_docker_control_mod, "DOCKER_CONTROL_PID_FILE", pid_file), \
                 patch.object(_docker_control_mod.subprocess, "run", side_effect=run_command), \
                 patch.object(_ports_mod, "run_command", side_effect=lambda cmd, **kw: MagicMock(returncode=0)), \
                 patch.object(_docker_control_mod, "kill_process_on_port"), \
                 patch.object(_ports_mod.time, "sleep"):
                M.cleanup_docker_control_service(no_sudo=True)

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
             patch.object(_ports_mod, "_terminate_pid_graceful_then_force") as term:
            M.cleanup_docker_control_service(no_sudo=True)

        term.assert_not_called()

    def test_cleanup_terminates_supervisor_wrapper_first(self):
        legacy_command = f"python {M.DOCKER_CONTROL_SERVICE_DIR}/start_docker_control.py"
        supervisor_command = f"/bin/bash /tmp/tmp_supervisor.sh {M.DOCKER_CONTROL_SERVICE_DIR} /path/to/pid .venv log"

        terminated = []

        def fake_run_command(cmd, **kwargs):
            if cmd[0] == "lsof":
                return MagicMock(stdout="4242\n", returncode=0)
            if cmd[0] == "ps":
                p = cmd[cmd.index("-p") + 1] if "-p" in cmd else ""
                if p == "4242":
                    if "ppid=" in cmd:
                        return MagicMock(stdout="1111\n", returncode=0)
                    return MagicMock(stdout=legacy_command, returncode=0)
                if p == "1111":
                    if "ppid=" in cmd:
                        return MagicMock(stdout="1\n", returncode=0)
                    return MagicMock(stdout=supervisor_command, returncode=0)
                return MagicMock(stdout="", returncode=0)
            if cmd[0] == "kill" and cmd[1] == "-15":
                terminated.append(int(cmd[2]))
                return MagicMock(returncode=0)
            if cmd[0] == "kill" and cmd[1] == "-0":
                return MagicMock(returncode=1)  # process dead
            return MagicMock(returncode=0)

        with tempfile.TemporaryDirectory() as directory, \
             patch.object(_docker_control_mod, "DOCKER_CONTROL_PID_FILE", os.path.join(directory, "missing.pid")), \
             patch.object(_docker_control_mod.subprocess, "run", side_effect=fake_run_command), \
             patch.object(_ports_mod, "run_command", side_effect=fake_run_command), \
             patch.object(_ports_mod.time, "sleep"):
            M.cleanup_docker_control_service(no_sudo=True)

        self.assertEqual(terminated, [1111, 4242],
                         "Supervisor wrapper (1111) must be terminated before listener child (4242)")

class TestGetBackendPort(unittest.TestCase):
    def test_default_is_8000(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch("tt_setup.env_config._dotenv.ENV_FILE_PATH", "/nonexistent/.env"):
            self.assertEqual(M.get_backend_port(), 8000)

    def test_env_override(self):
        with patch.dict(os.environ, {"BACKEND_PORT": "8010"}), \
             patch("tt_setup.env_config._dotenv.ENV_FILE_PATH", "/nonexistent/.env"):
            self.assertEqual(M.get_backend_port(), 8010)

    def test_garbage_value_falls_back_to_default(self):
        with patch.dict(os.environ, {"BACKEND_PORT": "not-a-port"}), \
             patch("tt_setup.env_config._dotenv.ENV_FILE_PATH", "/nonexistent/.env"):
            self.assertEqual(M.get_backend_port(), 8000)


class TestFindAvailablePort(unittest.TestCase):
    def test_returns_start_port_when_free(self):
        with patch.object(_ports_mod, "check_port_available", return_value=True):
            self.assertEqual(M.find_available_port(8000), 8000)

    def test_skips_occupied_and_reserved_ports(self):
        # 8000 is busy; 8001/8002 are reserved for the inference server and
        # docker-control even when they look free — the scan must land on 8003.
        free = {8003}
        with patch.object(_ports_mod, "check_port_available", side_effect=lambda p: p in free):
            self.assertEqual(M.find_available_port(8000), 8003)

    def test_returns_none_when_nothing_free(self):
        with patch.object(_ports_mod, "check_port_available", return_value=False):
            self.assertIsNone(M.find_available_port(8000, max_tries=5))


class TestResolveBackendPort(unittest.TestCase):
    def test_keeps_configured_port_when_free(self):
        with patch.object(_ports_mod, "check_port_available", return_value=True):
            self.assertEqual(M.resolve_backend_port(8000), (8000, False))

    def test_keeps_port_held_by_own_backend_container(self):
        # A restart: our backend container publishes 8000. Compose recreates
        # it, so the port must be kept rather than incremented away.
        with patch.object(_ports_mod, "check_port_available", return_value=False), \
             patch.object(_ports_mod, "_port_published_by_backend", return_value=True):
            self.assertEqual(M.resolve_backend_port(8000), (8000, False))

    def test_increments_past_a_foreign_listener(self):
        free = {8003}
        with patch.object(_ports_mod, "check_port_available", side_effect=lambda p: p in free), \
             patch.object(_ports_mod, "_port_published_by_backend", return_value=False):
            self.assertEqual(M.resolve_backend_port(8000), (8003, True))

    def test_falls_back_to_configured_port_when_scan_finds_nothing(self):
        with patch.object(_ports_mod, "check_port_available", return_value=False), \
             patch.object(_ports_mod, "_port_published_by_backend", return_value=False):
            self.assertEqual(M.resolve_backend_port(8000), (8000, False))


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


class TestSupervisorGhostSelfTermination(unittest.TestCase):
    """Regression guards for Issue #1307:
    Supervisor wrappers must exit immediately (code 0) when the PID file is
    removed (by --stop / --purge-all) or overwritten by another launcher run,
    preventing orphaned ghost loops from surviving and fighting for ports."""

    def test_fastapi_dev_wrapper_checks_pid_file_and_ownership(self):
        import inspect
        src = inspect.getsource(_fa_mod.start_fastapi_server)
        self.assertIn('[ ! -f "$2" ]', src, "must verify PID file still exists")
        self.assertIn('"$(cat "$2" 2>/dev/null)" != "$$"', src, "must verify PID still matches wrapper PID")
        self.assertIn("Exiting ghost loop", src)
        self.assertIn("exit 0", src)


class TestSupervisorTreeTraversal(unittest.TestCase):
    """Regression guards for Issue #1307:
    Freeing a port held by a supervisor's child must climb the process tree
    and terminate the supervisor wrapper first, preventing restart loops."""

    def test_is_supervisor_wrapper_detection(self):
        # Matches Linux temp wrapper
        self.assertTrue(_ports_mod._is_supervisor_wrapper(
            "/bin/bash /tmp/tmpera45p4b.sh /path/to/docker-control-service /path/to/pid .venv log"
        ))
        # Matches macOS temp wrapper
        self.assertTrue(_ports_mod._is_supervisor_wrapper(
            "/bin/bash /var/folders/zb/tmpcjb01kdb.sh /path/to/docker-control-service"
        ))
        # Matches inference-api wrapper
        self.assertTrue(_ports_mod._is_supervisor_wrapper(
            "/bin/bash /tmp/tmp12345.sh /path/to/inference-api"
        ))
        # Does not match regular processes or arbitrary user scripts in /tmp
        self.assertFalse(_ports_mod._is_supervisor_wrapper("/usr/bin/python3 app.py"))
        self.assertFalse(_ports_mod._is_supervisor_wrapper("com.docker.backend"))
        self.assertFalse(_ports_mod._is_supervisor_wrapper("node server.js"))
        self.assertFalse(_ports_mod._is_supervisor_wrapper("/bin/bash /tmp/ci_job_step.sh"))
        self.assertFalse(_ports_mod._is_supervisor_wrapper("/bin/bash /var/folders/zb/T/my_launcher.sh"))
        self.assertFalse(_ports_mod._is_supervisor_wrapper("/bin/bash -c source /tmp/session-snapshot.sh && eval 'ls /tmp'"))
        self.assertFalse(_ports_mod._is_supervisor_wrapper("/home/user/docker-control-service/.venv/bin/python3.12 .venv/bin/uvicorn api:app --reload"))

    def test_find_supervisor_wrapper_pid_climbs_tree(self):
        # Simulate worker (300) -> reloader (200) -> supervisor (100) -> init (1)
        tree = {300: 200, 200: 100, 100: 1}
        cmds = {
            300: "python uvicorn api:app",
            200: "/path/to/docker-control-service/.venv/bin/python .venv/bin/uvicorn api:app --reload",
            100: "/bin/bash /tmp/tmp_supervisor.sh /path/to/docker-control-service",
            1: "init",
        }
        with patch.object(_ports_mod, "_get_parent_pid", side_effect=lambda p, **kw: tree.get(p)), \
             patch.object(_ports_mod, "_get_process_command", side_effect=lambda p, **kw: cmds.get(p, "")):
            supervisor_pid = _ports_mod._find_supervisor_wrapper_pid(300)
        self.assertEqual(supervisor_pid, 100)

    def test_process_inspection_does_not_use_sudo(self):
        with patch.object(_ports_mod, "run_command") as mock_run_cmd:
            mock_run_cmd.return_value = MagicMock(returncode=0, stdout="123\n", stderr="")
            ppid = _ports_mod._get_parent_pid(456)
            self.assertEqual(ppid, 123)
            mock_run_cmd.assert_called_with(["ps", "-o", "ppid=", "-p", "456"], check=False, capture_output=True)

            mock_run_cmd.return_value = MagicMock(returncode=0, stdout="/bin/bash script.sh\n", stderr="")
            cmd = _ports_mod._get_process_command(456)
            self.assertEqual(cmd, "/bin/bash script.sh")
            mock_run_cmd.assert_called_with(["ps", "-o", "command=", "-p", "456"], check=False, capture_output=True)

    def test_terminate_pid_graceful_then_force_graceful_exit(self):
        run_calls = []
        def fake_run_command(cmd, **kwargs):
            run_calls.append(cmd)
            if cmd[:2] == ["kill", "-0"]:
                return MagicMock(returncode=1)
            return MagicMock(returncode=0)

        with patch.object(_ports_mod, "run_command", side_effect=fake_run_command), \
             patch.object(_ports_mod.time, "sleep"):
            success = _ports_mod._terminate_pid_graceful_then_force(999, quiet=True)

        self.assertTrue(success)
        self.assertEqual(run_calls, [["kill", "-15", "999"], ["kill", "-0", "999"]])

    def test_terminate_pid_graceful_then_force_escalates_to_force_kill(self):
        run_calls = []
        def fake_run_command(cmd, **kwargs):
            run_calls.append(cmd)
            if cmd[:2] == ["kill", "-0"]:
                return MagicMock(returncode=0)
            return MagicMock(returncode=0)

        with patch.object(_ports_mod, "run_command", side_effect=fake_run_command), \
             patch.object(_ports_mod.time, "sleep"), \
             patch.object(_ports_mod.time, "time", side_effect=[100.0, 100.0, 108.0]):
            success = _ports_mod._terminate_pid_graceful_then_force(999, timeout=7.0, quiet=True)

        self.assertTrue(success)
        self.assertEqual(run_calls, [
            ["kill", "-15", "999"],
            ["kill", "-0", "999"],
            ["kill", "-9", "999"],
        ])

    def test_kill_port_holder_terminates_supervisor_first(self):
        terminated = []
        with patch.object(_ports_mod, "shutil") as mock_shutil, \
             patch.object(_ports_mod, "run_command") as mock_run_cmd, \
             patch.object(_ports_mod, "_process_is_docker", return_value=False), \
             patch.object(_ports_mod, "_find_supervisor_wrapper_pid", return_value=100), \
             patch.object(_ports_mod, "_terminate_pid_graceful_then_force",
                          side_effect=lambda p, **kw: terminated.append(p) or True):
            mock_shutil.which.return_value = "/usr/bin/lsof"
            # Return PID 300 for lsof
            mock_run_cmd.return_value = MagicMock(returncode=0, stdout="300\n", stderr="")
            result = _ports_mod._kill_port_holder(8002, no_sudo=True, quiet=True)

        self.assertTrue(result)
        self.assertEqual(terminated, [100, 300],
                         "supervisor (100) must be terminated before listener child (300)")

    def test_kill_port_holder_fails_if_supervisor_termination_fails(self):
        with patch.object(_ports_mod, "shutil") as mock_shutil, \
             patch.object(_ports_mod, "run_command") as mock_run_cmd, \
             patch.object(_ports_mod, "_process_is_docker", return_value=False), \
             patch.object(_ports_mod, "_find_supervisor_wrapper_pid", return_value=100), \
             patch.object(_ports_mod, "_terminate_pid_graceful_then_force", return_value=False):
            mock_shutil.which.return_value = "/usr/bin/lsof"
            mock_run_cmd.return_value = MagicMock(returncode=0, stdout="300\n", stderr="")
            result = _ports_mod._kill_port_holder(8002, no_sudo=True, quiet=True)

        self.assertFalse(result, "kill_port_holder must return False if supervisor wrapper termination fails")


if __name__ == "__main__":
    unittest.main()

