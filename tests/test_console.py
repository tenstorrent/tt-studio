# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the calm phase-output helper (console.step)."""
import io
import unittest
from unittest.mock import patch

from tt_setup import console as C
# After the subpackage split, step()/download_with_progress read _real_console from
# the _steps submodule's namespace, so patches of it must target _steps.
from tt_setup.console import _steps as _steps_mod


class TestStep(unittest.TestCase):
    def setUp(self):
        # Force the non-spinner, captured path with a deterministic real console.
        self._buf = io.StringIO()
        self._real = C.Console(theme=C.TT_THEME, file=self._buf)  # not a TTY
        self._p = patch.object(_steps_mod, "_real_console", self._real)
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


class TestPhaseTitles(unittest.TestCase):
    """The phase COUNT is fixed, but the word follows what the run decided to do:
    a phase titled "Build" while it pulls makes the user decode the output."""

    def setUp(self):
        C.register_setup_phases()

    def _titles(self):
        from tt_setup.console import _stepper
        return [p.title for p in _stepper._checklist.phases]

    def test_begin_phase_title_overrides_the_roadmap(self):
        self.assertIn("Build", self._titles())
        handle = C.begin_phase(4, 5, "Pull")
        self.assertIn("Pull", self._titles())
        self.assertNotIn("Build", self._titles())
        C.end_phase(handle)

    def test_rename_phase_mid_run(self):
        handle = C.begin_phase(4, 5, "Pull")
        C.rename_phase(4, "Build")       # the pull fell back to a local build
        self.assertIn("Build", self._titles())
        C.end_phase(handle)

    def test_phase_count_is_untouched_by_renames(self):
        before = len(self._titles())
        handle = C.begin_phase(4, 5, "Pull")
        C.rename_phase(4, "Build")
        C.end_phase(handle)
        self.assertEqual(len(self._titles()), before)

    def test_unknown_index_rename_is_a_noop(self):
        C.rename_phase(99, "Nope")       # never raise on an error path
        self.assertNotIn("Nope", self._titles())


if __name__ == "__main__":
    unittest.main()
