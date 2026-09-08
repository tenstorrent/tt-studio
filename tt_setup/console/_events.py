# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""NDJSON event stream for machine consumers (`--json-events`, `--status --json`).

When enabled, the launcher writes one JSON object per line to stdout so a
wrapping program (e.g. a desktop launcher) can render progress natively instead
of scraping the Rich/ANSI terminal output. Every record carries the same
stable, version-keyed shape:

    {"v": 1, "ts": <unix float>, "event": "<type>", "phase": "<phase or null>",
     "detail": {...}}

The full schema (event types and their detail payloads) is documented in
dev-docs/json-events.md. The emitter is OFF by default and every emit is a
no-op while disabled, so plain interactive runs are byte-for-byte unchanged.
"""

import json
import sys
import time


SCHEMA_VERSION = 1

# The recognized event types for schema v1 (see dev-docs/json-events.md).
EVENT_TYPES = (
    "phase_begin", "phase_end", "note", "warn", "error", "progress",
    "prompt_blocked", "ready", "status",
)


_enabled = False
_stream = None        # where NDJSON lines go (the real stdout, or a test buffer)
_redirected = False   # True when enable() re-pointed stdout/Rich at stderr


def enable(stream=None):
    """Turn the event stream on.

    With no explicit stream, events claim the process's stdout and everything
    human-facing — raw print() and the shared Rich consoles — is re-pointed at
    stderr, so stdout stays pure NDJSON. Passing a stream (tests) writes events
    there and leaves stdout alone. Idempotent."""
    global _enabled, _stream, _redirected
    if _enabled:
        return
    _enabled = True
    if stream is not None:
        _stream = stream
        return
    _stream = sys.stdout
    sys.stdout = sys.stderr
    from tt_setup.console._theme import _real_console
    _real_console.file = sys.stderr
    _redirected = True


def disable():
    """Turn the event stream off and undo enable()'s stdout/Rich redirection."""
    global _enabled, _stream, _redirected
    if _redirected:
        sys.stdout = _stream
        from tt_setup.console._theme import _real_console
        _real_console.file = sys.__stdout__
        _redirected = False
    _enabled = False
    _stream = None


def enabled():
    """True while the NDJSON event stream is active (`--json-events` mode)."""
    return _enabled


def emit(event, phase=None, detail=None):
    """Write one event line. A no-op while disabled; a failing stream (e.g. the
    consumer went away mid-run) must never take the launcher down with it."""
    if not _enabled:
        return
    record = {
        "v": SCHEMA_VERSION,
        "ts": time.time(),
        "event": event,
        "phase": phase,
        "detail": detail if detail is not None else {},
    }
    try:
        _stream.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        _stream.flush()
    except Exception:
        pass


def emit_error(message, remediation, phase=None, **extra):
    """An `error` event: what went wrong + how to fix it (always actionable)."""
    emit("error", phase=phase,
         detail={"message": message, "remediation": remediation, **extra})


def emit_prompt_blocked(prompt, remediation):
    """A `prompt_blocked` event: the run needed interactive input it can't get
    in --json-events mode; says which prompt and how to pre-answer it."""
    emit("prompt_blocked", detail={"prompt": prompt, "remediation": remediation})


def emit_ready(urls, hardware):
    """The final `ready` event: service URLs + the detected hardware label."""
    emit("ready", detail={"urls": urls, "hardware": hardware})


def plain(markup):
    """Rich markup → plain text, for event payloads (they carry no styling)."""
    try:
        from rich.text import Text
        return Text.from_markup(str(markup)).plain
    except Exception:
        return str(markup)
