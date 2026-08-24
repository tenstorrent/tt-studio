# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Jira ticket creation for launcher bug reports.

Files a Bug in the team's Jira project (default DEVSTACK) with the diagnostics
bundle attached, routed to the owning component per
app/backend/shared_config/component_owners.json (which mirrors .github/CODEOWNERS).

Backend twin: app/backend/logs_control/jira_client.py — keep the two in sync.
Uses Jira Cloud REST API v2 (plain wiki-markup description; no ADF needed).

Everything here is best-effort: report_to_jira() never raises, because it runs
inside the launcher's crash handler. When Jira credentials are absent or any
call fails, the caller falls back to the pre-filled GitHub issue URL.
"""

import json
import os
import re

import requests

from tt_setup.constants import TT_STUDIO_ROOT
from tt_setup.env_config import get_env_var

JIRA_API_BASE = "/rest/api/2"
_TIMEOUT = 15
# Full traceback lives in the attached bundle; keep the ticket body readable.
_MAX_DESCRIPTION_TRACEBACK = 4000
_OWNER_TABLE_PATH = os.path.join(
    TT_STUDIO_ROOT, "app", "backend", "shared_config", "component_owners.json"
)
_TRACEBACK_FILE_RE = re.compile(r'File "([^"]+)"')


def load_jira_config():
    """Jira connection settings from os.environ / repo-root .env, or None when
    the required credentials (email + API token) aren't configured."""
    email = get_env_var("JIRA_EMAIL")
    token = get_env_var("JIRA_API_TOKEN")
    if not email or not token:
        return None
    return {
        "url": get_env_var("JIRA_URL", "https://tenstorrent.atlassian.net").rstrip("/"),
        "email": email,
        "token": token,
        "project_key": get_env_var("JIRA_PROJECT_KEY", "DEVSTACK") or "DEVSTACK",
    }


def load_owner_table(path=_OWNER_TABLE_PATH):
    """Component→owner routing table; {} when unreadable (classifier then
    degrades to its built-in 'unknown')."""
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def classify_component(table, traceback_text="", error_log_sources=()):
    """Map bug evidence to a component key from the owner table.

    Priority: (1) longest path-prefix match of traceback frame paths against each
    component's `paths`; (2) first error-bearing log source matching a component's
    `log_sources`; (3) the table's default.
    """
    components = table.get("components", {})
    default = table.get("default", "unknown")
    if not components:
        return default

    best_key, best_len = None, -1
    for frame_path in _TRACEBACK_FILE_RE.findall(traceback_text or ""):
        rel = (
            os.path.relpath(frame_path, TT_STUDIO_ROOT)
            if os.path.isabs(frame_path)
            else frame_path
        )
        rel = rel.replace(os.sep, "/")
        if rel.startswith(".."):
            continue  # frame outside the repo (stdlib, site-packages)
        for key, entry in components.items():
            for prefix in entry.get("paths", []):
                if rel.startswith(prefix) and len(prefix) > best_len:
                    best_key, best_len = key, len(prefix)
    if best_key:
        return best_key

    for source in error_log_sources:
        for key, entry in components.items():
            if source in entry.get("log_sources", []):
                return key
    return default


def error_bearing_sources(named_texts):
    """Names from (name, text) pairs whose tail mentions an error, for the
    classifier's log-source pass."""
    hits = []
    for name, text in named_texts:
        tail = "\n".join((text or "").splitlines()[-200:])
        if re.search(r"error|traceback|exception", tail, re.IGNORECASE):
            hits.append(name)
    return hits


def build_summary(ref, exc=None):
    summary = f"{type(exc).__name__}: {exc}" if exc is not None else "manual report"
    return f"tt-studio: bug report [{ref}] — {summary}"[:150]


