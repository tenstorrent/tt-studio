# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Smoke tests for the CLI entrypoint / argument parsing."""
import sys
import contextlib
import io
import unittest
from unittest.mock import patch

try:
    from tt_setup import cli as M
except ImportError:  # pre-refactor
    import run as M


class TestCli(unittest.TestCase):
    def test_unknown_flag_errors(self):
        with patch.object(sys, "argv", ["run.py", "--definitely-not-a-flag"]):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
                M.main()
        self.assertEqual(cm.exception.code, 2)

    def test_help_env_prints_and_returns(self):
        with patch.object(sys, "argv", ["run.py", "--help-env"]):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                M.main()
        self.assertIn("Environment Variables Help", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
