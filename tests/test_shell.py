# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for shell/output helpers."""
import unittest
from unittest.mock import patch

try:
    from tt_setup import shell as M
except ImportError:  # pre-refactor
    import run as M


class TestRunCommand(unittest.TestCase):
    def test_echo_captures_stdout(self):
        result = M.run_command(["echo", "hello"])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "hello")

    def test_failing_command_without_check_returns_result(self):
        result = M.run_command(["false"], check=False)
        self.assertNotEqual(result.returncode, 0)

    def test_missing_binary_exits(self):
        with self.assertRaises(SystemExit):
            M.run_command(["definitely-not-a-real-binary-xyz"])


class TestClearLines(unittest.TestCase):
    def test_non_positive_is_noop(self):
        with patch("sys.stdout") as out:
            M.clear_lines(0)
            out.write.assert_not_called()

    def test_clears_requested_lines(self):
        with patch("sys.stdout") as out:
            M.clear_lines(3)
            self.assertEqual(out.write.call_count, 3)


class TestCopyToClipboard(unittest.TestCase):
    def test_returns_false_on_exception(self):
        with patch.object(M, "OS_NAME", "Linux"), patch(
            "subprocess.Popen", side_effect=Exception("nope")
        ):
            self.assertFalse(M.copy_to_clipboard("text"))


if __name__ == "__main__":
    unittest.main()
