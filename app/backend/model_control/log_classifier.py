# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Container startup phase classifier.

Parses docker stdout lines from a starting inference container and returns a
structured snapshot of which phase of warmup it's in. Used by ModelHealthView
to enrich the 202 response so the frontend banner can show real progress.

Supports two phase templates because the runtime stacks are different:

* LLM template — vLLM + tt-metal containers (Llama, Qwen, DeepSeek, etc.).
  Long compile-graph phase, KV cache allocation, autoregressive decode.

* MEDIA template — tt-media-inference-server (Whisper, SpeechT5, SDXL, etc.).
  Multi-worker FastAPI service with one-shot encoders/decoders. No KV cache,
  no compile-graph phase.

Pure function — feed it lines + an optional `model_type` hint, get back a dict
with the right phase template embedded so the frontend knows which pills to
render. No I/O.
"""

import re
import time
from typing import Iterable, Optional

# ---------------------------------------------------------------------------
# LLM template (vLLM + tt-metal)
# ---------------------------------------------------------------------------

LLM_PHASES = [
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

LLM_PHASE_LABELS = {
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

# Weighted by typical phase duration. compile + download together account for
# >90% of total warmup; everything else is short.
LLM_PHASE_BASE_PCT = {
    "container_starting":  2,
    "vllm_importing":      5,
    "downloading_weights": 8,
    "engine_initializing": 27,
    "device_init":         28,
    "model_config":        30,
    "loading_weights":     32,
    "compiling_model":     35,
    "engine_ready":        90,
    "server_starting":     95,
    "ready":               100,
}

# Markers chosen from real warmup logs
_LLM_SUBSTRING_MARKERS: list[tuple[str, str]] = [
    ("USING CACHE_ROOT",                  "container_starting"),
    ("MOUNTED VOLUME PERMISSIONS",        "container_starting"),
    ("AUTOMATICALLY DETECTED PLATFORM",   "vllm_importing"),
    ("SETTING ENV VAR:",                  "vllm_importing"),
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

# vLLM-emitted download log lines
_DOWNLOAD_START_RE = re.compile(
    r"Downloading weights from\s+(?P<repo>\S+)\s+to\s+(?P<path>\S+)"
)
_DOWNLOAD_CACHED_RE = re.compile(
    r"Weights already exist at\s+(?P<path>\S+)"
)

# MEDIA template — trimmed and verified against real distil-large-v3 and
# speecht5_tts logs at .artifacts/tt-inference-server/workflow_logs/docker_server/.
#
# We deliberately collapse the early bookkeeping events (Settings init,
# Prometheus, service instance, worker spawn) into `container_starting`
# because they ALL fire within the first ~7 seconds of container life — before
# the frontend has even mounted HealthBadge after the deploy-page redirect.
# The user never sees them as distinct phases, so giving them dedicated pills
# is just visual noise.
#
# Real visible order: container → (download) → device init → model load → warmup → ready.
# No `server_starting` (media goes straight from warmup to /health 200).
# Real media-server chronology (verified from logs):
#   container start → UMD opens device → HF model fetched into device memory →
#   TTNN model construction → warmup → ready.
# This differs from LLMs where the download happens BEFORE the device opens.
MEDIA_PHASES = [
    "container_starting",
    "device_init",
    "downloading_weights",
    "loading_weights",
    "warming_up",
    "ready",
]

MEDIA_PHASE_LABELS = {
    "container_starting":  "Starting container",
    "device_init":         "Opening Tenstorrent device",
    "downloading_weights": "Downloading model weights",
    "loading_weights":     "Loading model weights",
    "warming_up":          "Warming up runner",
    "ready":               "Ready",
}

# loading_weights dominates real wall-clock (~70% on speecht5_tts), so its band
# is the widest. Sub-step counting inside the band (see MEDIA_LOAD_TOTAL) lets
# the bar advance smoothly during the otherwise-silent HF model load.
MEDIA_PHASE_BASE_PCT = {
    "container_starting":  2,
    "device_init":         8,
    "downloading_weights": 14,
    "loading_weights":     24,
    "warming_up":          80,
    "ready":               100,
}

# Substring markers for tt-media-inference-server containers. Strings here are
# verified against real warmup logs of distil-large-v3 (whisper) and
# speecht5_tts at .artifacts/tt-inference-server/workflow_logs/docker_server/.
# Matched case-insensitively as a substring of the line — so timestamp/PID
# prefixes don't interfere and "Started X worker" / "X worker started" both fire.
# Order doesn't matter; latest match per line scan wins.
_MEDIA_SUBSTRING_MARKERS: list[tuple[str, str]] = [
    # ── container_starting: ALL early bookkeeping (~first 7 seconds) ────────
    # Container boot, model config resolution, Prometheus init, FastAPI/uvicorn
    # startup, and worker pool spawn — all collapsed into one phase. These
    # fire before the frontend has even started polling, so the user only ever
    # sees the *result* of these events (the pill is "done" by the time they
    # see it). No point in giving them dedicated phases.
    ("USING CACHE_ROOT",                       "container_starting"),
    ("MOUNTED VOLUME PERMISSIONS",             "container_starting"),
    ("SETTINGS INIT: MODEL=",                  "container_starting"),
    ("CONFIG LOOKUP: RUNNER=",                 "container_starting"),
    ("SETTINGS RESOLVED:",                     "container_starting"),
    ("SETTING UP PROMETHEUS METRICS",          "container_starting"),
    ("PROMETHEUS METRICS AVAILABLE",           "container_starting"),
    ("CREATING NEW AUDIO SERVICE",             "container_starting"),
    ("CREATING NEW VIDEO SERVICE",             "container_starting"),
    ("CREATING NEW IMAGE SERVICE",             "container_starting"),
    ("CREATING NEW TEXT_TO_SPEECH SERVICE",    "container_starting"),
    ("CREATING NEW TTS SERVICE",               "container_starting"),
    ("STARTED SERVER PROCESS",                 "container_starting"),
    ("WAITING FOR APPLICATION STARTUP",        "container_starting"),
    ("AUDIOPREPROCESSING WORKER",              "container_starting"),
    ("VIDEOPREPROCESSING WORKER",              "container_starting"),
    ("VIDEOPOSTPROCESSING WORKER",             "container_starting"),
    ("TTSPOSTPROCESSING WORKER",               "container_starting"),
    ("IMAGE POSTPROCESSING WORKER",            "container_starting"),
    ("STARTING WORKER ",                       "container_starting"),
    ("STARTED WORKER ",                        "container_starting"),
    ("ALL WORKERS STARTED IN SEQUENCE",        "container_starting"),
    ("APPLICATION STARTUP COMPLETE",           "container_starting"),
    ("UVICORN RUNNING ON",                     "container_starting"),

    # ── downloading_weights ─────────────────────────────────────────────────
    # Two trigger families:
    # 1. The wrapper at tt-media-server/utils/hugging_face_utils.py emits the
    #    "Downloading weights for model:" / "Model X already cached" lines —
    #    only fires for media services that go through that wrapper.
    # 2. The runner's transformers.from_pretrained() call emits
    #    "Device 0: Loading HuggingFace model: <repo>" — this fires for
    #    Whisper and SpeechT5. We treat it as a download trigger because:
    #    (a) it's the closest thing to a download event in those logs, and
    #    (b) byte tracking via du -sb tells us if it's already cached or not.
    ("DOWNLOADING WEIGHTS FOR MODEL:",         "downloading_weights"),
    ("ALREADY CACHED, SKIPPING DOWNLOAD",      "downloading_weights"),
    ("USING CACHED MODEL AT:",                 "downloading_weights"),
    ("MODEL ALREADY EXISTS LOCALLY AT:",       "downloading_weights"),
    ("LOADING HUGGINGFACE MODEL:",             "downloading_weights"),

    # ── device_init: UMD opens + device runner created ──────────────────────
    ("SETUP_RUNNER_ENVIRONMENT",               "device_init"),
    ("TT_VISIBLE_DEVICES",                     "device_init"),
    ("CREATING TOPOLOGYDISCOVERY",             "device_init"),
    ("ESTABLISHED FIRMWARE BUNDLE VERSION",    "device_init"),
    ("OPENING USER MODE DEVICE DRIVER",        "device_init"),
    ("TTWHISPERRUNNER",                        "device_init"),       # "created TTWhisperRunner for worker 0"
    ("TTSPEECHT5RUNNER",                       "device_init"),       # "created TTSpeechT5Runner for worker 0"

    # ── loading_weights: the dominant phase (~70% of total time for TTS) ────
    # Whisper-specific (audio preprocessing)
    ("LOADING SPEAKER DIARIZATION",            "loading_weights"),
    ("LOADING VAD MODEL",                      "loading_weights"),
    ("VAD MODEL LOADED",                       "loading_weights"),
    # Mesh device + HF model load completion (both whisper and TTS)
    ("CREATED MESH DEVICE",                    "loading_weights"),
    ("CREATING INFERENCE PIPELINE",            "loading_weights"),
    ("LOADING WHISPER MODEL",                  "loading_weights"),
    ("LOADING SPEECHT5 MODEL",                 "loading_weights"),
    ("SUCCESSFULLY LOADED HUGGINGFACE MODEL",  "loading_weights"),
    ("INITIALIZING TTNN MODEL COMPONENTS",     "loading_weights"),
    ("MODEL PARAMETERS PREPROCESSED",          "loading_weights"),
    ("INITIALIZING KV CACHE",                  "loading_weights"),
    ("SUCCESSFULLY INITIALIZED TTNN",          "loading_weights"),
    ("SUCCESSFULLY CREATED INFERENCE PIPELINE","loading_weights"),
    ("MODEL PIPELINE CREATED",                 "loading_weights"),
    ("MODEL LOADED AND PIPELINE READY",        "loading_weights"),
    # TTS-specific: speaker embeddings + TTNN model construction
    ("LOADING DEFAULT SPEAKER EMBEDDINGS",     "loading_weights"),
    ("DEFAULT SPEAKER EMBEDDINGS",             "loading_weights"),
    ("CREATING TTNN ENCODER",                  "loading_weights"),
    ("CREATING TTNN DECODER",                  "loading_weights"),
    ("CREATING TTNN POSTNET",                  "loading_weights"),
    ("SPEECHT5GENERATOR INITIALIZED",          "loading_weights"),
    ("TRACE GENERATOR INITIALIZED",            "loading_weights"),
    ("ALL SPEECHT5 MODELS INITIALIZED",        "loading_weights"),
    ("MODEL INITIALIZATION COMPLETED",         "loading_weights"),
    # Speculative — not seen in our logs but documented in diffusers/transformers
    ("LOADING VAE",                            "loading_weights"),
    ("LOADING UNET",                           "loading_weights"),
    ("LOADING TEXT ENCODER",                   "loading_weights"),
    ("LOADING TRANSFORMER",                    "loading_weights"),
    ("PIPELINE LOADED",                        "loading_weights"),

    # ── warming_up: model warmup loop (encoder sizes for TTS, decode for whisper)
    ("ENCODER WARM-UP DONE",                   "warming_up"),
    ("POSTNET WARM-UP DONE",                   "warming_up"),
    ("WARM-UP DONE FOR ENCODER_SIZE",          "warming_up"),
    ("MODEL WARMUP COMPLETED",                 "warming_up"),
    ("[WARMUP] ASYNC EXECUTED",                "warming_up"),
    ("STARTED WITH DEVICE RUNNER",             "warming_up"),
    ("FIRST DEVICE WARMED UP",                 "warming_up"),
    ("IS WARMED UP",                           "warming_up"),
    ("ALL DEVICES ARE WARMED UP AND READY",    "warming_up"),
    ("STARTING MODEL WARMUP",                  "warming_up"),
    ("RUNNING MODEL ON BATCH",                 "warming_up"),
    ("TIME TO ENCODER STATES",                 "warming_up"),
    ("ON-DEVICE SAMPLING TRACE",               "warming_up"),
    ("GENERATION SUCCESSFUL WITH TEMPERATURE", "warming_up"),
]

# Media-server-emitted download log lines.
#
# The "wrapper" path (tt-media-server/utils/hugging_face_utils.py) only fires
# for media services that explicitly route through that wrapper. The whisper
# and speecht5 runners DON'T — they call transformers.from_pretrained() which
# emits `Device 0: Loading HuggingFace model: <repo>` instead. We treat that
# as a download trigger too; byte tracking decides cached vs in-progress.
_DOWNLOAD_MEDIA_RE = re.compile(
    r"Downloading weights for model:\s+(?P<repo>\S+)"
)
_DOWNLOAD_MEDIA_CACHED_RE = re.compile(
    r"Model\s+(?P<repo>\S+)\s+already cached"
)
_DOWNLOAD_MEDIA_HF_LOAD_RE = re.compile(
    r"Loading HuggingFace model:\s+(?P<repo>\S+)"
)

# ---------------------------------------------------------------------------
# Shared regexes / model-type routing
# ---------------------------------------------------------------------------

# Latest "Service not ready after Xs" / "Cache generation in progress. Waited Xs".
_HEARTBEAT_RE = re.compile(
    r"(?:Service not ready after|Cache generation in progress\.\s*Waited)\s+(\d+(?:\.\d+)?)s"
)

# Warmup detail: "Warming up prefill for sequence length: 2048" (LLM only).
_WARMUP_SEQLEN_RE = re.compile(
    r"Warming up prefill for sequence length:\s*(\d+)", re.IGNORECASE
)

# Final readiness: uvicorn access-log answering /health with 200. Works for
# both templates since both use FastAPI/uvicorn.
_HEALTH_OK_RE = re.compile(r'"GET /health HTTP/1\.1" 200')

# Uvicorn access-log lines. tt-studio (every 3s) and the agent (multiple per
# second) poll /health and /v1/models continuously, and each request appends a
# line like:
#   INFO:     172.18.0.3:33278 - "GET /health HTTP/1.1" 500 Internal Server Error
# Inside ~10 seconds those fill the 200-line tail entirely, evicting the real
# warmup markers ("Model X already cached", "Opening user mode device driver",
# etc.). The classifier only needs the meaningful events, so drop access-log
# lines before scanning. The 200-OK /health line is matched separately above
# *before* we filter, so readiness detection still works.
_UVICORN_ACCESS_LOG_RE = re.compile(
    r'^\s*INFO:\s+\S+:\d+\s+-\s+"\S+\s+/\S*\s+HTTP/[\d.]+"\s+\d+'
)


def _is_noise_line(line: str) -> bool:
    """Return True for log lines we want to ignore in phase classification."""
    return bool(_UVICORN_ACCESS_LOG_RE.match(line))

# LLM compile-trace count.
_DONE_CAPTURE_RE = re.compile(
    r"Done Capturing (?:Prefill|Decode) Trace", re.IGNORECASE
)
COMPILE_TRACE_TOTAL = 5  # 4 prefill seq_lens + 1 decode capture.

# MEDIA sub-step counters for the long phases (loading_weights, warming_up). Verified against real distil-large-v3 / speecht5_tts logs.
_MEDIA_LOAD_STEP_RE = re.compile(
    r"Loading Whisper model|"
    r"Loading SpeechT5 model|"
    r"Loading HuggingFace model:|"
    r"Successfully loaded HuggingFace model components|"
    r"Created mesh device with|"
    r"Loading default speaker embeddings|"
    r"Loaded \d+ default speaker embeddings|"
    r"Creating TTNN (?:encoder|decoder|postnet)|"
    r"SpeechT5Generator initialized|"
    r"Trace generator initialized|"
    r"All SpeechT5 models initialized|"
    r"Model initialization completed",
    re.IGNORECASE,
)
MEDIA_LOAD_TOTAL = 8

_MEDIA_WARMUP_STEP_RE = re.compile(
    r"Encoder warm-up done for size|"
    r"Postnet warm-up done|"
    r"Warm-up done for encoder_size|"
    r"Model warmup completed|"
    r"\[warmup\] async executed|"
    r"is warmed up|"
    r"All devices are warmed up",
    re.IGNORECASE,
)
MEDIA_WARMUP_TOTAL = 8

# tt-studio ModelTypes (mirror of shared_config.model_type_config.ModelTypes)
# that should be classified as MEDIA. Everything else → LLM.
_MEDIA_MODEL_TYPES = frozenset({
    "speech_recognition",
    "tts",
    "image_generation",
    "video_generation",
    "object_detection",
    "cnn",
    "face_recognition",
})

# Backstop name patterns — used when the caller doesn't pass a model_type
# hint and we have to guess from the model name.
_MEDIA_NAME_PATTERNS = [
    re.compile(r"whisper",                 re.IGNORECASE),
    re.compile(r"distil-large",            re.IGNORECASE),
    re.compile(r"^speecht5",               re.IGNORECASE),
    re.compile(r"^stable-diffusion",       re.IGNORECASE),
    re.compile(r"^flux\.",                 re.IGNORECASE),
    re.compile(r"^qwen-image",             re.IGNORECASE),
    re.compile(r"^motif-image",            re.IGNORECASE),
    re.compile(r"^wan2",                   re.IGNORECASE),
    re.compile(r"^mochi",                  re.IGNORECASE),
    re.compile(r"^yolo",                   re.IGNORECASE),
    re.compile(r"^resnet",                 re.IGNORECASE),
    re.compile(r"^efficientnet",           re.IGNORECASE),
    re.compile(r"^mobilenetv2",            re.IGNORECASE),
    re.compile(r"^vit$",                   re.IGNORECASE),
    re.compile(r"^vovnet",                 re.IGNORECASE),
    re.compile(r"^unet$",                  re.IGNORECASE),
    re.compile(r"^segformer",              re.IGNORECASE),
]


def category_for_model(model_type: Optional[str] = None, model_name: Optional[str] = None) -> str:
    """Return 'media' or 'llm' for the given model identifiers.

    Resolution order:
      1. `model_type` from the registry (definitive when present)
      2. `model_name` regex backstop
      3. Default to 'llm' (the more common case)
    """
    if model_type:
        if str(model_type).lower() in _MEDIA_MODEL_TYPES:
            return "media"
        return "llm"
    if model_name:
        for pat in _MEDIA_NAME_PATTERNS:
            if pat.search(model_name):
                return "media"
    return "llm"


def _template_for(category: str) -> tuple[
    list[str], dict[str, str], dict[str, int], list[tuple[str, str]]
]:
    """Return (phases, phase_labels, phase_base_pct, substring_markers)."""
    if category == "media":
        return (MEDIA_PHASES, MEDIA_PHASE_LABELS, MEDIA_PHASE_BASE_PCT, _MEDIA_SUBSTRING_MARKERS)
    return (LLM_PHASES, LLM_PHASE_LABELS, LLM_PHASE_BASE_PCT, _LLM_SUBSTRING_MARKERS)


def _now() -> float:
    return time.time()


def classify_startup_phase(
    lines: Iterable[str],
    now: Optional[float] = None,
    model_type: Optional[str] = None,
    model_name: Optional[str] = None,
) -> dict:
    """Classify a snapshot of recent container stdout lines into a phase summary.

    Args:
        lines: log lines in chronological order (oldest first).
        now: optional wall-clock override (tests).
        model_type: registry `ModelTypes` value (e.g. "chat", "speech_recognition").
            When provided, selects the LLM or MEDIA phase template directly.
        model_name: fallback identifier — used to regex-route to MEDIA when
            no `model_type` hint is available.

    Returns:
        dict with: phase, phase_label, progress, message, last_heartbeat_seconds,
        warmup_seq_len, trace_count, classified_at, weights_repo,
        weights_target_path, weights_cached, phases, phase_labels,
        phase_base_pct, category.
    """
    current_now = now if now is not None else _now()
    category = category_for_model(model_type=model_type, model_name=model_name)
    phases, phase_labels, phase_base_pct, substring_markers = _template_for(category)

    phase: Optional[str] = None
    last_meaningful_line: Optional[str] = None
    last_heartbeat_seconds: Optional[float] = None
    warmup_seq_len: Optional[int] = None
    trace_count = 0
    media_load_count = 0
    media_warmup_count = 0
    saw_health_ok = False
    weights_repo: Optional[str] = None
    weights_target_path: Optional[str] = None
    weights_cached: bool = False

    for raw in lines:
        if not raw:
            continue
        line = raw.rstrip()

        # Final readiness overrides everything — check this *before* filtering
        # noise because the 200-OK signal lives inside a uvicorn access-log line.
        if _HEALTH_OK_RE.search(line):
            saw_health_ok = True

        # Skip per-request access-log entries so they don't crowd the real
        # warmup events out of the tail buffer.
        if _is_noise_line(line):
            continue

        upper = line.upper()

        # Phase markers (substring scan, category-specific).
        for needle, candidate_phase in substring_markers:
            if needle in upper:
                phase = candidate_phase
                last_meaningful_line = line
                break

        # Capture download repo + (optional) container path. The LLM variant
        # logs both repo and path; the media variant logs only repo. The
        # registry/model spec lets the backend compute the cache path later
        # if it ever needs to du(1) into the HF hub layout.
        if category == "media":
            m = _DOWNLOAD_MEDIA_RE.search(line)
            if m:
                weights_repo = m.group("repo")
                weights_cached = False
            else:
                m = _DOWNLOAD_MEDIA_CACHED_RE.search(line)
                if m:
                    weights_repo = m.group("repo")
                    weights_cached = True
                else:
                    # The runner's transformers.from_pretrained path — fires
                    # whether cached or not. compute_download_progress will set
                    # weights_cached=True later if du(1) shows the cache dir
                    # already has the full payload.
                    m = _DOWNLOAD_MEDIA_HF_LOAD_RE.search(line)
                    if m:
                        weights_repo = m.group("repo")
        else:
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

        # LLM-only: count completed compile-trace captures.
        if category == "llm" and _DONE_CAPTURE_RE.search(line):
            trace_count += 1

        # LLM-only: latest "Warming up prefill" seq_len.
        if category == "llm":
            m = _WARMUP_SEQLEN_RE.search(line)
            if m:
                try:
                    warmup_seq_len = int(m.group(1))
                except ValueError:
                    pass

        # MEDIA-only: count milestones inside the long phases so the bar
        # advances during the otherwise-silent HF model load + warmup loop.
        if category == "media":
            if _MEDIA_LOAD_STEP_RE.search(line):
                media_load_count += 1
            if _MEDIA_WARMUP_STEP_RE.search(line):
                media_warmup_count += 1

        # Heartbeat (LLM-only marker, but cheap to check regardless).
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
        phase = phases[0]  # first phase in the active template

    progress = phase_base_pct.get(phase, 0)

    # LLM-only: layer trace_count progress on top of compiling_model so the
    # bar visibly advances during the long compile. Spans
    # compiling_model → engine_ready - 2 (leaves a 2% gap for the boundary).
    if category == "llm" and phase == "compiling_model" and trace_count > 0:
        capped = min(trace_count, COMPILE_TRACE_TOTAL)
        progress = phase_base_pct["compiling_model"] + int(
            (capped / COMPILE_TRACE_TOTAL)
            * (phase_base_pct["engine_ready"] - phase_base_pct["compiling_model"] - 2)
        )

    # MEDIA-only: equivalent refinement for the two long phases. Without this
    # the bar would sit at the phase base for minutes during the HF model
    # load and the encoder-size warmup loop.
    if category == "media" and phase == "loading_weights" and media_load_count > 0:
        capped = min(media_load_count, MEDIA_LOAD_TOTAL)
        progress = phase_base_pct["loading_weights"] + int(
            (capped / MEDIA_LOAD_TOTAL)
            * (phase_base_pct["warming_up"] - phase_base_pct["loading_weights"] - 2)
        )
    elif category == "media" and phase == "warming_up" and media_warmup_count > 0:
        capped = min(media_warmup_count, MEDIA_WARMUP_TOTAL)
        progress = phase_base_pct["warming_up"] + int(
            (capped / MEDIA_WARMUP_TOTAL)
            * (phase_base_pct["ready"] - phase_base_pct["warming_up"] - 2)
        )

    # Human-readable message line.
    message = last_meaningful_line or ""
    if category == "llm" and phase == "compiling_model":
        detail_parts = []
        if warmup_seq_len:
            detail_parts.append(f"prefill seq_len {warmup_seq_len}")
        if trace_count > 0:
            detail_parts.append(f"trace {min(trace_count, COMPILE_TRACE_TOTAL)}/{COMPILE_TRACE_TOTAL}")
        if detail_parts:
            message = " · ".join(detail_parts)

    return {
        "phase": phase,
        "phase_label": phase_labels.get(phase, phase),
        "progress": progress,
        "message": message[:300],
        "last_heartbeat_seconds": last_heartbeat_seconds,
        "warmup_seq_len": warmup_seq_len,
        "trace_count": trace_count,
        "classified_at": current_now,
        "weights_repo": weights_repo,
        "weights_target_path": weights_target_path,
        "weights_cached": weights_cached,
        # Category-aware template embedded so the frontend renders only the phases for this model type.
        "category": category,
        "phases": list(phases),
        "phase_labels": dict(phase_labels),
        "phase_base_pct": dict(phase_base_pct),
    }
