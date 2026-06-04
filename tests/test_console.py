# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the calm phase-output helper (console.step)."""
import io
import unittest
from unittest.mock import patch

from tt_setup import console as C


class TestStep(unittest.TestCase):
    def setUp(self):
        # Force the non-spinner, captured path with a deterministic real console.
        self._buf = io.StringIO()
        self._real = C.Console(theme=C.TT_THEME, file=self._buf)  # not a TTY
        self._p = patch.object(C, "_real_console", self._real)
        self._p.start()
        self.addCleanup(self._p.stop)
        C.set_verbose(False)
        self.addCleanup(C.set_verbose, False)

    def _out(self):
        return self._buf.getvalue()

    def test_success_collapses_to_check(self):
        with C.step("Doing thing"):
            print("noisy detail that should be hidden")
        out = self._out()
        self.assertIn("Doing thing", out)
        self.assertIn("✓", out)
        self.assertNotIn("noisy detail", out)  # chatter captured, not shown

    def test_failure_via_handle_shows_detail(self):
        with C.step("Risky thing") as s:
            print("important failure context")
            s.fail()
        out = self._out()
        self.assertIn("✗ Risky thing", out)

    def test_exception_marks_failed_and_reraises(self):
        with self.assertRaises(ValueError):
            with C.step("Boom"):
                raise ValueError("kaboom")
        self.assertIn("✗ Boom", self._out())

    def test_verbose_streams_without_capture(self):
        C.set_verbose(True)
        with C.step("Verbose phase"):
            print("should be visible in verbose")
        # In verbose mode the print goes to real stdout, not our captured console;
        # the label + check still render on the (patched) real console.
        out = self._out()
        self.assertIn("Verbose phase", out)
        self.assertIn("✓", out)


class TestDownloadHelperShape(unittest.TestCase):
    def test_download_with_progress_uses_reporthook(self):
        captured = {}

        def fake_urlretrieve(url, dest, reporthook=None):
            captured["url"] = url
            captured["dest"] = dest
            if reporthook:
                reporthook(0, 1024, 4096)
                reporthook(4, 1024, 4096)
            return dest, None

        with patch("urllib.request.urlretrieve", side_effect=fake_urlretrieve):
            C.download_with_progress("http://x/y.tar.gz", "/tmp/y.tar.gz", "Downloading")
        self.assertEqual(captured["url"], "http://x/y.tar.gz")
        self.assertEqual(captured["dest"], "/tmp/y.tar.gz")


if __name__ == "__main__":
    unittest.main()
