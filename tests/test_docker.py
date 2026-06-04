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
