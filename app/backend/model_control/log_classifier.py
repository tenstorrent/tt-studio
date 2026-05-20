# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Container startup phase classifier.

Parses docker stdout lines from a vLLM + tt-metal inference container that is
in the "starting" state, and returns a structured snapshot of which phase of
warmup it's in. Used by ModelHealthView to enrich the 202 response so the
frontend banner can show real progress instead of a fake timer.

Pure function — feed it lines, get back a dict. No I/O.
"""

import re
import time
from typing import Iterable, Optional

# Phase keys, in canonical order. The latest matched marker wins.
PHASES = [
    "container_starting",
    "vllm_importing",
    "downloading_weights",
    "engine_initializing",
    "device_init",
    "model_config",
    "loading_weights",
    "compiling_model",
    "engine_ready",
    "server_starting",
    "ready",
]

PHASE_LABELS = {
    "container_starting":  "Starting container",
    "vllm_importing":      "Loading vLLM runtime",
    "downloading_weights": "Downloading model weights",
    "engine_initializing": "Initializing inference engine",
    "device_init":         "Opening Tenstorrent device",
    "model_config":        "Loading model configuration",
    "loading_weights":     "Loading model weights",
    "compiling_model":     "Compiling inference graph",
    "engine_ready":        "Allocating KV cache",
    "server_starting":     "Starting API server",
    "ready":               "Ready",
}

# Coarse progress percent per phase, used when no finer-grained signal is available.
# downloading_weights gets the 10-30 window since it's the long phase; byte-level
# progress in views.py refines this when bytes are available.
PHASE_BASE_PCT = {
    "container_starting":  5,
    "vllm_importing":      8,
    "downloading_weights": 10,
    "engine_initializing": 30,
    "device_init":         35,
    "model_config":        40,
    "loading_weights":     45,
    "compiling_model":     50,
    "engine_ready":        75,
    "server_starting":     90,
    "ready":               100,
}

# Markers chosen from real warmup logs under
# .artifacts/tt-inference-server/workflow_logs/docker_server/. Each maps an
# uppercased substring (cheap) or compiled regex (precise) to a phase.
_SUBSTRING_MARKERS: list[tuple[str, str]] = [
    ("USING CACHE_ROOT",                  "container_starting"),
    ("MOUNTED VOLUME PERMISSIONS",        "container_starting"),
    ("AUTOMATICALLY DETECTED PLATFORM",   "vllm_importing"),
    ("SETTING ENV VAR:",                  "vllm_importing"),
    # In-container weights download: run_vllm_api_server.py:312 emits the first;
    # the second fires on a cache hit and immediately advances past download.
    ("DOWNLOADING WEIGHTS FROM",          "downloading_weights"),
    ("WEIGHTS ALREADY EXIST AT",          "downloading_weights"),
    ("INITIALIZING A V0 LLM ENGINE",      "engine_initializing"),
    ("INITIALIZING A V1 LLM ENGINE",      "engine_initializing"),
    ("TTMODELRUNNER:",                    "engine_initializing"),
    ("OPENING USER MODE DEVICE DRIVER",   "device_init"),
    ("MAPPED HUGEPAGE",                   "device_init"),
    ("FABRIC INITIALIZED ON DEVICE",      "device_init"),
    ("MULTIDEVICE WITH",                  "device_init"),
    ("INFERRING DEVICE NAME",             "model_config"),
    ("CHECKPOINT DIRECTORY:",             "model_config"),
    ("SUCCESSFULLY LOADED TOKENIZER",     "model_config"),
    ("SUCCESSFULLY LOADED PROCESSOR",     "model_config"),
    ("LOADING CHECKPOINT SHARDS",         "loading_weights"),
    ("LOADING SAFETENSORS CHECKPOINT",    "loading_weights"),
    ("WARMING UP PREFILL FOR SEQUENCE",   "compiling_model"),
    ("DONE COMPILING MODEL",              "compiling_model"),
    ("DONE CAPTURING PREFILL TRACE",      "compiling_model"),
    ("DONE CAPTURING DECODE TRACE",       "compiling_model"),
    ("SAMPLING PARAMS USED FOR DECODE",   "compiling_model"),
    ("INIT ENGINE (PROFILE, CREATE KV",   "engine_ready"),
    ("STARTED SERVER PROCESS",            "server_starting"),
    ("APPLICATION STARTUP COMPLETE",      "server_starting"),
]

# Pulled from run_vllm_api_server.py:312, 316.
# Example:  "Downloading weights from Qwen/Qwen3-32B to /home/container_app_user/cache_root/weights/Qwen3-32B"
_DOWNLOAD_START_RE = re.compile(
    r"Downloading weights from\s+(?P<repo>\S+)\s+to\s+(?P<path>\S+)"
)
_DOWNLOAD_CACHED_RE = re.compile(
    r"Weights already exist at\s+(?P<path>\S+)"
)

# Latest "Service not ready after Xs" / "Cache generation in progress. Waited Xs" line.
# These confirm liveness from an external poller; we surface the elapsed seconds
# so the banner can render "alive · N s elapsed".
_HEARTBEAT_RE = re.compile(
    r"(?:Service not ready after|Cache generation in progress\.\s*Waited)\s+(\d+(?:\.\d+)?)s"
)

# Warmup detail: "Warming up prefill for sequence length: 2048"
_WARMUP_SEQLEN_RE = re.compile(
    r"Warming up prefill for sequence length:\s*(\d+)", re.IGNORECASE
)

# Final readiness: vLLM's uvicorn access log answering /health with 200.
_HEALTH_OK_RE = re.compile(r'"GET /health HTTP/1\.1" 200')

# Counts of completed compile/capture steps within compiling_model. There are
# typically 4 prefill seq lengths + 1 decode capture = 5 traces, so progress
# within the phase tracks N/5 (clamped).
_DONE_CAPTURE_RE = re.compile(
    r"Done Capturing (?:Prefill|Decode) Trace", re.IGNORECASE
)
COMPILE_TRACE_TOTAL = 5  # Qwen3-8B/N300 baseline; safe clamp for other configs.

# How long without any recognised activity before we mark the deploy stalled.
STALL_THRESHOLD_SECONDS = 90.0


def _now() -> float:
    return time.time()


def classify_startup_phase(lines: Iterable[str], now: Optional[float] = None) -> dict:
    """Classify a snapshot of recent container stdout lines into a phase summary.

    Args:
        lines: log lines in chronological order (oldest first). Any line format
            is fine; the classifier matches substrings/regexes.
        now: optional override for the wall clock, for tests.

    Returns:
        dict with phase, phase_label, progress, message, last_heartbeat_seconds,
        warmup_seq_len, trace_count, is_stalled, classified_at.
    """
    current_now = now if now is not None else _now()

    # Latest signals encountered while scanning (kept as we go, last one wins).
    phase: Optional[str] = None
    last_meaningful_line: Optional[str] = None
    last_heartbeat_seconds: Optional[float] = None
    warmup_seq_len: Optional[int] = None
    trace_count = 0
    saw_health_ok = False
    weights_repo: Optional[str] = None
    weights_target_path: Optional[str] = None
    weights_cached: bool = False

    for raw in lines:
        if not raw:
            continue
        line = raw.rstrip()
        upper = line.upper()

        # Final readiness — once present we stop refining; it overrides everything.
        if _HEALTH_OK_RE.search(line):
            saw_health_ok = True

        # Phase markers (substring scan).
        for needle, candidate_phase in _SUBSTRING_MARKERS:
            if needle in upper:
                phase = candidate_phase
                last_meaningful_line = line
                break

        # Capture repo + container path from the download log line.
        m = _DOWNLOAD_START_RE.search(line)
        if m:
            weights_repo = m.group("repo")
            weights_target_path = m.group("path")
            weights_cached = False
        else:
            m = _DOWNLOAD_CACHED_RE.search(line)
            if m:
                weights_target_path = m.group("path")
                weights_cached = True

        # Within compiling_model, count completed trace captures.
        if _DONE_CAPTURE_RE.search(line):
            trace_count += 1

        # Latest "Warming up prefill" seq_len (detail for the message line).
        m = _WARMUP_SEQLEN_RE.search(line)
        if m:
            try:
                warmup_seq_len = int(m.group(1))
            except ValueError:
                pass

        # Heartbeat from the prompt_client poller — elapsed seconds external wait.
        m = _HEARTBEAT_RE.search(line)
        if m:
            try:
                last_heartbeat_seconds = float(m.group(1))
            except ValueError:
                pass

    if saw_health_ok:
        phase = "ready"
        if not last_meaningful_line:
            last_meaningful_line = "API server is ready"

    if phase is None:
        # No marker matched — container probably just started, no stdout yet.
        phase = "container_starting"

    # Compute progress percent. For compiling_model we layer trace_count progress
    # on top of the base, so the bar visibly advances during the long warmup.
    progress = PHASE_BASE_PCT.get(phase, 0)
    if phase == "compiling_model" and trace_count > 0:
        capped = min(trace_count, COMPILE_TRACE_TOTAL)
        # Span 35% → 70% across COMPILE_TRACE_TOTAL captures.
        progress = PHASE_BASE_PCT["compiling_model"] + int(
            (capped / COMPILE_TRACE_TOTAL) * (PHASE_BASE_PCT["engine_ready"] - PHASE_BASE_PCT["compiling_model"] - 5)
        )

    # Build a human-friendly message line. Prefer phase-specific detail over the raw log line.
    message = last_meaningful_line or ""
    if phase == "compiling_model":
        detail_parts = []
        if warmup_seq_len:
            detail_parts.append(f"prefill seq_len {warmup_seq_len}")
        if trace_count > 0:
            detail_parts.append(f"trace {min(trace_count, COMPILE_TRACE_TOTAL)}/{COMPILE_TRACE_TOTAL}")
        if detail_parts:
            message = " · ".join(detail_parts)

    # Stall detection: only meaningful if we have an external heartbeat to compare
    # against. The poller emits one every ~10s, so absence past STALL_THRESHOLD is a real signal.
    is_stalled = False
    if last_heartbeat_seconds is not None and phase not in ("ready",):
        # The heartbeat reports cumulative external wait time, not "time since last beat".
        # We approximate freshness by assuming the poller emits regularly; if the most
        # recent heartbeat we see is the same value across multiple polls, the upstream
        # tail is empty / frozen. Caller can compare last_heartbeat_seconds across calls
        # for a definitive stalled signal. For now we surface the value and let the
        # frontend decide.
        pass

    return {
        "phase": phase,
        "phase_label": PHASE_LABELS.get(phase, phase),
        "progress": progress,
        "message": message[:300],
        "last_heartbeat_seconds": last_heartbeat_seconds,
        "warmup_seq_len": warmup_seq_len,
        "trace_count": trace_count,
        "is_stalled": is_stalled,
        "classified_at": current_now,
        "weights_repo": weights_repo,
        "weights_target_path": weights_target_path,
        "weights_cached": weights_cached,
    }
