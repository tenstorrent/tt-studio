# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for logs_control/jira_client.py — all network calls mocked."""

import unittest
from unittest.mock import MagicMock, patch

from logs_control import jira_client as J

TABLE = {
    "default": "unknown",
    "components": {
        "backend": {
            "paths": ["app/backend/"],
            "log_sources": ["backend.log"],
            "github_owners": ["rnabeelTT"],
            "jira_email": "rnabeel@tenstorrent.com",
            "label": "component-backend",
        },
        "docker-control": {
            "paths": ["docker-control-service/"],
            "log_sources": ["docker-control-service.log"],
            "github_owners": ["rnabeelTT"],
            "jira_email": "rnabeel@tenstorrent.com",
            "label": "component-docker-control",
        },
        "unknown": {
            "paths": [],
            "log_sources": [],
            "github_owners": ["anirudTT"],
            "jira_email": "anirud@tenstorrent.com",
            "label": "component-unknown",
        },
    },
}

CFG = {
    "url": "https://example.atlassian.net",
    "email": "me@tenstorrent.com",
    "token": "tok",
    "project_key": "DEVSTACK",
}


class TestClassifier(unittest.TestCase):
    def test_first_error_source_wins(self):
        got = J.classify_component(TABLE, ["docker-control-service.log", "backend.log"])
        self.assertEqual(got, "docker-control")

    def test_default_without_evidence(self):
        self.assertEqual(J.classify_component(TABLE, []), "unknown")

    def test_error_bearing_sources(self):
        got = J.error_bearing_sources(
            [
                ("backend.log", "INFO ok\nTraceback (most recent call last):"),
                ("agent.log", "all good"),
                ("model_run.log", None),
            ]
        )
        self.assertEqual(got, ["backend.log"])


class TestOwnerTable(unittest.TestCase):
    def test_missing_file(self):
        self.assertEqual(J.load_owner_table("/nonexistent/owners.json"), {})

    def test_real_table_schema(self):
        table = J.load_owner_table()
        self.assertIn(table.get("default"), table.get("components", {}))
        for key, entry in table["components"].items():
            self.assertIn("github_owners", entry, key)
            self.assertIn("jira_email", entry, key)
            self.assertTrue(entry.get("label", "").startswith("component-"), key)


class TestBodyBuilders(unittest.TestCase):
    def test_summary(self):
        s = J.build_summary("ttbr-abc", "Deploy fails on P300")
        self.assertEqual(s, "tt-studio: bug report [ttbr-abc] — Deploy fails on P300")
        self.assertLessEqual(len(J.build_summary("ttbr-abc", "x" * 500)), 150)
        self.assertIn("web report", J.build_summary("ttbr-abc", "  "))

    def test_description_sections(self):
        form = {"description": "it broke", "steps": "1. deploy", "expected": "", "actual": "crash"}
        desc = J.build_wiki_description("ttbr-abc", form, "backend", TABLE["components"]["backend"])
        self.assertIn("ttbr-abc", desc)
        self.assertIn("@rnabeelTT", desc)
        self.assertIn("h3. Steps to Reproduce", desc)
        self.assertNotIn("h3. Expected Behavior", desc)
        self.assertIn("tt-studio-logs-ttbr-abc.zip", desc)


class TestJiraCalls(unittest.TestCase):
    def test_create_issue(self):
        resp = MagicMock(status_code=201)
        resp.json.return_value = {"key": "DEVSTACK-9"}
        with patch.object(J.requests, "post", return_value=resp) as m:
            key, url = J.create_jira_issue(CFG, "s", "d", ["l"], account_id="acc")
        self.assertEqual((key, url), ("DEVSTACK-9", "https://example.atlassian.net/browse/DEVSTACK-9"))
        fields = m.call_args.kwargs["json"]["fields"]
        self.assertEqual(fields["issuetype"], {"name": "Bug"})
        self.assertEqual(fields["assignee"], {"accountId": "acc"})
        self.assertEqual(m.call_args.kwargs["auth"], ("me@tenstorrent.com", "tok"))

    def test_attach_zip_bytes(self):
        resp = MagicMock(status_code=200)
        with patch.object(J.requests, "post", return_value=resp) as m:
            ok = J.attach_zip_bytes(CFG, "DEVSTACK-9", b"zip", "tt-studio-logs-ttbr-x.zip")
        self.assertTrue(ok)
        self.assertEqual(m.call_args.kwargs["headers"], {"X-Atlassian-Token": "no-check"})
        self.assertEqual(m.call_args.kwargs["files"]["file"][0], "tt-studio-logs-ttbr-x.zip")

    def test_find_account_id_non_200(self):
        resp = MagicMock(status_code=403)
        with patch.object(J.requests, "get", return_value=resp):
            self.assertIsNone(J.find_account_id(CFG, "a@b.c"))


if __name__ == "__main__":
    unittest.main()
