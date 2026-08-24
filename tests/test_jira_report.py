# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the launcher's Jira bug-report path (tt_setup/jira_report.py).

All network calls are mocked — nothing here talks to Jira.
"""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from tt_setup import jira_report as J

TABLE = {
    "default": "unknown",
    "components": {
        "launcher": {
            "paths": ["run.py", "tt_setup/"],
            "log_sources": ["startup.log", "error.txt"],
            "github_owners": ["jashansinghTT", "anirudTT"],
            "jira_email": "jashansingh@tenstorrent.com",
            "label": "component-launcher",
        },
        "backend": {
            "paths": ["app/backend/"],
            "log_sources": ["backend.log"],
            "github_owners": ["rnabeelTT"],
            "jira_email": "rnabeel@tenstorrent.com",
            "label": "component-backend",
        },
        "rag": {
            "paths": ["app/backend/vector_db_control/"],
            "log_sources": [],
            "github_owners": ["jashansinghTT"],
            "jira_email": "jashansingh@tenstorrent.com",
            "label": "component-rag",
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
    def test_traceback_path_wins(self):
        tb = 'File "tt_setup/cli/_run.py", line 10, in _run'
        self.assertEqual(J.classify_component(TABLE, traceback_text=tb), "launcher")

    def test_longest_prefix_wins(self):
        tb = 'File "app/backend/vector_db_control/views.py", line 5'
        self.assertEqual(J.classify_component(TABLE, traceback_text=tb), "rag")

    def test_absolute_paths_normalized(self):
        tb = f'File "{os.path.join(J.TT_STUDIO_ROOT, "tt_setup", "docker_utils.py")}", line 3'
        self.assertEqual(J.classify_component(TABLE, traceback_text=tb), "launcher")

    def test_frames_outside_repo_ignored(self):
        tb = 'File "/usr/lib/python3.10/json/__init__.py", line 1'
        self.assertEqual(J.classify_component(TABLE, traceback_text=tb), "unknown")

    def test_log_source_fallback(self):
        got = J.classify_component(
            TABLE, error_log_sources=["docker-control-service.log"]
        )
        self.assertEqual(got, "docker-control")

    def test_default_when_no_evidence(self):
        self.assertEqual(J.classify_component(TABLE), "unknown")

    def test_empty_table(self):
        self.assertEqual(J.classify_component({}), "unknown")

    def test_error_bearing_sources(self):
        got = J.error_bearing_sources(
            [
                ("backend.log", "all fine\nToTaL ERROR occurred"),
                ("startup.log", "clean run"),
                ("agent.log", None),
            ]
        )
        self.assertEqual(got, ["backend.log"])


class TestBodyBuilders(unittest.TestCase):
    def test_summary_manual(self):
        s = J.build_summary("ttbr-abc123")
        self.assertTrue(s.startswith("tt-studio: bug report [ttbr-abc123]"))
        self.assertIn("manual report", s)

    def test_summary_truncated(self):
        s = J.build_summary("ttbr-abc123", exc=ValueError("x" * 500))
        self.assertLessEqual(len(s), 150)
        self.assertIn("ValueError", s)

    def test_description_contents(self):
        try:
            raise RuntimeError("boom")
        except RuntimeError as e:
            desc = J.build_wiki_description(
                "ttbr-abc123",
                e,
                "launcher",
                TABLE["components"]["launcher"],
                {"os": "linux"},
            )
        self.assertIn("ttbr-abc123", desc)
        self.assertIn("{code}", desc)
        self.assertIn("RuntimeError: boom", desc)
        self.assertIn("@jashansinghTT", desc)
        self.assertIn("tt-studio-logs-ttbr-abc123.zip", desc)


class TestConfig(unittest.TestCase):
    def test_none_without_credentials(self):
        with patch.object(J, "get_env_var", side_effect=lambda k, d="": d):
            self.assertIsNone(J.load_jira_config())

    def test_defaults_applied(self):
        values = {"JIRA_EMAIL": "a@b.c", "JIRA_API_TOKEN": "t"}
        with patch.object(
            J, "get_env_var", side_effect=lambda k, d="": values.get(k, d)
        ):
            cfg = J.load_jira_config()
        self.assertEqual(cfg["url"], "https://tenstorrent.atlassian.net")
        self.assertEqual(cfg["project_key"], "DEVSTACK")

    def test_owner_table_missing_file(self):
        self.assertEqual(J.load_owner_table("/nonexistent/owners.json"), {})

    def test_real_owner_table_schema(self):
        table = J.load_owner_table()
        self.assertIn(table.get("default"), table.get("components", {}))
        for key, entry in table["components"].items():
            self.assertIn("paths", entry, key)
            self.assertIn("github_owners", entry, key)
            self.assertIn("jira_email", entry, key)
            self.assertTrue(entry.get("label", "").startswith("component-"), key)


class TestJiraCalls(unittest.TestCase):
    def test_find_account_id(self):
        resp = MagicMock(status_code=200)
        resp.json.return_value = [{"accountId": "acc-1"}]
        with patch.object(J.requests, "get", return_value=resp) as m:
            self.assertEqual(J.find_account_id(CFG, "a@b.c"), "acc-1")
        args, kwargs = m.call_args
        self.assertEqual(
            args[0], "https://example.atlassian.net/rest/api/2/user/search"
        )
        self.assertEqual(kwargs["auth"], ("me@tenstorrent.com", "tok"))

    def test_find_account_id_empty(self):
        resp = MagicMock(status_code=200)
        resp.json.return_value = []
        with patch.object(J.requests, "get", return_value=resp):
            self.assertIsNone(J.find_account_id(CFG, "a@b.c"))

    def test_create_issue_fields(self):
        resp = MagicMock(status_code=201)
        resp.json.return_value = {"key": "DEVSTACK-42"}
        with patch.object(J.requests, "post", return_value=resp) as m:
            key, url = J.create_jira_issue(CFG, "s", "d", ["l"], account_id="acc-1")
        self.assertEqual(
            (key, url),
            ("DEVSTACK-42", "https://example.atlassian.net/browse/DEVSTACK-42"),
        )
        fields = m.call_args.kwargs["json"]["fields"]
        self.assertEqual(fields["project"], {"key": "DEVSTACK"})
        self.assertEqual(fields["issuetype"], {"name": "Bug"})
        self.assertEqual(fields["assignee"], {"accountId": "acc-1"})

    def test_attach_zip_multipart(self):
        resp = MagicMock(status_code=200)
        with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
            tmp.write(b"zipbytes")
            tmp.flush()
            with patch.object(J.requests, "post", return_value=resp) as m:
                self.assertTrue(J.attach_zip(CFG, "DEVSTACK-42", tmp.name))
        kwargs = m.call_args.kwargs
        self.assertEqual(kwargs["headers"], {"X-Atlassian-Token": "no-check"})
        self.assertIn("file", kwargs["files"])
        self.assertEqual(
            m.call_args.args[0],
            "https://example.atlassian.net/rest/api/2/issue/DEVSTACK-42/attachments",
        )


class TestReportToJira(unittest.TestCase):
    def test_none_without_config(self):
        with patch.object(J, "load_jira_config", return_value=None):
            self.assertIsNone(J.report_to_jira(ref="ttbr-x"))

    def test_never_raises(self):
        with patch.object(J, "load_jira_config", return_value=CFG), patch.object(
            J, "create_jira_issue", side_effect=RuntimeError("api down")
        ):
            self.assertIsNone(J.report_to_jira(ref="ttbr-x"))

    def test_success_with_attachment(self):
        with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
            with patch.object(J, "load_jira_config", return_value=CFG), patch.object(
                J, "load_owner_table", return_value=TABLE
            ), patch.object(J, "find_account_id", return_value="acc-1"), patch.object(
                J,
                "create_jira_issue",
                return_value=(
                    "DEVSTACK-7",
                    "https://example.atlassian.net/browse/DEVSTACK-7",
                ),
            ) as mk, patch.object(J, "attach_zip", return_value=True):
                got = J.report_to_jira(ref="ttbr-x", zip_path=tmp.name)
        self.assertEqual(got, ("https://example.atlassian.net/browse/DEVSTACK-7", True))
        labels = mk.call_args.args[3]
        self.assertIn("tt-studio", labels)
        self.assertIn("bug-report", labels)

    def test_assignment_failure_still_files(self):
        with patch.object(J, "load_jira_config", return_value=CFG), patch.object(
            J, "load_owner_table", return_value=TABLE
        ), patch.object(
            J, "find_account_id", side_effect=RuntimeError("403")
        ), patch.object(J, "create_jira_issue", return_value=("DEVSTACK-8", "u")) as mk:
            got = J.report_to_jira(ref="ttbr-x")
        self.assertEqual(got, ("u", False))
        self.assertIsNone(mk.call_args.kwargs["account_id"])


if __name__ == "__main__":
    unittest.main()
