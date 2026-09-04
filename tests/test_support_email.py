# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for tt_setup.support_email — the support-email draft builders — plus a
parity check against the backend twin (app/backend/logs_control/support_email.py)."""

import datetime
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
            ("Anirudh", "anirud@tenstorrent.com"),
            {"title": "t", "description": "d"},
            ["OS: Linux"],
            "tt-studio-logs-ttbr-xyz.zip",
        )
        self.assertEqual(twin.build_body(*args), support_email.build_body(*args))
        self.assertEqual(
            twin.build_subject("t", "ttbr-xyz"), support_email.build_subject("t", "ttbr-xyz")
        )
        self.assertEqual(
            twin.build_mailto_url("s", "b"), support_email.build_mailto_url("s", "b")
        )


if __name__ == "__main__":
    unittest.main()
