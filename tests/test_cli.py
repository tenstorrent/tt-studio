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
    def tearDown(self):
        # --no-clear / --verbose set module-global rendering state; reset it so a
        # flag test doesn't leak the globals into later tests.
        from tt_setup import console
        console.set_no_clear(False)
        console.set_verbose(False)

    def test_help_lists_flags(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        for flag in ("--dev", "--stop", "--purge-all", "--help-env", "--no-sudo",
                     "--logs", "--info", "--uninstall", "--switch", "--no-clear"):
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
        # Strip ANSI: Rich interleaves color codes between characters when it
        # forces color (e.g. in CI), so match against the de-colored output.
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        self.assertIn("--reconfig-inf", output_without_ansi)

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

    def test_uninstall_runs_purge_then_removes_shortcut(self):
        with patch.object(_cli_run, "cleanup_resources", return_value=True) as cleanup, \
             patch.object(_cli_run, "uninstall_shortcut") as remove:
            result = runner.invoke(M.app, ["--uninstall"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        remove.assert_called_once()
        # --uninstall implies the full purge (and therefore the stop trigger).
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup_all)
        self.assertTrue(ns.cleanup)

    def test_uninstall_keeps_shortcut_when_purge_aborted(self):
        # Declining the purge confirmation aborts the whole uninstall.
        with patch.object(_cli_run, "cleanup_resources", return_value=False), \
             patch.object(_cli_run, "uninstall_shortcut") as remove:
            result = runner.invoke(M.app, ["--uninstall"])
        self.assertEqual(result.exit_code, 0)
        remove.assert_not_called()

    def test_switch_dispatches_with_ref(self):
        with patch.object(_cli_run, "switch_checkout", return_value=0) as switch:
            result = runner.invoke(M.app, ["--switch", "v2.9.0-rc1"])
        self.assertEqual(result.exit_code, 0)
        switch.assert_called_once_with("v2.9.0-rc1")

    def test_switch_requires_value(self):
        result = runner.invoke(M.app, ["--switch"])
        self.assertEqual(result.exit_code, 2)

    def test_switch_nonzero_exit_propagates(self):
        with patch.object(_cli_run, "switch_checkout", return_value=1):
            result = runner.invoke(M.app, ["--switch", "dev"])
        self.assertEqual(result.exit_code, 1)

    def test_no_clear_flag_sets_globals_and_implies_verbose(self):
        # --no-clear preserves the terminal's contents AND streams full detail, so
        # it flips both the no_clear and verbose rendering globals. _run is patched
        # so startup doesn't actually run.
        from tt_setup.cli import _args
        from tt_setup import console
        with patch.object(_args, "_run") as run:
            result = runner.invoke(M.app, ["--no-clear"])
        self.assertEqual(result.exit_code, 0)
        run.assert_called_once()
        self.assertTrue(console.no_clear())
        self.assertTrue(console.is_verbose())

    def test_main_is_callable_entrypoint(self):
        self.assertTrue(callable(M.main))


if __name__ == "__main__":
    unittest.main()
