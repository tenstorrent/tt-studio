# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for StartupLogger."""
import os
import tempfile
import unittest

try:
    from tt_setup import logging as M
except ImportError:  # pre-refactor
    import run as M


class TestStartupLogger(unittest.TestCase):
    def test_writes_header_steps_and_summary(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "startup.log")
            log = M.StartupLogger(path)
            log.header("v1.2.3")
            log.step("docker", "START")
            log.step("docker", "DONE", "ok")
            log.summary(0)
            log.close()
            with open(path) as f:
                content = f.read()
        self.assertIn("TT Studio Startup Log", content)
        self.assertIn("v1.2.3", content)
        self.assertIn("docker", content)
        self.assertIn("Exit code : 0", content)
        self.assertIn("All steps completed successfully.", content)

    def test_summary_lists_failed_steps(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "startup.log")
            log = M.StartupLogger(path)
            log.step("env", "FAIL", "boom")
            log.summary(1)
            log.close()
            with open(path) as f:
                content = f.read()
        self.assertIn("Failed steps:", content)
        self.assertIn("env: boom", content)

    def test_fail_silent_on_unwritable_path(self):
        # A directory path is not writable as a file -> logger disables itself.
        with tempfile.TemporaryDirectory() as d:
            log = M.StartupLogger(d)  # d is a directory
            self.assertFalse(log._enabled)
            log.header("v")
            log.step("x")
            log.summary(0)
            log.close()


if __name__ == "__main__":
    unittest.main()
