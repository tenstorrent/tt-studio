# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Host-side "report a bug" flow for the launcher.

Mirrors the web UI's Report Bug button (app/frontend/src/components/bug-report/)
for the CLI: when `python run.py` errors during setup — or when the user runs
`python run.py --report-bug` — this collects the available host-side logs and
system info into a `tt-studio-logs-ttbr-<hex>.zip` bundle and files a Jira ticket
(project DEVSTACK by default, bundle attached, routed per CODEOWNERS — see
tt_setup/jira_report.py). Without Jira credentials (JIRA_EMAIL/JIRA_API_TOKEN in
.env) it falls back to the original pre-filled GitHub new-issue URL.

Unlike the UI, this cannot call the backend's /logs-api/bug-report/ endpoint: a
setup crash usually happens before the Django backend and docker-control-service
are running. So it reads the log files directly from disk (paths from
tt_setup.constants) and deliberately never captures .env (secrets) — only whether
it exists. The bundle filename keeps the `tt-studio-logs-ttbr-*` convention so the
`tt-studio-debug-bundle` skill can consume it.
"""

import json
import os
import platform
import subprocess
import sys
import traceback
import webbrowser
import zipfile
from datetime import datetime
from urllib.parse import urlencode
from uuid import uuid4

from tt_setup.console import console, notice_panel
from tt_setup.constants import (
    DOCKER_CONTROL_LOG_FILE,
    DOCKER_CONTROL_LOGS_DIR,
    ENV_FILE_PATH,
    LOGS_DIR,
    MODEL_RUN_LOG_FILE,
    MODEL_RUN_LOGS_DIR,
    STARTUP_LOG_FILE,
    TT_STUDIO_ROOT,
)

GITHUB_NEW_ISSUE_URL = "https://github.com/tenstorrent/tt-studio/issues/new"
# GitHub rejects oversized issue bodies passed via URL; the UI truncates to 8000.
_MAX_URL_BODY = 8000
# Newest per-deployment model-run logs to include in the bundle.
_MAX_DEPLOYMENT_LOGS = 5


def _make_ref():
    """Stable id matching a GitHub issue to one bundle (matches the UI's ttbr-<12 hex>)."""
    return f"ttbr-{uuid4().hex[:12]}"


def _git(git_args):
    """Best-effort `git -C <root> …`; empty string on any failure."""
    try:
        result = subprocess.run(
            ["git", "-C", TT_STUDIO_ROOT] + git_args,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return ""


def _system_info(exc, args):
    """Environment snapshot for triage. Never includes .env contents — only its
    presence — so secrets don't leak into a shared bundle."""
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"])
    info = {
        "timestamp_utc": datetime.utcnow().isoformat() + "Z",
        "os": platform.platform(),
        "python_version": sys.version.split()[0],
        "git_branch": branch,
        "git_commit": _git(["rev-parse", "--short", "HEAD"]),
        "tt_hardware_present": os.path.exists("/dev/tenstorrent"),
        "env_file_present": os.path.exists(ENV_FILE_PATH),
        "argv": sys.argv,
    }
    if exc is not None:
        info["error_type"] = type(exc).__name__
        info["error_message"] = str(exc)
    if args is not None:
        # SimpleNamespace of parsed flags — safe, non-secret CLI state.
        info["flags"] = {k: v for k, v in vars(args).items()}
    return info


def _newest_logs(directory, limit):
    """Newest `limit` .log paths in `directory` (newest first); [] if missing."""
    if not os.path.isdir(directory):
        return []
    entries = [
        os.path.join(directory, f)
        for f in os.listdir(directory)
        if f.endswith(".log") and os.path.isfile(os.path.join(directory, f))
    ]
    entries.sort(key=os.path.getmtime, reverse=True)
    return entries[:limit]


def collect_bundle(exc=None, args=None):
    """Write a diagnostics ZIP to LOGS_DIR and return (zip_path, ref).

    Contents: error.txt (traceback, when an exception is active), system_info.json,
    and whichever host logs exist. Missing sources are simply skipped.
    """
    ref = _make_ref()
    zip_path = os.path.join(LOGS_DIR, f"tt-studio-logs-{ref}.zip")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if exc is not None:
            error_text = f"{type(exc).__name__}: {exc}\n\n" + "".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            )
            zf.writestr("error.txt", error_text)

        zf.writestr("system_info.json", json.dumps(_system_info(exc, args), indent=2))

        # Single-file host logs (startup, model-run, docker-control).
        for path, arcname in (
            (STARTUP_LOG_FILE, "startup.log"),
            (MODEL_RUN_LOG_FILE, "model_run.log"),
            (DOCKER_CONTROL_LOG_FILE, "docker-control-service.log"),
        ):
            if os.path.isfile(path):
                zf.write(path, arcname)

        # Newest per-deployment model-run logs.
        for path in _newest_logs(MODEL_RUN_LOGS_DIR, _MAX_DEPLOYMENT_LOGS):
            zf.write(path, f"model_run_logs/{os.path.basename(path)}")

        # Newest archived docker-control-service logs.
        for path in _newest_logs(DOCKER_CONTROL_LOGS_DIR, _MAX_DEPLOYMENT_LOGS):
            zf.write(path, f"docker_control_logs/{os.path.basename(path)}")

    return zip_path, ref


def build_issue_url(ref, exc=None):
    """Pre-filled GitHub new-issue URL (browser fallback, mirrors the UI's no-PAT
    path). Body is truncated for URL safety and tells the user to attach the ZIP."""
    summary = f"{type(exc).__name__}: {exc}" if exc is not None else "manually reported"
    title = f"TT-Studio bug report [{ref}]"
    body = f"""## Bug Report

**Reference:** `{ref}`
**Error:** {summary}

### Description
_Describe what you were doing when this happened._

### Steps to Reproduce
_Steps to reproduce the behavior._

---

Diagnostics were collected on your machine as `tt-studio-logs-{ref}.zip` (in the
repo's `logs/` directory). **Please attach that ZIP to this issue** — it holds the
startup log, error traceback, and system info needed to triage this.

*Auto-generated by the TT-Studio launcher (`python run.py --report-bug`).*"""

    params = urlencode({"title": title, "body": body[:_MAX_URL_BODY], "labels": "bug"})
    return f"{GITHUB_NEW_ISSUE_URL}?{params}"


def report_bug(exc=None, args=None, open_browser=True):
    """Collect a diagnostics bundle, file a Jira ticket with it attached (or fall
    back to a pre-filled GitHub issue URL), and show the next steps."""
    try:
        zip_path, ref = collect_bundle(exc=exc, args=args)
    except Exception as e:
        console.print(f"[error]❌ Could not create the diagnostics bundle: {e}[/error]")
        console.print(
            "[muted]Report bugs →[/muted]  https://github.com/tenstorrent/tt-studio/issues"
        )
        return

    from tt_setup import jira_report

    jira_configured = jira_report.load_jira_config() is not None
    jira_result = jira_report.report_to_jira(
        exc=exc, zip_path=zip_path, ref=ref, system_info=_system_info(exc, args)
    )
    if jira_result is not None:
        ticket_url, attached = jira_result
        attach_note = (
            "[muted]Log bundle attached to the ticket.[/muted]"
            if attached
            else "[muted]Attach the bundle ZIP to the ticket manually (upload failed).[/muted]"
        )
        console.print(
            notice_panel(
                "[bold]🐞 Bug report filed[/bold]",
                [
                    f"[muted]Reference   →[/muted]  {ref}",
                    f"[muted]Bundle      →[/muted]  {zip_path}",
                    f"[muted]Jira ticket →[/muted]  {ticket_url}",
                    "",
                    attach_note,
                ],
                border_style="accent",
            )
        )
        if open_browser:
            try:
                webbrowser.open(ticket_url)
            except Exception:
                # Headless / no browser — the URL is already printed above.
                pass
        return

    if jira_configured:
        console.print("[muted]Jira unavailable — falling back to GitHub.[/muted]")

    issue_url = build_issue_url(ref, exc=exc)

    console.print(
        notice_panel(
            "[bold]🐞 Bug report ready[/bold]",
            [
                f"[muted]Reference   →[/muted]  {ref}",
                f"[muted]Bundle      →[/muted]  {zip_path}",
                f"[muted]Open issue  →[/muted]  {issue_url}",
                "",
                "[muted]Attach the bundle ZIP to the GitHub issue after it opens.[/muted]",
            ],
            border_style="accent",
        )
    )

    if open_browser:
        try:
            webbrowser.open(issue_url)
        except Exception:
            # Headless / no browser — the URL is already printed above.
            pass
