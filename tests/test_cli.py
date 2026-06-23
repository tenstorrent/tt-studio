# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Typer CLI: parsing, help, and dispatch (logic mocked)."""
import unittest
from unittest.mock import patch

from typer.testing import CliRunner

from tt_setup import cli as M

runner = CliRunner()


class TestCli(unittest.TestCase):
    def test_help_lists_flags(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        for flag in ("--dev", "--cleanup", "--help-env", "--fix-docker", "--no-sudo"):
            self.assertIn(flag, result.output)

    def test_unknown_flag_errors(self):
        result = runner.invoke(M.app, ["--definitely-not-a-flag"])
        self.assertEqual(result.exit_code, 2)

    def test_help_env_prints_and_exits_zero(self):
        # --help-env prints the env help and returns (no heavy setup runs).
        result = runner.invoke(M.app, ["--help-env"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Environment Variables Help", result.output)

    def test_cleanup_flag_dispatches_to_cleanup_resources(self):
        with patch.object(M, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--cleanup"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        # the parsed args carry cleanup=True
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup)

    def test_fix_docker_flag_dispatches(self):
        with patch.object(M, "fix_docker_issues", return_value=True) as fix:
            result = runner.invoke(M.app, ["--fix-docker"])
        fix.assert_called_once()
        self.assertEqual(result.exit_code, 0)

    def test_main_is_callable_entrypoint(self):
        self.assertTrue(callable(M.main))


if __name__ == "__main__":
    unittest.main()
