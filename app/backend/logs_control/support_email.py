# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Support-email drafting for bug reports (backend twin).

Bug reports are filed by emailing support@tenstorrent.com — the support inbox
creates a Jira ticket from the email and streams replies back to the sender.
This module builds the pieces of that email: subject, body, and a mailto: URL
that opens a pre-filled draft in the user's mail client. mailto: cannot carry
attachments, so the body ends with an explicit reminder to attach the
diagnostics ZIP before sending. `build_eml` covers that gap: a ready-to-send
.eml message with the ZIP already attached, which the user opens in their mail
client and sends.

The first two body lines (`Assignee:` / `Reference:`) are machine-readable —
a Jira automation rule on the support project parses them to assign the ticket
and link it to the log bundle. The assignee rotates weekly (ISO week number
mod 3) through ROTATION; the rotation has a harmless discontinuity at ISO year
boundaries (week 52/53 → week 1).

Twin of tt_setup/support_email.py (the launcher cannot import Django app code
and this container cannot import tt_setup). Keep the two files' logic
identical; tests/test_support_email.py has a parity check.
"""

import datetime
from email.message import EmailMessage
from email.utils import formatdate
from urllib.parse import quote

SUPPORT_EMAIL = "support@tenstorrent.com"

# Weekly triage rotation: ISO week number % 3 picks the assignee.
ROTATION = [
    ("Anirudh", "aramchandran@tenstorrent.com"),
    ("Jashan", "jashansingh@tenstorrent.com"),
    ("Raheem", "rnabeel@tenstorrent.com"),
]

# mailto: bodies beyond ~2000 chars get truncated by common mail clients and
# browsers; everything heavy lives in the attached ZIP anyway.
_MAX_MAILTO_BODY = 1800
_MAX_SUBJECT_TITLE = 100

_TRUNCATION_NOTICE = "\n[truncated — full details in the attached ZIP]"


def assignee_for_date(d=None):
    """(name, email) of this week's triage assignee."""
    d = d or datetime.date.today()
    return ROTATION[d.isocalendar()[1] % len(ROTATION)]


def build_subject(title, ref):
    """Email subject: `[TT-Studio] <title> [ttbr-…]`."""
    title = (title or "").strip() or "Bug report"
    if len(title) > _MAX_SUBJECT_TITLE:
        title = title[: _MAX_SUBJECT_TITLE - 1] + "…"
    return f"[TT-Studio] {title} [{ref}]"


def build_body(ref, assignee, form, environment_lines, zip_name, attached=False):
    """Plain-text email body. `form` may provide title/description/steps/
    expected/actual; `environment_lines` is a short list of "key: value" strings.
    `attached=True` (the .eml path) states that the ZIP is attached instead of
    asking the user to attach it."""
    name, email = assignee

    def field(key):
        return (form.get(key) or "").strip() or "_fill in_"

    env_block = "\n".join(environment_lines) if environment_lines else "_unknown_"
    zip_line = (
        f"The diagnostics bundle {zip_name} is attached to this email."
        if attached
        else f"IMPORTANT: attach {zip_name} to this email before sending."
    )
    return f"""Assignee: {name} <{email}>
Reference: {ref}

TT-Studio bug report. Do not edit the Assignee/Reference lines — Jira
automation reads them.

## Summary
{field("title")}

## Description
{field("description")}

## Steps to Reproduce
{field("steps")}

## Expected / Actual
{field("expected")} / {field("actual")}

## Environment
{env_block}
(Full logs and system info are in the attached ZIP.)

--
{zip_line}
Sent from TT-Studio bug reporter."""


def build_mailto_url(subject, body):
    """mailto: URL opening a pre-filled draft to support. Uses quote(safe="")
    — never quote_plus: `+` renders literally in mail clients."""
    if len(body) > _MAX_MAILTO_BODY:
        body = body[: _MAX_MAILTO_BODY - len(_TRUNCATION_NOTICE)] + _TRUNCATION_NOTICE
    return (
        f"mailto:{SUPPORT_EMAIL}"
        f"?subject={quote(subject, safe='')}"
        f"&body={quote(body, safe='')}"
    )


def build_eml(subject, body, zip_bytes, zip_name):
    """RFC 822 message (.eml) to support with the diagnostics ZIP attached.

    Opened from disk in the user's mail client this is a ready-to-send draft
    with the bundle already attached — the one thing mailto: cannot do.
    `X-Unsent: 1` makes Outlook open it as an editable draft rather than a
    received message; Thunderbird users pick "Edit As New Message"."""
    msg = EmailMessage()
    msg["To"] = SUPPORT_EMAIL
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["X-Unsent"] = "1"
    msg.set_content(body)
    msg.add_attachment(zip_bytes, maintype="application", subtype="zip", filename=zip_name)
    return msg.as_bytes()
