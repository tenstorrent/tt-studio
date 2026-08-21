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
# Compose build completion, e.g. " ✔ tt_studio_backend  Built". Image-only
# services (chroma) never emit this — only container-start lines, matched below.
_BUILT_RE = re.compile(r'(?P<svc>tt_studio_\w+).*\bBuilt\b')
# Compose container start, e.g. " ✔ Container tt_studio_chroma_dev  Started"
_STARTED_RE = re.compile(r'(?P<svc>tt_studio_\w+).*\bStarted\b')
# Compose pull completion. Non-TTY compose prints image refs ("Image
# ghcr.io/.../backend:sha-… Pulled"); older/TTY variants print service names
# ("✔ tt_studio_backend Pulled") — accept both.
_PULLED_RE = re.compile(r'(?:^Image\s+(?P<ref>\S+)|(?P<svc>tt_studio_\w+))\s+Pulled\b')

# ── docker compose pull ──────────────────────────────────────────────────────
# A pull reports one status line per image plus a byte counter per layer:
#     Image ghcr.io/…/backend:sha-abc123 Pulling
#     5a31db4cd478 Downloading 12.11MB
#     Image ghcr.io/…/backend:sha-abc123 Pulled
#     Image ghcr.io/…/backend:sha-abc123 Error failed to resolve reference …
# Piped compose gives downloaded bytes per layer but no layer *totals*, so the
# progress fraction is counted in images (exact, and the unit a user thinks in)
# with the byte counter alongside it.
_PULL_IMAGE_RE = re.compile(
    r'^Image\s+(?P<ref>\S+)\s+'
    r'(?P<state>Pulling|Pulled|Error|Warning|Interrupted|Skipped|Exists)\b[ ]?(?P<detail>.*)$'
)
_PULL_LAYER_RE = re.compile(
    r'^(?P<id>[0-9a-f]{6,})\s+'
    r'(?P<state>Pulling fs layer|Waiting|Downloading|Verifying Checksum|'
    r'Download complete|Extracting|Pull complete|Already exists)'
    r'\s*(?P<size>[\d.]+\s*[kKMGTP]?B)?\s*$'
)
_SIZE_RE = re.compile(r'^(?P<num>[\d.]+)\s*(?P<unit>[kKMGTP]?B)$')
# Docker reports sizes in decimal units (12.11MB == 12_110_000 bytes).
_SIZE_UNITS = {"B": 1, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12, "PB": 1e15}


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
      ('built', svc)               -- a service's image finished building
      ('started', svc)             -- a service's container started
      ('pulled', svc)              -- a service's image finished pulling
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
    m = _STARTED_RE.search(stripped)
    if m:
        return ('started', m.group('svc'))
    m = _PULLED_RE.search(stripped)
    if m:
        if m.group('svc'):
            return ('pulled', m.group('svc'))
        return ('pulled', short_image_name(m.group('ref')))
    return None


def _short_service(svc):
    """tt_studio_backend -> backend; leave other names untouched."""
    return svc[len("tt_studio_"):] if svc.startswith("tt_studio_") else svc


def short_image_name(ref):
    """An image ref -> the bit worth showing: ghcr.io/…/backend:sha-abc -> backend."""
    return ref.rsplit('/', 1)[-1].split(':')[0]


def parse_pull_line(line):
    """Classify a single line of `docker compose pull` output.

    Returns one of:
      ('image', ref, state, detail)   -- a per-image status line
      ('layer', layer_id, state, bytes_or_None) -- a per-layer progress line
      None                            -- not a line we render
    """
    stripped = line.strip()
    m = _PULL_IMAGE_RE.match(stripped)
    if m:
        return ('image', m.group('ref'), m.group('state'), m.group('detail').strip())
    m = _PULL_LAYER_RE.match(stripped)
    if m:
        return ('layer', m.group('id'), m.group('state'), parse_size(m.group('size')))
    return None


