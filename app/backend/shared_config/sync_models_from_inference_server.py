# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Sync script: reads ../../tt-inference-server/model_specs_output.json and
normalizes it into models_from_inference_server.json (co-located with this script).

Run from any directory:
    python app/backend/shared_config/sync_models_from_inference_server.py
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
OUTPUT_JSON = SCRIPT_DIR / "models_from_inference_server.json"

# Source JSON resolution order:
#   1. Explicit --source CLI argument
#   2. TT_INFERENCE_ARTIFACT_PATH env var (set by run.py after artifact download)
#   3. .artifacts/tt-inference-server/ next to repo root (artifact default location)
#   4. tt-inference-server/ next to repo root (manual local dev checkout)
_REPO_ROOT = SCRIPT_DIR / "../../.."
_CANDIDATE_SOURCES = [
    _REPO_ROOT / ".artifacts/tt-inference-server/model_specs_output.json",
    _REPO_ROOT / ".artifacts/tt-inference-server/model_spec.json",
    _REPO_ROOT / "tt-inference-server/model_specs_output.json",
    _REPO_ROOT / "tt-inference-server/model_spec.json",
]


def resolve_source_json(override: str | None = None) -> Path:
    """Return the path to model_specs_output.json, trying candidates in order."""
    if override:
        p = Path(override)
        if not p.exists():
            raise FileNotFoundError(f"--source path not found: {p}")
        return p.resolve()

    # Check env var set by run.py
    artifact_path = os.environ.get("TT_INFERENCE_ARTIFACT_PATH")
    if artifact_path:
        p = Path(artifact_path) / "model_specs_output.json"
        if p.exists():
            return p.resolve()

    # Try static candidates
    for candidate in _CANDIDATE_SOURCES:
        if candidate.exists():
            return candidate.resolve()

    raise FileNotFoundError(
        "Cannot find model_specs_output.json. Tried:\n"
        + "\n".join(f"  {c.resolve()}" for c in _CANDIDATE_SOURCES)
    )

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEVICE_SPECIFIC_ENV_KEYS = {"WH_ARCH_YAML", "MESH_DEVICE", "ARCH_NAME"}

STATUS_ORDER = {"COMPLETE": 3, "FUNCTIONAL": 2, "EXPERIMENTAL": 1}

# device_type string (from tt-inference-server) → DeviceConfigurations member name
# Only include device_types that exist in DeviceConfigurations enum.
# Keyed by UPPERCASE artifact device_type; lookups normalize via .upper() so casing
# drift (e.g. artifact "P300X2" vs tt-studio enum "P300x2") can't silently drop devices.
DEVICE_TYPE_TO_CONFIG = {
    "N150": "N150",
    "N300": "N300",
    "T3K": "T3K",
    "N150X4": "N150X4",
    "P100": "P100",
    "P150": "P150",
    "P150X4": "P150X4",
    "P150X8": "P150X8",
    "GALAXY": "GALAXY",
    "GALAXY_T3K": "GALAXY_T3K",
    # Blackhole P300 family: artifact uses UPPERCASE, tt-studio enum uses lowercase "x"
    "P300": "P300",
    "P300X2": "P300x2",
}


def map_model_type(raw_model_type: str, inference_engine: str) -> str:
    """Map tt-inference-server model_type + inference_engine to tt-studio ModelTypes."""
    if raw_model_type == "LLM" and inference_engine == "vLLM":
        return "CHAT"
    if raw_model_type == "VLM":
        return "VLM"
    if raw_model_type == "IMAGE":
        return "IMAGE_GENERATION"
    if raw_model_type == "AUDIO":
        return "SPEECH_RECOGNITION"
    if raw_model_type == "TEXT_TO_SPEECH" or raw_model_type == "TTS":
        return "TTS"
    if raw_model_type == "VIDEO":
        return "VIDEO"
    if raw_model_type == "EMBEDDING":
        return "EMBEDDING"
    # CNN + media engine = image generation (FLUX, Motif, etc.)
    if raw_model_type == "CNN" and inference_engine == "media":
        return "IMAGE_GENERATION"
    # CNN + forge = computer vision / object detection (resnet, vit, etc.)
    if raw_model_type == "CNN" and inference_engine == "forge":
        return "CNN"
    return "CHAT"


CHAT_CAPABLE_PATTERNS = [
    "instruct", "-chat", "chat-", "-it-", "-it", "assistant",
    # Reasoning / thinking models that do have chat templates
    "deepseek-r1", "qwq", "qwen3", "gpt-oss",
]


def is_chat_capable(hf_model_id: str) -> bool:
    lower = hf_model_id.lower()
    return any(p in lower for p in CHAT_CAPABLE_PATTERNS)


