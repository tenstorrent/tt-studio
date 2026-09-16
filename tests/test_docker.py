# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for docker command building/access."""
import unittest
from unittest.mock import patch, MagicMock

try:
    from tt_setup import docker as M
except ImportError:  # pre-refactor
    import run as M


class TestBuildDockerComposeCommand(unittest.TestCase):
    def test_base_command_no_hardware(self):
        with patch.object(M, "detect_tt_hardware", return_value=False), patch(
            "os.path.exists", return_value=False
        ):
            cmd = M.build_docker_compose_command(dev_mode=False, quiet=True)
        self.assertEqual(cmd[:3], ["docker", "compose", "-f"])
        self.assertEqual(cmd[3], M.DOCKER_COMPOSE_FILE)

    def test_dev_mode_adds_dev_override(self):
        with patch.object(M, "detect_tt_hardware", return_value=False), patch(
            "os.path.exists", return_value=True
        ):
            cmd = M.build_docker_compose_command(dev_mode=True, quiet=True)
        self.assertIn(M.DOCKER_COMPOSE_DEV_FILE, cmd)

    def test_hardware_adds_hardware_override(self):
        with patch.object(M, "detect_tt_hardware", return_value=True), patch(
            "os.path.exists", return_value=True
        ):
            cmd = M.build_docker_compose_command(dev_mode=False, quiet=True)
        self.assertIn(M.DOCKER_COMPOSE_TT_HARDWARE_FILE, cmd)

    def test_env_file_passed_when_present(self):
        with patch.object(M, "detect_tt_hardware", return_value=False), patch(
            "os.path.exists", return_value=True
        ):
            cmd = M.build_docker_compose_command(dev_mode=False, quiet=True)
        self.assertIn("--env-file", cmd)
        self.assertEqual(cmd[cmd.index("--env-file") + 1], M.ENV_FILE_PATH)

    def test_no_env_file_when_absent(self):
        with patch.object(M, "detect_tt_hardware", return_value=False), patch(
            "os.path.exists", return_value=False
        ):
            cmd = M.build_docker_compose_command(dev_mode=False, quiet=True)
        self.assertNotIn("--env-file", cmd)


class TestDetectForeignTTStudioStacks(unittest.TestCase):
    OUR_APP_DIR = __import__("os").path.dirname(M.DOCKER_COMPOSE_FILE)

    def test_own_stack_is_not_foreign(self):
        ps = MagicMock(returncode=0, stdout=f"{self.OUR_APP_DIR}\n")
        with patch.object(M.subprocess, "run", return_value=ps):
            self.assertEqual(M.detect_foreign_tt_studio_stacks(), [])

    def test_other_checkouts_stack_is_reported(self):
        ps = MagicMock(returncode=0, stdout=f"/srv/other-tt-studio/app\n{self.OUR_APP_DIR}\n")
        with patch.object(M.subprocess, "run", return_value=ps):
            self.assertEqual(M.detect_foreign_tt_studio_stacks(), ["/srv/other-tt-studio/app"])

    def test_docker_failure_reports_nothing(self):
        # A machine without Docker running must not be blocked by this check.
        with patch.object(M.subprocess, "run", side_effect=OSError("no docker")):
            self.assertEqual(M.detect_foreign_tt_studio_stacks(), [])
        ps = MagicMock(returncode=1, stdout="")
        with patch.object(M.subprocess, "run", return_value=ps):
            self.assertEqual(M.detect_foreign_tt_studio_stacks(), [])


class TestStopTTStudioStack(unittest.TestCase):
    def test_stops_and_removes_all_stack_containers(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            if cmd[:3] == ["docker", "ps", "-q"]:
                # First ps lists the stack's containers; the ps after the
                # stop/rm shows nothing left.
                return MagicMock(returncode=0, stdout="" if len(calls) > 3 else "aaa\nbbb\n")
            return MagicMock(returncode=0, stdout="")

        with patch.object(M.subprocess, "run", side_effect=fake_run):
            self.assertTrue(M.stop_tt_studio_stack("/srv/other-tt-studio/app"))
        self.assertIn(["docker", "stop", "aaa", "bbb"], calls)
        self.assertIn(["docker", "rm", "-f", "aaa", "bbb"], calls)

    def test_nothing_running_is_success(self):
        ps = MagicMock(returncode=0, stdout="")
        with patch.object(M.subprocess, "run", return_value=ps):
            self.assertTrue(M.stop_tt_studio_stack("/srv/other-tt-studio/app"))

    def test_survivors_mean_failure(self):
        ps = MagicMock(returncode=0, stdout="aaa\n")
        with patch.object(M.subprocess, "run", return_value=ps):
            self.assertFalse(M.stop_tt_studio_stack("/srv/other-tt-studio/app"))


class TestCheckDockerAccess(unittest.TestCase):
    def test_true_when_docker_info_succeeds(self):
        ok = MagicMock(returncode=0)
        with patch("subprocess.run", return_value=ok):
            self.assertTrue(M.check_docker_access())

    def test_false_when_docker_info_fails(self):
        bad = MagicMock(returncode=1)
        with patch("subprocess.run", return_value=bad):
            self.assertFalse(M.check_docker_access())


if __name__ == "__main__":
    unittest.main()
