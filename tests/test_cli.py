# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Typer CLI: parsing, help, and dispatch (logic mocked)."""
import re
import unittest
from unittest.mock import patch

from typer.testing import CliRunner

from tt_setup import cli as M
# Dispatch (cleanup_resources / fix_docker_issues) now lives in the _run submodule;
# patches must target it so _run's calls are intercepted.
try:
    from tt_setup.cli import _run as _cli_run
except ImportError:
    _cli_run = M

runner = CliRunner()


class TestCli(unittest.TestCase):
    def test_help_lists_flags(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        for flag in ("--dev", "--stop", "--purge-all", "--help-env", "--no-sudo",
                     "--logs", "--info"):
            self.assertIn(flag, output_without_ansi)

    def test_info_flag_dispatches_to_ready_panel(self):
        with patch.object(_cli_run, "show_ready_panel") as ready:
            result = runner.invoke(M.app, ["--info"])
        self.assertEqual(result.exit_code, 0)
        ready.assert_called_once()

    def test_qb2_defaults_false_and_honors_true(self):
        # IS_QB2 is opt-in: unset defaults to false so the strict QB2 check only
        # runs when a QB2 machine (or the tt_qb2_launch release branch) opts in.
        with patch.object(_cli_run, "get_env_var", side_effect=lambda name, default="": default):
            self.assertFalse(_cli_run._qb2_configured())
        with patch.object(_cli_run, "get_env_var", side_effect=lambda name, default="": "true"):
            self.assertTrue(_cli_run._qb2_configured())
        with patch.object(_cli_run, "get_env_var", side_effect=lambda name, default="": "false"):
            self.assertFalse(_cli_run._qb2_configured())

    def test_help_hides_deprecated_aliases(self):
        # --cleanup/--cleanup-all and --fix-docker still work but must not clutter --help.
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertNotIn("--cleanup", result.output)
        self.assertNotIn("--fix-docker", result.output)

    def test_unknown_flag_errors(self):
        result = runner.invoke(M.app, ["--definitely-not-a-flag"])
        self.assertEqual(result.exit_code, 2)

    def test_reconfigure_inference_server_flag_and_alias(self):
        # Both the long flag and the --reconfig-inf alias set the same arg.
        # _run is patched so startup doesn't actually run.
        from tt_setup.cli import _args
        for flag in ("--reconfigure-inference-server", "--reconfig-inf"):
            with patch.object(_args, "_run") as run:
                result = runner.invoke(M.app, [flag])
            self.assertEqual(result.exit_code, 0)
            run.assert_called_once()
            args = run.call_args.args[0]
            self.assertTrue(args.reconfigure_inference_server, flag)

    def test_help_shows_reconfig_inf_alias(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("--reconfig-inf", result.output)

    def test_help_env_prints_and_exits_zero(self):
        # --help-env prints the env help and returns (no heavy setup runs).
        result = runner.invoke(M.app, ["--help-env"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Environment Variables Help", result.output)

    def test_stop_flag_dispatches_to_cleanup_resources(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--stop"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        # --stop is the plain teardown: cleanup=True, no full purge.
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup)
        self.assertFalse(ns.cleanup_all)

    def test_purge_all_flag_dispatches_to_cleanup_resources(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--purge-all"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        # --purge-all is the full reset; it also implies the stop trigger.
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup_all)
        self.assertTrue(ns.cleanup)

    def test_deprecated_cleanup_alias_still_works_and_warns(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--cleanup"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup)
        self.assertFalse(ns.cleanup_all)
        self.assertIn("deprecated", result.output)
        self.assertIn("--stop", result.output)

    def test_deprecated_cleanup_all_alias_still_works_and_warns(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--cleanup-all"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup_all)
        self.assertIn("deprecated", result.output)
        self.assertIn("--purge-all", result.output)

    def test_fix_docker_flag_dispatches(self):
        with patch.object(_cli_run, "fix_docker_issues", return_value=True) as fix:
            result = runner.invoke(M.app, ["--fix-docker"])
        fix.assert_called_once()
        self.assertEqual(result.exit_code, 0)

    def test_help_removes_completion_options(self):
        # add_completion=False drops the Typer-injected completion noise.
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertNotIn("--install-completion", result.output)
        self.assertNotIn("--show-completion", result.output)

    def test_help_groups_flags_into_panels(self):
        # Flags are cascaded into titled rich_help_panel sections, not one box.
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        for panel in (
            "Setup & Configuration",
            "Model Deployment",
            "Lifecycle",
            "Reset (--purge-all)",
            "Advanced",
            "Developer Tools",
            "Troubleshooting & Info",
        ):
            self.assertIn(panel, result.output)
        # Service-control flags live under Advanced now, not their own panel.
        self.assertNotIn("Service Control", result.output)

    def test_main_is_callable_entrypoint(self):
        self.assertTrue(callable(M.main))


if __name__ == "__main__":
    unittest.main()
