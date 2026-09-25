# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for tt_setup.support_email — the support-email draft builders — plus a
parity check against the backend twin (app/backend/logs_control/support_email.py)."""

import datetime
import email
import email.policy
import importlib.util
import os
import unittest
from urllib.parse import unquote

from tt_setup import support_email

_BACKEND_TWIN = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "app", "backend", "logs_control", "support_email.py",
)


def _load_backend_twin():
    spec = importlib.util.spec_from_file_location("backend_support_email", _BACKEND_TWIN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestAssigneeRotation(unittest.TestCase):
    def test_covers_all_three_assignees(self):
        # ISO weeks 33/34/35 of 2026 → indices 0/1/2.
        self.assertEqual(
            support_email.assignee_for_date(datetime.date(2026, 8, 12))[0], "Anirudh"
        )  # week 33
        self.assertEqual(
            support_email.assignee_for_date(datetime.date(2026, 8, 19))[0], "Jashan"
        )  # week 34
        self.assertEqual(
            support_email.assignee_for_date(datetime.date(2026, 8, 26))[0], "Raheem"
        )  # week 35

    def test_stable_within_a_week(self):
        monday = datetime.date(2026, 8, 24)
        sunday = datetime.date(2026, 8, 30)
        self.assertEqual(
            support_email.assignee_for_date(monday),
            support_email.assignee_for_date(sunday),
        )

    def test_year_boundary_still_resolves(self):
        # Jan 1 2027 falls in ISO week 53 of 2026; just needs to map to a slot.
        name, email = support_email.assignee_for_date(datetime.date(2027, 1, 1))
        self.assertIn((name, email), support_email.ROTATION)

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


class TestSubject(unittest.TestCase):
    def test_with_title(self):
        self.assertEqual(
            support_email.build_subject("Deploy hangs at 0%", "ttbr-abc123"),
            "[TT-Studio] Deploy hangs at 0% [ttbr-abc123]",
        )

    def test_without_title(self):
        self.assertEqual(
            support_email.build_subject("", "ttbr-abc123"),
            "[TT-Studio] Bug report [ttbr-abc123]",
        )
        self.assertEqual(
            support_email.build_subject(None, "ttbr-abc123"),
            "[TT-Studio] Bug report [ttbr-abc123]",
        )

    def test_long_title_truncated(self):
        subject = support_email.build_subject("x" * 300, "ttbr-abc123")
        self.assertLess(len(subject), 150)
        self.assertTrue(subject.endswith(" [ttbr-abc123]"))

    def test_multiline_title_collapses(self):
        # e.g. a multi-line exception message on the launcher's error path —
        # a line break would make build_eml raise.
        subject = support_email.build_subject("Deploy failed:\n  timeout\r\n", "ttbr-abc123")
        self.assertEqual(subject, "[TT-Studio] Deploy failed: timeout [ttbr-abc123]")
        support_email.build_eml(subject, "body", b"zip", "logs.zip")


class TestBody(unittest.TestCase):
    def _body(self, form=None):
        return support_email.build_body(
            "ttbr-abc123",
            ("Jashan", "jashansingh@tenstorrent.com"),
            form or {},
            ["OS: Linux", "Python: 3.11.4"],
            "tt-studio-logs-ttbr-abc123.zip",
        )

    def test_machine_readable_header_lines(self):
        lines = self._body().splitlines()
        self.assertEqual(lines[0], "Assignee: Jashan <jashansingh@tenstorrent.com>")
        self.assertEqual(lines[1], "Reference: ttbr-abc123")

    def test_mentions_zip_and_environment(self):
        body = self._body()
        self.assertIn("tt-studio-logs-ttbr-abc123.zip", body)
        self.assertIn("OS: Linux", body)

    def test_form_fields_and_placeholders(self):
        body = self._body({"title": "It broke", "steps": "1. deploy"})
        self.assertIn("It broke", body)
        self.assertIn("1. deploy", body)
        self.assertIn("_fill in_", body)  # unfilled fields keep placeholders

    def test_expected_actual_only_when_given(self):
        self.assertNotIn("## Expected / Actual", self._body({"title": "It broke"}))
        self.assertIn(
            "## Expected / Actual\nloads / hangs",
            self._body({"expected": "loads", "actual": "hangs"}),
        )

    def test_attach_reminder_vs_attached(self):
        # mailto: path — the user has to attach the ZIP by hand.
        self.assertIn("IMPORTANT: attach tt-studio-logs-ttbr-abc123.zip", self._body())
        # .eml path — the ZIP is already attached.
        attached = support_email.build_body(
            "ttbr-abc123", ("Jashan", "jashansingh@tenstorrent.com"), {}, [],
            "tt-studio-logs-ttbr-abc123.zip", attached=True,
        )
        self.assertIn("tt-studio-logs-ttbr-abc123.zip is attached", attached)
        self.assertNotIn("IMPORTANT: attach", attached)


class TestMailtoUrl(unittest.TestCase):
    def test_shape_and_encoding(self):
        url = support_email.build_mailto_url("[TT-Studio] Bug report [r]", "line one\nline two")
        self.assertTrue(url.startswith("mailto:support@tenstorrent.com?subject="))
        self.assertIn("&body=", url)
        # Spaces must be %20 — a literal '+' would render as-is in mail clients.
        self.assertNotIn("+", url)
        self.assertIn("%20", url)
        self.assertIn("%0A", url)

    def test_round_trips(self):
        subject = "[TT-Studio] Deploy hangs [ttbr-1]"
        url = support_email.build_mailto_url(subject, "body text")
        encoded_subject = url.split("subject=")[1].split("&body=")[0]
        self.assertEqual(unquote(encoded_subject), subject)

    def test_long_body_truncated(self):
        url = support_email.build_mailto_url("s", "x" * 5000)
        body = unquote(url.split("&body=")[1])
        self.assertLessEqual(len(body), support_email._MAX_MAILTO_BODY)
        self.assertTrue(body.endswith("[truncated — full details in the attached ZIP]"))

    def test_short_body_untouched(self):
        url = support_email.build_mailto_url("s", "short body")
        self.assertEqual(unquote(url.split("&body=")[1]), "short body")


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


class TestBackendTwinParity(unittest.TestCase):
    """The backend copy must behave identically — same rotation, same output."""

    def test_twin_outputs_match(self):
        twin = _load_backend_twin()
        self.assertEqual(twin.ROTATION, support_email.ROTATION)
        self.assertEqual(twin.SUPPORT_EMAIL, support_email.SUPPORT_EMAIL)

        d = datetime.date(2026, 8, 26)
        self.assertEqual(twin.assignee_for_date(d), support_email.assignee_for_date(d))

        args = (
            "ttbr-xyz",
            ("Anirudh", "aramchandran@tenstorrent.com"),
            {"title": "t", "description": "d"},
            ["OS: Linux"],
            "tt-studio-logs-ttbr-xyz.zip",
        )
        self.assertEqual(twin.build_body(*args), support_email.build_body(*args))
        with_expected = args[:2] + ({"expected": "e", "actual": "a"},) + args[3:]
        self.assertEqual(
            twin.build_body(*with_expected), support_email.build_body(*with_expected)
        )
        self.assertEqual(
            twin.build_subject("t", "ttbr-xyz"), support_email.build_subject("t", "ttbr-xyz")
        )
        self.assertEqual(
            twin.build_mailto_url("s", "b"), support_email.build_mailto_url("s", "b")
        )
        self.assertEqual(
            twin.build_body(*args, attached=True), support_email.build_body(*args, attached=True)
        )

        # Date header and MIME boundary differ per call; compare the parsed parts.
        def parts(raw):
            msg = email.message_from_bytes(raw, policy=email.policy.default)
            att = next(msg.iter_attachments())
            return (
                msg["To"], msg["Subject"], msg["X-Unsent"],
                msg.get_body(preferencelist=("plain",)).get_content(),
                att.get_filename(), att.get_content_type(), att.get_content(),
            )

        eml_args = ("s", "b \u2014 body", b"PK\x03\x04zip", "tt-studio-logs-ttbr-xyz.zip")
        self.assertEqual(parts(twin.build_eml(*eml_args)), parts(support_email.build_eml(*eml_args)))


if __name__ == "__main__":
    unittest.main()