def map_service_route(inference_engine: str, hf_model_id: str = "", raw_model_type: str = "") -> str:
    """Derive service_route from inference_engine, model type, and model id.
    
    Args:
        inference_engine: Engine type (vLLM, media, forge)
        hf_model_id: HuggingFace model ID (for vLLM chat detection)
        raw_model_type: Raw model type from inference server (TEXT_TO_SPEECH, TTS, etc.)
    """
    if inference_engine == "vLLM":
        return "/v1/chat/completions" if is_chat_capable(hf_model_id) else "/v1/completions"
    if inference_engine == "media":
        # TTS models use OpenAI-compatible /v1/audio/speech endpoint
        if raw_model_type in ("TEXT_TO_SPEECH", "TTS"):
            return "/v1/audio/speech"
        # Speech recognition models use OpenAI-compatible /v1/audio/transcriptions endpoint
        if raw_model_type in ("AUDIO", "SPEECH_RECOGNITION"):
            return "/v1/audio/transcriptions"
        # Image generation models use the OpenAI-compatible synchronous endpoint
        if raw_model_type in ("IMAGE", "IMAGE_GENERATION"):
            return "/v1/images/generations"
        # Video generation models use the OpenAI-compatible video endpoint
        if raw_model_type in ("VIDEO", "VIDEO_GENERATION"):
            if "i2v" in hf_model_id.lower():
                return "/v1/videos/generations/i2v"
            return "/v1/videos/generations"
        # Other media models (embedding, etc.) use enqueue
        return "/enqueue"
    if inference_engine == "forge":
        return "/v1/chat/completions"
    return "/v1/chat/completions"


def map_health_route(inference_engine: str, service_route: str) -> str:
    """Derive health_route from inference_engine and service_route.
    
    Args:
        inference_engine: Engine type (vLLM, media, forge)
        service_route: The service route (e.g., /enqueue, /v1/audio/speech)
    
    Returns:
        The appropriate health check endpoint
    """
    # All models (vLLM, forge, media) use /health — GET / returns 404 on the media server
    return "/health"


def filter_env_vars(env_vars: dict) -> dict:
    """Strip device-specific env vars that ModelImpl.__post_init__ handles.

    Values are coerced to str: they become Docker container environment
    variables (model_config.py applies them to cfg["environment"]), which
    must be strings. The artifact emits int-valued vars (e.g.
    VLLM_ALLOW_LONG_MAX_MODEL_LEN=1) that would otherwise break.
    """
    return {
        k: str(v)
        for k, v in env_vars.items()
        if k not in DEVICE_SPECIFIC_ENV_KEYS
    }


def pick_higher_status(current: str | None, candidate: str) -> str:
    """Return whichever status is higher priority."""
    if current is None:
        return candidate
    return current if STATUS_ORDER.get(current, 0) >= STATUS_ORDER.get(candidate, 0) else candidate


def _version_key(entry: dict) -> tuple[int, tuple[int, ...]]:
    """Sort key for selecting the highest-version device entry.

    The artifact stores one entry per device_type, each with its own version
    and docker_image. We pick the highest semantic version as the canonical
    source for model-level version/image (e.g. FLUX.1-dev P300X2=0.14.0 over
    the T3K=0.10.0 entry that happens to come first). Unparseable versions
    sort lowest so a valid version always wins.

    Stdlib-only (no `packaging`): the sync script runs on the host interpreter
    via run.py, where `packaging` is not a guaranteed dependency. We parse a
    version string like "0.14.0" / "0.10.1" / "0.14.0-rc1" into a tuple of ints
    by splitting on "." and dropping any non-numeric "-suffix" before parsing.
    Returns (1, tuple) for parseable versions and (0, ()) — which sorts lowest —
    for missing/unparseable ones, so a valid version always wins.
    """
    raw = entry.get("version") or "0.0.0"
    # Strip a pre-release/build suffix ("0.14.0-rc1" → "0.14.0") before splitting.
    core = str(raw).split("-", 1)[0]
    parts: list[int] = []
    for component in core.split("."):
        if not component.isdigit():
            # Non-numeric component (e.g. empty or "x"): treat as unparseable.
            return (0, ())
        parts.append(int(component))
    if not parts:
        return (0, ())
    return (1, tuple(parts))


def pick_canonical_entry(entries: list[dict]) -> dict:
    """Return the entry with the highest version (ties keep artifact order)."""
    return max(entries, key=_version_key)


