# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Host-side "report a bug" flow for the launcher.

Mirrors the web UI's Report Bug button (app/frontend/src/components/bug-report/)
for the CLI: when `python run.py` errors during setup — or when the user runs
`python run.py --report-bug` — this collects the available host-side logs and
system info into a `tt-studio-logs-ttbr-<hex>.zip` bundle, writes a ready-to-send
`tt-studio-bug-report-ttbr-<hex>.eml` next to it with the bundle already attached,
and drafts a support email (support@tenstorrent.com) with the next steps pre-filled.

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
from uuid import uuid4

from tt_setup import support_email
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

# Newest per-deployment model-run logs to include in the bundle.
_MAX_DEPLOYMENT_LOGS = 5


def _make_ref():
    """Stable id matching a support ticket to one bundle (matches the UI's ttbr-<12 hex>)."""
    return f"ttbr-{uuid4().hex[:12]}"


def _git(git_args):
    """Best-effort `git -C <root> …`; empty string on any failure."""
    try:
        result = subprocess.run(
            ["git", "-C", TT_STUDIO_ROOT] + git_args,
            capture_output=True, text=True, check=False,
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
            error_text = (
                f"{type(exc).__name__}: {exc}\n\n"
                + "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
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


def build_support_email(ref, exc=None, args=None, attached=False):
    """(subject, body, mailto_url, assignee) for the support draft. The body
    summarizes the environment; full detail stays in the bundle ZIP.
    `attached=True` words the body for the .eml, where the ZIP is attached."""
    info = _system_info(exc, args)
    environment_lines = [
        f"OS: {info['os']}",
        f"Python: {info['python_version']}",
        f"TT-Studio: {info['git_branch']}@{info['git_commit']}",
        f"TT hardware: {'yes' if info['tt_hardware_present'] else 'no'}",
    ]
    error_summary = f"{type(exc).__name__}: {exc}" if exc is not None else ""
    form = {
        "title": error_summary,
        "description": error_summary and f"TT-Studio launcher failed with: {error_summary}",
    }
    assignee = support_email.assignee_for_date()
    subject = support_email.build_subject(error_summary, ref)
    body = support_email.build_body(
        ref, assignee, form, environment_lines, f"tt-studio-logs-{ref}.zip", attached=attached
    )
    return subject, body, support_email.build_mailto_url(subject, body), assignee


def write_eml(zip_path, ref, subject, body):
    """Write the ready-to-send .eml (support email with the bundle attached)
    next to the ZIP and return its path."""
    eml_path = os.path.join(os.path.dirname(zip_path), f"tt-studio-bug-report-{ref}.eml")
    with open(zip_path, "rb") as f:
        zip_bytes = f.read()
    with open(eml_path, "wb") as f:
        f.write(support_email.build_eml(subject, body, zip_bytes, os.path.basename(zip_path)))
    return eml_path


def report_bug(exc=None, args=None, open_browser=True):
    """Collect a diagnostics bundle, draft the support email, show the next
    steps, and optionally open the pre-filled draft in the default mail client."""
    try:
        zip_path, ref = collect_bundle(exc=exc, args=args)
    except Exception as e:
        console.print(f"[error]❌ Could not create the diagnostics bundle: {e}[/error]")
        console.print(
            f"[muted]Report bugs →[/muted]  {support_email.SUPPORT_EMAIL}"
        )
        return

    subject, body, mailto_url, (assignee_name, assignee_email) = build_support_email(
        ref, exc=exc, args=args
    )

    # Ready-to-send .eml with the bundle attached — the mailto: draft below
    # cannot carry attachments, so this is the path where nothing is forgotten.
    eml_path = None
    try:
        eml_body = build_support_email(ref, exc=exc, args=args, attached=True)[1]
        eml_path = write_eml(zip_path, ref, subject, eml_body)
    except Exception as e:
        console.print(f"[warning]Could not write the .eml draft: {e}[/warning]")

    rows = [
        f"[muted]Reference  →[/muted]  {ref}",
        f"[muted]Bundle     →[/muted]  {zip_path}",
    ]
    if eml_path:
        rows.append(f"[muted]Email file →[/muted]  {eml_path}")
    rows += [
        f"[muted]Email      →[/muted]  {support_email.SUPPORT_EMAIL}",
        f"[muted]Assignee   →[/muted]  {assignee_name} <{assignee_email}> (this week's triage)",
        "",
    ]
    if eml_path:
        rows += [
            "[muted]1. Open the .eml above in your mail client — the bundle is attached[/muted]",
            "[muted]2. Send — replies stream back to your inbox[/muted]",
            "[muted]   (Using the mailto: draft that also opens? Attach the ZIP by hand)[/muted]",
        ]
    else:
        rows += [
            "[muted]1. A pre-filled draft opens in your mail client[/muted]",
            "[muted]2. Attach the bundle ZIP above to the email[/muted]",
            "[muted]3. Send — replies stream back to your inbox[/muted]",
        ]

    console.print(notice_panel("[bold]🐞 Bug report ready[/bold]", rows, border_style="accent"))

    opened = False
    if open_browser:
        try:
            opened = webbrowser.open(mailto_url)
        except Exception:
            opened = False

    if not opened:
        # Headless / no mail handler / --no-browser: print everything needed to
        # compose the email by hand. Always shown — this is the actionable path.
        console.print("[muted]No mail draft opened — compose manually:[/muted]")
        # markup=False: subjects/bodies contain literal [brackets] (e.g. the
        # ttbr reference) that rich would otherwise swallow as style tags.
        console.print(f"To:      {support_email.SUPPORT_EMAIL}", markup=False)
        console.print(f"Subject: {subject}", markup=False)
        console.print("")
        console.print(body, markup=False)
