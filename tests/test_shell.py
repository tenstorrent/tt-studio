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


def _devices(board_type, n):
    return [{"board_info": {"board_type": board_type}} for _ in range(n)]


class TestClassifyBoards(unittest.TestCase):
    def test_p300_x4_is_qb2(self):
        self.assertEqual(M._classify_boards(_devices("p300 local", 4)), "P300x2")

    def test_p300_x8_is_p300cx4(self):
        self.assertEqual(M._classify_boards(_devices("p300 local", 8)), "P300Cx4")

    def test_n300_x4_is_t3k(self):
        self.assertEqual(M._classify_boards(_devices("n300 remote", 4)), "T3K")

    def test_n150_x4(self):
        self.assertEqual(M._classify_boards(_devices("n150 local", 4)), "N150X4")

    def test_mixed_board_types_unclassified(self):
        mixed = [{"board_info": {"board_type": "n300 local"}},
                 {"board_info": {"board_type": "p300 local"}}]
        self.assertEqual(M._classify_boards(mixed), "")

    def test_empty_unclassified(self):
        self.assertEqual(M._classify_boards([]), "")


class TestDescribeBoard(unittest.TestCase):
    def test_qb2_boards_render_as_quietbox(self):
        self.assertEqual(M.describe_board("P300x2"), "QuietBox (QB2)")
        self.assertEqual(M.describe_board("P300Cx4"), "QuietBox (QB2)")

    def test_unknown_and_empty(self):
        self.assertEqual(M.describe_board("T3K"), "T3K")
        self.assertIsNone(M.describe_board(""))


class TestResolveHardwareLabel(unittest.TestCase):
    def test_ok_classified_no_qb2(self):
        label, warn = M.resolve_hardware_label("ok", "4 device(s)", "P300x2", False)
        self.assertEqual(label, "QuietBox (QB2) · 4 device(s)")
        self.assertIsNone(warn)

    def test_qb2_confirmed(self):
        label, warn = M.resolve_hardware_label("ok", "4 device(s)", "P300x2", True)
        self.assertEqual(label, "QuietBox (QB2) · 4 device(s)")
        self.assertIsNone(warn)

    def test_qb2_mismatch_warns(self):
        label, warn = M.resolve_hardware_label("ok", "4 device(s)", "T3K", True)
        self.assertIn("⚠", label)
        self.assertIn("T3K", label)
        self.assertIsNotNone(warn)

    def test_qb2_unconfirmed_when_tt_smi_bad(self):
        label, warn = M.resolve_hardware_label("bad", "exit 1", "", True)
        self.assertIn("⚠", label)
        self.assertIsNotNone(warn)

    def test_qb2_unconfirmed_when_tt_smi_missing(self):
        label, warn = M.resolve_hardware_label(None, "", "", True, hw_present=True)
        self.assertIn("⚠", label)
        self.assertIsNotNone(warn)

    def test_no_qb2_never_warns_on_other_board(self):
        label, warn = M.resolve_hardware_label("ok", "4 device(s)", "T3K", False)
        self.assertEqual(label, "T3K · 4 device(s)")
        self.assertIsNone(warn)

    def test_tt_smi_bad_without_qb2_reports_read_failure(self):
        label, warn = M.resolve_hardware_label("bad", "exit 1", "", False)
        self.assertIn("tt-smi couldn't read", label)
        self.assertIsNone(warn)

    def test_no_accelerator(self):
        label, warn = M.resolve_hardware_label(None, "", "", False, hw_present=False)
        self.assertEqual(label, "No accelerator (remote/cloud mode)")
        self.assertIsNone(warn)


if __name__ == "__main__":
    unittest.main()
