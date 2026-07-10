# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parsing + streaming of `docker compose up --build` output into calm progress."""

import os
import re
import subprocess

# BuildKit step header, e.g. "#22 [tt_studio_backend 2/8] RUN apt-get update..."
_BUILD_STEP_RE = re.compile(r'^#(?P<n>\d+)\s+\[(?P<svc>\S+)\s+(?P<x>\d+)/(?P<y>\d+)\]\s+(?P<desc>.*)$')
# A cached step, e.g. "#22 CACHED"
_CACHED_RE = re.compile(r'^#(?P<n>\d+)\s+CACHED\b')
# Compose completion, e.g. " ✔ tt_studio_backend  Built" / "... tt_studio_frontend  Started"
_BUILT_RE = re.compile(r'(?P<svc>tt_studio_\w+).*\b(?:Built|Started)\b')


def friendly_build_label(desc):
    """Translate a cryptic BuildKit step description into a human label so the
    build isn't a black box, e.g. 'RUN pip install -r req.txt' -> 'installing
    Python deps'. Falls back to a trimmed form of the original."""
    d = desc.strip()
    low = d.lower()
    # Strip a leading BuildKit verb to inspect the command.
    body = low
    for verb in ("run ", "copy ", "add ", "from ", "workdir ", "env ", "arg ",
                 "expose ", "cmd ", "entrypoint ", "label "):
        if low.startswith(verb):
            body = low[len(verb):].strip()
            break
    if low.startswith(("copy ", "add ")):
        return "copying files"
    if low.startswith("from "):
        return "pulling base image"
    if low.startswith("workdir "):
        return "setting up workspace"
    if low.startswith(("cmd ", "entrypoint ", "expose ", "env ", "arg ", "label ")):
        return "configuring image"
    if low.startswith("run "):
        if any(k in body for k in ("pip ", "pip3 ", "poetry ", "uv pip", "python -m pip")):
            return "installing Python deps"
        if any(k in body for k in ("npm ", "yarn ", "pnpm ", "npx ")):
            return "installing JS deps"
        if any(k in body for k in ("apt-get", "apt ", "apk add", "yum ", "dnf ", "microdnf")):
            return "installing system packages"
        # Generic RUN: show a short, readable form of the command.
        short = body.split("&&")[0].strip()
        return f"running {short[:32]}" if short else "running setup"
    # Unknown step type — keep something readable.
    return d[:40]


def parse_build_line(line):
    """Classify a single line of `docker compose up --build` output.

    Returns one of:
      ('step', n, svc, x, y, desc) -- a BuildKit step header (n = step number)
      ('cached', n)                -- step number n was served from cache
      ('built', svc)               -- a service finished building/starting
      None                         -- not a line we render
    """
    stripped = line.strip()
    m = _BUILD_STEP_RE.match(stripped)
    if m:
        return ('step', int(m.group('n')), m.group('svc'), int(m.group('x')), int(m.group('y')), m.group('desc'))
    m = _CACHED_RE.match(stripped)
    if m:
        return ('cached', int(m.group('n')))
    m = _BUILT_RE.search(stripped)
    if m:
        return ('built', m.group('svc'))
    return None


def _short_service(svc):
    """tt_studio_backend -> backend; leave other names untouched."""
    return svc[len("tt_studio_"):] if svc.startswith("tt_studio_") else svc


def run_docker_compose_with_progress(cmd, cwd, dev_mode=False):
    """
    Run docker compose, streaming build progress.

    The active phase node "pulses" continuously (a background ticker) for the whole
    build, so it never looks frozen even during a long step that prints nothing. In
    dev mode (or --verbose) the full per-service milestones ("<svc> · installing
    Python deps…") + compose status scroll below; in plain (non-dev) mode only the
    pulse + "✓ <svc> built" lines show, to keep it minimal. Returns
    (returncode, full_output_string).
    """
    from tt_setup.console import build_activity, build_event, build_log, is_verbose, start_pulse, stop_pulse

    verbose_build = dev_mode or is_verbose()

    # Force plain BuildKit progress so the piped stream is parseable.
    env = dict(os.environ)
    env["BUILDKIT_PROGRESS"] = "plain"

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        env=env,
    )

    output_lines = []
    step_svc = {}     # BuildKit step number -> short svc name

    start_pulse()   # animate the active node for the whole build (both modes)
    # Generic apt-style bottom-line label; refined to the live step in dev/-v below.
    build_activity("Building & starting containers…")
    try:
        for line in process.stdout:
            output_lines.append(line)
            if verbose_build:
                build_log(line)   # compose status lines scroll (dev/-v only)
            parsed = parse_build_line(line)
            if parsed is None:
                continue
            if parsed[0] == 'step':
                _, n, svc, x, y, desc = parsed
                short = _short_service(svc)
                step_svc[n] = short
                if verbose_build:
                    label = friendly_build_label(desc)
                    build_event('step', svc=short, x=x, y=y, label=label)
                    build_activity(f"{short} · {label}")   # track the live step (dev/-v)
            elif parsed[0] == 'cached':
                short = step_svc.get(parsed[1])
                if short and verbose_build:
                    build_event('cached', svc=short)
            elif parsed[0] == 'built':
                build_event('built', svc=_short_service(parsed[1]))   # ✓ line: both modes
    finally:
        stop_pulse()

    process.wait()
    full_output = ''.join(output_lines)
    return process.returncode, full_output
