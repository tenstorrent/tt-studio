# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for tt_setup.bug_report — the .eml written next to the bundle, and
which draft `--report-bug` opens."""

import email
import email.policy
import os
import subprocess
import tempfile
import unittest
from unittest import mock

from tt_setup import bug_report, support_email

_REF = "ttbr-0123456789ab"


def _write_zip(directory):
    path = os.path.join(directory, f"tt-studio-logs-{_REF}.zip")
    with open(path, "wb") as f:
        f.write(b"PK\x05\x06" + b"\x00" * 18)  # an empty ZIP archive
    return path


class TestWriteEml(unittest.TestCase):
    def test_writes_eml_with_bundle_attached(self):
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = _write_zip(tmp)
            eml_path = bug_report.write_eml(zip_path, _REF, "[TT-Studio] Bug report", "body")
            self.assertEqual(eml_path, os.path.join(tmp, f"tt-studio-bug-report-{_REF}.eml"))
            with open(eml_path, "rb") as f:
                msg = email.message_from_binary_file(f, policy=email.policy.default)
            with open(zip_path, "rb") as f:
                zip_bytes = f.read()

        self.assertEqual(msg["To"], support_email.SUPPORT_EMAIL)
        self.assertEqual(msg["Subject"], "[TT-Studio] Bug report")
        self.assertEqual(msg["X-Unsent"], "1")
        (attachment,) = list(msg.iter_attachments())
        self.assertEqual(attachment.get_filename(), f"tt-studio-logs-{_REF}.zip")
        self.assertEqual(attachment.get_content(), zip_bytes)


class TestOpenInMailClient(unittest.TestCase):
    def _popen(self, returncode=0, still_running=False):
        proc = mock.Mock()
        if still_running:
            proc.wait.side_effect = subprocess.TimeoutExpired("xdg-open", 5)
        else:
            proc.wait.return_value = returncode
        return mock.patch.object(bug_report.subprocess, "Popen", return_value=proc)

    def test_headless_linux_opens_nothing(self):
        with mock.patch.object(bug_report.sys, "platform", "linux"), mock.patch.dict(
            os.environ, {"DISPLAY": "", "WAYLAND_DISPLAY": ""}
        ), self._popen() as popen:
            self.assertFalse(bug_report.open_in_mail_client("/x.eml"))
        popen.assert_not_called()

    def test_linux_desktop_uses_xdg_open(self):
        with mock.patch.object(bug_report.sys, "platform", "linux"), mock.patch.dict(
            os.environ, {"DISPLAY": ":0"}
        ), self._popen() as popen:
            self.assertTrue(bug_report.open_in_mail_client("/x.eml"))
        self.assertEqual(popen.call_args.args[0], ["xdg-open", "/x.eml"])

    def test_macos_uses_open(self):
        with mock.patch.object(bug_report.sys, "platform", "darwin"), self._popen() as popen:
            self.assertTrue(bug_report.open_in_mail_client("/x.eml"))
        self.assertEqual(popen.call_args.args[0], ["open", "/x.eml"])

    def test_opener_failure(self):
        with mock.patch.object(bug_report.sys, "platform", "darwin"), self._popen(returncode=4):
            self.assertFalse(bug_report.open_in_mail_client("/x.eml"))

    def test_opener_still_running_counts_as_opened(self):
        with mock.patch.object(bug_report.sys, "platform", "darwin"), self._popen(
            still_running=True
        ):
            self.assertTrue(bug_report.open_in_mail_client("/x.eml"))

    def test_opener_missing(self):
        with mock.patch.object(bug_report.sys, "platform", "darwin"), mock.patch.object(
            bug_report.subprocess, "Popen", side_effect=FileNotFoundError
        ):
            self.assertFalse(bug_report.open_in_mail_client("/x.eml"))


class TestReportBug(unittest.TestCase):
    """The .eml carries the bundle, so report_bug opens it and never the
    attachment-less mailto: draft, unless the .eml couldn't be written."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.zip_path = _write_zip(tmp.name)
        self.eml_path = os.path.join(tmp.name, f"tt-studio-bug-report-{_REF}.eml")
        self.console = self._patch("console")
        self._patch("collect_bundle", return_value=(self.zip_path, _REF))
        self.open_eml = self._patch("open_in_mail_client", return_value=True)
        patcher = mock.patch.object(bug_report.webbrowser, "open", return_value=True)
        self.open_mailto = patcher.start()
        self.addCleanup(patcher.stop)

    def _patch(self, name, **kwargs):
        patcher = mock.patch.object(bug_report, name, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def _printed(self):
        return "\n".join(str(c.args[0]) for c in self.console.print.call_args_list if c.args)

    def test_opens_the_eml_not_the_mailto_draft(self):
        bug_report.report_bug()
        self.assertTrue(os.path.isfile(self.eml_path))
        self.open_eml.assert_called_once_with(self.eml_path)
        self.open_mailto.assert_not_called()
        self.assertNotIn("No mail client opened", self._printed())

    def test_points_at_the_eml_when_nothing_opens(self):
        self.open_eml.return_value = False
        bug_report.report_bug()
        self.open_mailto.assert_not_called()
        printed = self._printed()
        self.assertIn("open the .eml above", printed)
        self.assertNotIn("compose manually", printed)

    def test_no_browser_opens_nothing(self):
        bug_report.report_bug(open_browser=False)
        self.open_eml.assert_not_called()
        self.open_mailto.assert_not_called()
        self.assertIn("open the .eml above", self._printed())

    def test_falls_back_to_mailto_without_an_eml(self):
        self._patch("write_eml", side_effect=OSError("disk full"))
        bug_report.report_bug()
        self.open_eml.assert_not_called()
        self.open_mailto.assert_called_once()
        self.assertTrue(self.open_mailto.call_args.args[0].startswith("mailto:"))


if __name__ == "__main__":
    unittest.main()