def parse_size(text):
    """'12.11MB' -> 12110000.0 bytes. None when the text isn't a size."""
    if not text:
        return None
    m = _SIZE_RE.match(text.strip())
    if not m:
        return None
    try:
        return float(m.group('num')) * _SIZE_UNITS.get(m.group('unit'), 1)
    except ValueError:
        return None


def format_bytes(num):
    """Bytes -> a short human size, in the decimal units Docker itself reports."""
    for unit, size in (("GB", 1e9), ("MB", 1e6), ("kB", 1e3)):
        if num >= size:
            return f"{num / size:.1f} {unit}"
    return f"{int(num)} B"


def progress_bar(done, total, width=14):
    """A plain-text determinate bar, e.g. '▕██████░░░░░░░░▏'. Empty when unknown."""
    if total <= 0:
        return ""
    filled = max(0, min(width, round(width * done / total)))
    return "▕" + "█" * filled + "░" * (width - filled) + "▏"


class PullProgress:
    """Aggregates `docker compose pull` output into one calm activity line.

    Pure and testable: feed() each output line, read activity() for the label
    shown on the bottom activity row, and failures for what went wrong. Images
    that error are counted as resolved so the bar can still complete — a pull
    that can't succeed falls back to a local build, it isn't a hard failure.
    """

    _RESOLVED = ("Pulled", "Exists", "Skipped", "Error")

    def __init__(self, label="Pulling prebuilt images"):
        self.label = label
        self.images = {}      # image ref -> "pulling" | "done" | "error"
        self.failures = []    # [(ref, detail)] in the order compose reported them
        self._layers = {}     # layer id -> the most bytes that layer has reported

    def feed(self, line):
        """Consume one line of output.

        Returns ('pulled', name) / ('error', name, detail) for lines worth
        surfacing, else None.
        """
        parsed = parse_pull_line(line)
        if parsed is None:
            return None
        if parsed[0] == 'layer':
            _, layer_id, _state, size = parsed
            if size:
                # Each line restates that layer's running total, so keep the max
                # (a completion line re-reports 0B and must not erase progress).
                self._layers[layer_id] = max(size, self._layers.get(layer_id, 0))
            return None
        _, ref, state, detail = parsed
        name = short_image_name(ref)
        if state == 'Error':
            self.images[ref] = "error"
            self.failures.append((ref, detail))
            return ('error', name, detail)
        if state in self._RESOLVED:
            self.images[ref] = "done"
            return ('pulled', name) if state == 'Pulled' else None
        if state == 'Pulling':
            self.images.setdefault(ref, "pulling")
        return None

    def bytes_downloaded(self):
        return sum(self._layers.values())

    def counts(self):
        """(images resolved, images seen)."""
        return sum(1 for s in self.images.values() if s != "pulling"), len(self.images)

    def activity(self):
        """The bottom activity row label: label + bar + images + bytes so far."""
        done, total = self.counts()
        if not total:
            return f"{self.label}…"
        text = f"{self.label}  {progress_bar(done, total)}  {done}/{total} images"
        downloaded = self.bytes_downloaded()
        if downloaded:
            text += f" · {format_bytes(downloaded)}"
        return text


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
    is_pull = cmd[-1] == "pull"
    pull = PullProgress() if is_pull else None
    build_activity(pull.activity() if pull else "Building & starting containers…")
    try:
        for line in process.stdout:
            output_lines.append(line)
            if pull is not None:
                # A pull that can't succeed is expected (unpublished checkout,
                # offline) and falls back to a local build, so its raw registry
                # errors stay folded away — the caller prints one calm summary.
                # Progress rides the bottom activity row like a download bar.
                event = pull.feed(line)
                if event is not None and event[0] == 'pulled':
                    build_event('pulled', svc=event[1])
                build_activity(pull.activity())
                if is_verbose():
                    build_log(line)
                continue
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
            elif parsed[0] in ('built', 'pulled', 'started'):
                build_event(parsed[0], svc=_short_service(parsed[1]))   # ✓ line: both modes
    finally:
        stop_pulse()

    process.wait()
    full_output = ''.join(output_lines)
    return process.returncode, full_output
