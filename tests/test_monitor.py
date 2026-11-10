# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the interactive monitor and non-TTY status fallback."""
import sys
import unittest
from unittest.mock import MagicMock, patch

from tt_setup import monitor as M

try:
    import textual
    from tt_setup import monitor_app as M_app
    HAS_TEXTUAL = True
except (ImportError, ModuleNotFoundError):
    HAS_TEXTUAL = False


class TestMonitorStatus(unittest.TestCase):
    def test_compose_base(self):
        with patch("tt_setup.docker.build_docker_compose_command", return_value=["docker", "compose"]) as mock_cmd:
            res = M._compose_base(dev_mode=True)
            self.assertEqual(res, ["docker", "compose"])
            mock_cmd.assert_called_once_with(dev_mode=True, show_hardware_info=False, quiet=True)

    def test_print_text_snapshot(self):
        mock_http = {"http://localhost:3000/": True, f"http://localhost:{M._BACKEND_PORT}/up/": False}
        mock_container = {M.DOCKER_CONTROL_CONTAINER_NAME: True}

        with patch.object(M, "snapshot_health", return_value=mock_http) as mock_sh, \
             patch.object(M, "snapshot_container_health", return_value=mock_container) as mock_sch, \
             patch("tt_setup.console.console.print") as mock_print:
            code = M._print_text_snapshot()
            self.assertEqual(code, 0)
            mock_sh.assert_called_once()
            mock_sch.assert_called_once()
            mock_print.assert_called_once()

    def test_run_status_non_tty(self):
        with patch("sys.stdout.isatty", return_value=False), \
             patch.object(M, "_print_text_snapshot", return_value=0) as mock_snapshot:
            self.assertEqual(M.run_status(), 0)
            mock_snapshot.assert_called_once()

    def test_run_status_missing_textual(self):
        orig_import = __import__
        def fake_import(name, *args, **kwargs):
            if name == "tt_setup.monitor_app":
                raise ModuleNotFoundError("No module named 'textual'", name="textual")
            return orig_import(name, *args, **kwargs)

        with patch("sys.stdout.isatty", return_value=True), \
             patch("builtins.__import__", side_effect=fake_import), \
             patch.object(M, "_print_text_snapshot", return_value=0) as mock_snapshot, \
             patch("tt_setup.console.console.print"):
            self.assertEqual(M.run_status(), 0)
            mock_snapshot.assert_called_once()

    def test_run_status_tty_success(self):
        mock_app_class = MagicMock()
        with patch("sys.stdout.isatty", return_value=True), \
             patch.dict("sys.modules", {"tt_setup.monitor_app": MagicMock(MonitorApp=mock_app_class)}):
            self.assertEqual(M.run_status(dev_mode=True), 0)
            mock_app_class.assert_called_once_with(dev_mode=True)
            mock_app_class.return_value.run.assert_called_once()


@unittest.skipUnless(HAS_TEXTUAL, "textual is not installed in this environment")
class TestMonitorApp(unittest.IsolatedAsyncioTestCase):
    async def test_monitor_app_headless(self):
        with patch("tt_setup.monitor_app.subprocess.Popen"), \
             patch("tt_setup.monitor_app.snapshot_health", return_value={}), \
             patch("tt_setup.monitor_app.snapshot_container_health", return_value={}):
            app = M_app.MonitorApp(dev_mode=True)
            async with app.run_test() as pilot:
                self.assertTrue(pilot.app.is_running)
                await pilot.press("q")
