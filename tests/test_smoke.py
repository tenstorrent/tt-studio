# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Smoke tests: the entrypoint imports and argparse builds/exits cleanly."""
import sys
import contextlib
import io
import unittest
from unittest.mock import patch

import run


class TestSmoke(unittest.TestCase):
    def test_import_exposes_main(self):
        self.assertTrue(callable(run.main))

    def test_help_exits_zero(self):
        with patch.object(sys, "argv", ["run.py", "--help"]):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit) as cm:
                run.main()
        self.assertEqual(cm.exception.code, 0)
        self.assertIn("TT Studio", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
