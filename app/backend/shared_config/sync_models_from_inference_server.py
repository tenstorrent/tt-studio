# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
#   4. tt-inference-server/ next to repo root (legacy submodule path)
_REPO_ROOT = SCRIPT_DIR / "../../.."
_CANDIDATE_SOURCES = [
    _REPO_ROOT / ".artifacts/tt-inference-server/model_specs_output.json",
    _REPO_ROOT / "tt-inference-server/model_specs_output.json",
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
# Only include device_types that exist in DeviceConfigurations enum
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


def map_service_route(inference_engine: str) -> str:
    """Derive service_route from inference_engine."""
    if inference_engine == "vLLM":
        return "/v1/chat/completions"
    if inference_engine == "media":
        return "/enqueue"
    if inference_engine == "forge":
        return "/v1/chat/completions"
    return "/v1/chat/completions"


def filter_env_vars(env_vars: dict) -> dict:
    """Strip device-specific env vars that ModelImpl.__post_init__ handles."""
    return {k: v for k, v in env_vars.items() if k not in DEVICE_SPECIFIC_ENV_KEYS}


def pick_higher_status(current: str | None, candidate: str) -> str:
    """Return whichever status is higher priority."""
    if current is None:
        return candidate
    return current if STATUS_ORDER.get(current, 0) >= STATUS_ORDER.get(candidate, 0) else candidate


def normalize(source_path: Path) -> list[dict]:
    with open(source_path) as f:
        raw = json.load(f)

    # group by model_name, skipping GPU entries
    by_model: dict[str, list[dict]] = {}
    for entry in raw.values():
        if entry.get("device_type") == "GPU":
            continue
        name = entry["model_name"]
        by_model.setdefault(name, []).append(entry)

    models = []
    for model_name, entries in by_model.items():
        # Use first entry as the canonical source for model-level fields
        first = entries[0]

        # Aggregate device_types
        device_configurations = sorted(
            {
                DEVICE_TYPE_TO_CONFIG[e["device_type"]]
                for e in entries
                if e.get("device_type") in DEVICE_TYPE_TO_CONFIG
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

        models.append({
            "model_name": model_name,
            "model_type": map_model_type(raw_model_type, inference_engine),
            "display_model_type": raw_model_type,
            "device_configurations": device_configurations,
            "hf_model_id": first.get("hf_model_repo"),
            "inference_engine": inference_engine,
            "supported_modalities": first.get("supported_modalities", ["text"]),
            "status": status,
            "version": first.get("version", "0.0.1"),
            "docker_image": first.get("docker_image"),
            "service_route": map_service_route(inference_engine),
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