def _iter_v1_entries(model_specs: dict):
    """Flatten schema_version=0.1.0 nested structure to leaf entry dicts."""
    for _hf_id, by_device in model_specs.items():
        for _device_type, by_engine in by_device.items():
            for _engine, by_impl in by_engine.items():
                for _impl_name, entry in by_impl.items():
                    if isinstance(entry, dict):
                        yield entry


def normalize(source_path: Path) -> list[dict]:
    with open(source_path) as f:
        raw = json.load(f)

    # Handle v0.1.0 schema (model_spec.json) vs legacy flat format (model_specs_output.json)
    if isinstance(raw, dict) and "model_specs" in raw:
        entries = list(_iter_v1_entries(raw["model_specs"]))
    else:
        entries = [v for v in raw.values() if isinstance(v, dict)]

    # group by model_name, skipping GPU entries
    by_model: dict[str, list[dict]] = {}
    for entry in entries:
        if entry.get("device_type") == "GPU":
            continue
        name = entry["model_name"]
        by_model.setdefault(name, []).append(entry)

    models = []
    for model_name, entries in by_model.items():
        # Use first entry for genuinely model-level fields that are identical
        # across all device entries (hf_model_repo, model_type, engine, ...).
        first = entries[0]
        # version/docker_image vary per device entry, so pick the highest version.
        canonical = pick_canonical_entry(entries)

        # Aggregate device_types (union across all entries). Lookup is
        # case-insensitive so artifact casing drift can't silently drop a device.
        device_configurations = sorted(
            {
                DEVICE_TYPE_TO_CONFIG[(e.get("device_type") or "").upper()]
                for e in entries
                if (e.get("device_type") or "").upper() in DEVICE_TYPE_TO_CONFIG
            }
        )

        # Pick highest status
        status = None
        for e in entries:
            status = pick_higher_status(status, e.get("status", "EXPERIMENTAL"))

        # Model-level env_vars (from first entry, strip device-specific keys)
        env_vars = filter_env_vars(first.get("env_vars") or {})

        inference_engine = first.get("inference_engine", "vLLM")
        raw_model_type = first.get("model_type", "LLM")
        service_route = map_service_route(inference_engine, hf_model_id=first.get("hf_model_repo", ""), raw_model_type=raw_model_type)

        models.append({
            "model_name": model_name,
            "model_type": map_model_type(raw_model_type, inference_engine),
            "display_model_type": raw_model_type,
            "device_configurations": device_configurations,
            "hf_model_id": first.get("hf_model_repo"),
            "inference_engine": inference_engine,
            "supported_modalities": first.get("supported_modalities", ["text"]),
            "status": status,
            "version": canonical.get("version", "0.0.0"),
            "docker_image": canonical.get("docker_image"),
            "service_route": service_route,
            "health_route": map_health_route(inference_engine, service_route),
            "shm_size": "32G",
            "setup_type": "TT_INFERENCE_SERVER",
            "env_vars": env_vars,
            "param_count": first.get("param_count"),
        })

    # Sort: by status (highest first), then alphabetically by model_name
    models.sort(key=lambda m: (-STATUS_ORDER.get(m["status"], 0), m["model_name"].lower()))
    return models


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Sync model catalog from tt-inference-server")
    parser.add_argument("--source", default=None, help="Path to model_specs_output.json (overrides auto-detection)")
    args = parser.parse_args()

    source_path = resolve_source_json(args.source)
    print(f"Reading: {source_path}")

    if not source_path.exists():
        raise FileNotFoundError(f"Source not found: {source_path}")

    models = normalize(source_path)

    # Resolve artifact version from VERSION file or env vars (avoid leaking absolute paths)
    artifact_version = None
    version_file = source_path.parent / "VERSION"
    if version_file.exists():
        artifact_version = version_file.read_text().strip()
    if not artifact_version:
        artifact_version = (
            os.environ.get("TT_INFERENCE_ARTIFACT_VERSION")
            or os.environ.get("TT_INFERENCE_ARTIFACT_BRANCH")
            or "unknown"
        )

    catalog = {
        "source": {
            "artifact_version": artifact_version,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "total_models": len(models),
        "models": models,
    }

    out_path = OUTPUT_JSON.resolve()
    with open(out_path, "w") as f:
        json.dump(catalog, f, indent=2)
        f.write("\n")

    print(f"Written {len(models)} models → {out_path}")

    # Print a summary
    from collections import Counter
    status_counts = Counter(m["status"] for m in models)
    type_counts = Counter(m["model_type"] for m in models)
    display_type_counts = Counter(m["display_model_type"] for m in models)
    print(f"  Status distribution:       {dict(status_counts)}")
    print(f"  Type distribution:         {dict(type_counts)}")
    print(f"  Display type distribution: {dict(display_type_counts)}")


if __name__ == "__main__":
    main()
