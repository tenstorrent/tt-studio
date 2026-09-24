# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for logs_control.support_email (backend twin of tt_setup/support_email.py).

Pure-function tests only — no Django settings or running stack needed:
    cd app/backend && python -m pytest logs_control/test_support_email.py -v
The SupportEmailView endpoint is exercised against a live stack (see PR notes);
tests/test_support_email.py at the repo root holds the twin-parity check.
"""

import datetime
import email
import email.policy
import os
import sys
import unittest
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from logs_control import support_email  # noqa: E402


class TestAssigneeRotation(unittest.TestCase):
    def test_covers_all_three_assignees(self):
        # ISO weeks 33/34/35 of 2026 → indices 0/1/2.
        self.assertEqual(
            support_email.assignee_for_date(datetime.date(2026, 8, 12))[0], "Anirudh"
        )
        self.assertEqual(
            support_email.assignee_for_date(datetime.date(2026, 8, 19))[0], "Jashan"
        )
        self.assertEqual(
            support_email.assignee_for_date(datetime.date(2026, 8, 26))[0], "Raheem"
        )

    def test_defaults_to_today(self):
        self.assertIn(support_email.assignee_for_date(), support_email.ROTATION)

    def test_rotation_addresses(self):
        self.assertEqual(
            [email for _, email in support_email.ROTATION],
            [
                "aramchandran@tenstorrent.com",
                "jashansingh@tenstorrent.com",
                "rnabeel@tenstorrent.com",
            ],
        )


class TestBuilders(unittest.TestCase):
    def test_subject(self):
        self.assertEqual(
            support_email.build_subject("Deploy hangs", "ttbr-abc"),
            "[TT-Studio] Deploy hangs [ttbr-abc]",
        )
        self.assertEqual(
            support_email.build_subject("", "ttbr-abc"),
            "[TT-Studio] Bug report [ttbr-abc]",
        )

    def test_body_header_lines(self):
        body = support_email.build_body(
            "ttbr-abc",
            ("Raheem", "rnabeel@tenstorrent.com"),
            {"title": "t"},
            ["OS: Linux"],
            "tt-studio-logs-ttbr-abc.zip",
        )
        lines = body.splitlines()
        self.assertEqual(lines[0], "Assignee: Raheem <rnabeel@tenstorrent.com>")
        self.assertEqual(lines[1], "Reference: ttbr-abc")
        self.assertIn("tt-studio-logs-ttbr-abc.zip", body)
        self.assertIn("IMPORTANT: attach tt-studio-logs-ttbr-abc.zip", body)

    def test_body_attached_variant(self):
        body = support_email.build_body(
            "ttbr-abc", ("Raheem", "rnabeel@tenstorrent.com"), {}, [],
            "tt-studio-logs-ttbr-abc.zip", attached=True,
        )
        self.assertIn("tt-studio-logs-ttbr-abc.zip is attached", body)
        self.assertNotIn("IMPORTANT: attach", body)

    def test_mailto_url_encoding_and_truncation(self):
        url = support_email.build_mailto_url("a subject", "x" * 5000)
        self.assertTrue(url.startswith("mailto:support@tenstorrent.com?subject="))
        self.assertNotIn("+", url)  # quote(safe=""), never quote_plus
        body = unquote(url.split("&body=")[1])
        self.assertLessEqual(len(body), support_email._MAX_MAILTO_BODY)
        self.assertTrue(body.endswith("[truncated — full details in the attached ZIP]"))


class TestEml(unittest.TestCase):
    """build_eml: a ready-to-send message with the ZIP attached."""

    ZIP = b"PK\x03\x04fake-zip-bytes"

    def _message(self):
        raw = support_email.build_eml(
            "[TT-Studio] Deploy hangs [ttbr-1]",
            "Assignee: X\nReference: ttbr-1\n\nbody \u2014 text",
            self.ZIP,
            "tt-studio-logs-ttbr-1.zip",
        )
        self.assertIsInstance(raw, bytes)
        return email.message_from_bytes(raw, policy=email.policy.default)

    def test_headers(self):
        msg = self._message()
        self.assertEqual(msg["To"], "support@tenstorrent.com")
        self.assertEqual(msg["Subject"], "[TT-Studio] Deploy hangs [ttbr-1]")
        self.assertEqual(msg["X-Unsent"], "1")  # Outlook: open as an editable draft
        self.assertIsNotNone(msg["Date"])

    def test_body_text(self):
        body = self._message().get_body(preferencelist=("plain",)).get_content()
        self.assertEqual(body.rstrip("\n"), "Assignee: X\nReference: ttbr-1\n\nbody \u2014 text")

    def test_zip_attached_verbatim(self):
        attachments = list(self._message().iter_attachments())
        self.assertEqual(len(attachments), 1)
        att = attachments[0]
        self.assertEqual(att.get_filename(), "tt-studio-logs-ttbr-1.zip")
        self.assertEqual(att.get_content_type(), "application/zip")
        self.assertEqual(att.get_content(), self.ZIP)


if __name__ == "__main__":
    unittest.main()