def build_wiki_description(ref, exc, component, entry, system_info):
    """Jira wiki-markup ticket body mirroring the GitHub issue body."""
    owners = ", ".join(f"@{o}" for o in entry.get("github_owners", [])) or "unassigned"
    error_line = (
        f"{type(exc).__name__}: {exc}" if exc is not None else "manually reported"
    )
    lines = [
        "h3. Bug Report",
        "",
        f"*Reference:* {{{{{ref}}}}}",
        f"*Error:* {error_line}",
        f"*Component:* {component} (owners: {owners})",
        "",
        "h3. Environment",
        "",
        "{code:json}",
        json.dumps(system_info or {}, indent=2, default=str),
        "{code}",
    ]
    if exc is not None:
        import traceback as _tb

        tb_text = "".join(_tb.format_exception(type(exc), exc, exc.__traceback__))
        lines += [
            "",
            "h3. Traceback",
            "",
            "{code}",
            tb_text[-_MAX_DESCRIPTION_TRACEBACK:],
            "{code}",
        ]
    lines += [
        "",
        "----",
        f"Diagnostics bundle {{{{tt-studio-logs-{ref}.zip}}}} is attached.",
        "_Auto-generated by the TT-Studio launcher (python run.py --report-bug)._",
    ]
    return "\n".join(lines)


def _auth(cfg):
    return (cfg["email"], cfg["token"])


def find_account_id(cfg, email):
    """Resolve a Jira Cloud accountId from an email; None when the user can't be
    found (e.g. email hidden by privacy settings) — ticket then stays unassigned."""
    resp = requests.get(
        f"{cfg['url']}{JIRA_API_BASE}/user/search",
        params={"query": email},
        auth=_auth(cfg),
        timeout=_TIMEOUT,
    )
    if resp.status_code != 200:
        return None
    users = resp.json()
    return users[0].get("accountId") if users else None


def create_jira_issue(cfg, summary, description, labels, account_id=None):
    """Create the Bug and return (issue_key, browse_url). Raises on API errors
    (caller decides the fallback)."""
    fields = {
        "project": {"key": cfg["project_key"]},
        "issuetype": {"name": "Bug"},
        "summary": summary,
        "description": description,
        "labels": labels,
    }
    if account_id:
        fields["assignee"] = {"accountId": account_id}
    resp = requests.post(
        f"{cfg['url']}{JIRA_API_BASE}/issue",
        json={"fields": fields},
        auth=_auth(cfg),
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    key = resp.json()["key"]
    return key, f"{cfg['url']}/browse/{key}"


def attach_zip(cfg, issue_key, zip_path):
    """Attach the diagnostics bundle to the ticket. True on success."""
    with open(zip_path, "rb") as f:
        resp = requests.post(
            f"{cfg['url']}{JIRA_API_BASE}/issue/{issue_key}/attachments",
            files={"file": (os.path.basename(zip_path), f, "application/zip")},
            headers={"X-Atlassian-Token": "no-check"},
            auth=_auth(cfg),
            timeout=60,
        )
    return resp.status_code == 200


def report_to_jira(exc=None, zip_path=None, ref="", system_info=None):
    """File the bug in Jira with the bundle attached.

    Returns (ticket_url, attachment_uploaded) on success, or None on any
    failure — including missing credentials — so the caller can fall back to
    the GitHub issue URL. Never raises: this runs inside the crash handler.
    """
    try:
        cfg = load_jira_config()
        if cfg is None:
            return None

        table = load_owner_table()
        traceback_text = ""
        if exc is not None:
            import traceback as _tb

            traceback_text = "".join(
                _tb.format_exception(type(exc), exc, exc.__traceback__)
            )
        component = classify_component(table, traceback_text=traceback_text)
        entry = table.get("components", {}).get(component, {})

        account_id = None
        email = entry.get("jira_email")
        if email:
            try:
                account_id = find_account_id(cfg, email)
            except Exception:
                account_id = None  # assignment is best-effort, never blocks filing

        labels = [
            "tt-studio",
            "bug-report",
            entry.get("label", f"component-{component}"),
        ]
        key, url = create_jira_issue(
            cfg,
            build_summary(ref, exc),
            build_wiki_description(ref, exc, component, entry, system_info),
            labels,
            account_id=account_id,
        )

        attached = False
        if zip_path and os.path.isfile(zip_path):
            try:
                attached = attach_zip(cfg, key, zip_path)
            except Exception:
                attached = False
        return url, attached
    except Exception:
        return None
