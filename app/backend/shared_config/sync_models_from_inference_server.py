# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Sync script: reads ../../tt-inference-server/release_model_spec.json (or the
legacy model_specs_output.json / model_spec.json names) and normalizes it into
models_from_inference_server.json (co-located with this script).

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
# Filenames tried per directory, newest release layout first:
_SOURCE_FILENAMES = ["release_model_spec.json", "model_specs_output.json", "model_spec.json"]
_REPO_ROOT = SCRIPT_DIR / "../../.."
_CANDIDATE_SOURCES = [
    _REPO_ROOT / f".artifacts/tt-inference-server/{name}" for name in _SOURCE_FILENAMES
] + [
    _REPO_ROOT / f"tt-inference-server/{name}" for name in _SOURCE_FILENAMES
]


# Catalog keys that are curated by hand and can never be derived from the
# tt-inference-server source JSON. Without explicit preservation, every resync
# rebuilds the catalog from scratch and silently drops them -- someone fixes a
# deploy by editing the catalog, then loses the fix on the next --resync with no
# error. Adding a future hand-owned field means adding it here. See issue #977.
HAND_OWNED_KEYS = ("requires_dev_catalog", "inference_artifact_ref", "hand_owned")

# Marker on a catalog entry that exists only because someone added it by hand
# (e.g. the forge TRAINING rows, which no prod release snapshot contains). Such
# an entry outranks a synced entry of the same model_name: the source JSON has a
# vLLM CHAT "Llama-3.1-8B" whose name collides with the hand-added forge TRAINING
# one, and without this the resync silently replaces the training row -- taking
# the fine-tuning feature offline, since training_control filters on
# model_type == TRAINING. Catalog model_name must stay unique: several lookups
# (model_config.get_model_impl, docker_utils' deployment->impl mapping) take the
# first name match, so keeping both would make them pick arbitrarily.
HAND_OWNED_MARKER = "hand_owned"

# ---------------------------------------------------------------------------
# Studio availability
# ---------------------------------------------------------------------------
# The source artifact advertises models TT-Studio must not offer in its deploy
# dropdown. Deleting those rows from the catalog was the old approach and it
# does not survive: normalize() rebuilds from the source JSON, so every removal
# had to be re-done by hand after each resync (see the string of "remove
# non-working models" commits), and the catalog lost the record of *why* a model
# was pulled. Instead the rows stay and carry a mark, applied on every sync from
# the two tables below, so hiding a model is a one-line, reproducible edit here
# rather than a JSON deletion someone has to remember to repeat.
#
# Two distinct reasons, deliberately not conflated:
#   known_broken          - the model does not deploy or does not run correctly
#                           on TT hardware today. It is a bug, and the details
#                           say what breaks.
#   unsupported_in_studio - the model works fine on the inference server, but
#                           TT-Studio has no UI for its modality yet. Nothing is
#                           broken; there is just nowhere to put it.
#
# These marks are script-owned, NOT hand-owned: the tables here are the single
# source of truth, so deleting an entry below genuinely unhides the model on the
# next sync instead of a stale flag in the JSON resurrecting it.
STUDIO_UNAVAILABLE_REASONS = ("known_broken", "unsupported_in_studio")

# Model types TT-Studio can deploy but has no interface for. These work.
UNSUPPORTED_STUDIO_MODEL_TYPES = {
    "EMBEDDING": (
        "No embeddings UI in TT-Studio yet; the model itself deploys and serves "
        "correctly on the inference server."
    ),
}

# Model-wide overrides, keyed by catalog model_name, for breakage that is
# genuinely independent of hardware (a bad chat template, a missing weight file,
# a broken container image). Each value is (reason, details).
#
# Prefer STUDIO_UNAVAILABLE_DEVICES: most failures we see are one board's, and a
# model-wide mark hides the model from boards nobody ever tested. Only add here
# when the failure is known not to be board-specific -- and say how you know.
_FORGE_CACHE_ROOT_BUG = (
    "Not deployable today, and not because of any board: the forge image runs as "
    "USER=container_app_user (uid 1000) while CACHE_ROOT's named Docker volume is "
    "created root-owned, so warmup dies in ~0.3s with a PermissionError on "
    "cache_root/huggingface before the device is ever opened. Verified on P300x2; "
    "the same volume ownership applies on every board. Drop this entry once the "
    "forge image ships a uid-1000-owned cache_root."
)

STUDIO_UNAVAILABLE_MODELS: dict[str, tuple[str, str]] = {
    # yolox_nano will be available in tt-inference-server release after merging of raahem/yolox_nano_qb2 into main branch
    # or once the object detection UI is fixed in TT-Studio and the model is added to the catalog with a custom branch.
    "yolox_nano": ("known_broken", _FORGE_CACHE_ROOT_BUG),
    "Falcon3-7B-Instruct": ("known_broken", _FORGE_CACHE_ROOT_BUG),
}



# Per-device unavailability: the artifact advertises a model on several boards
# and it genuinely works on some of them. Marking the whole model hidden would
# throw away the boards where it runs, so these are keyed by
# model_name -> {device_configuration: (reason, details)}. Device keys use the
# tt-studio spelling that lands in "device_configurations" (e.g. "P300x2").
#
# The sync REMOVES the named device from device_configurations and records why in
# an "unavailable_devices" object. That is deliberate: every consumer already
# gates on device_configurations (docker_control's compatibility check, the
# frontend's is_compatible badge, infer_chips_required), so per-device hiding
# needs no new logic anywhere -- the model simply stops claiming a board it
# cannot run on, and the reason stays in the file for whoever asks later.
#
# If every device is removed this way, the model falls back to being hidden
# outright rather than being left with an empty device list.
STUDIO_UNAVAILABLE_DEVICES: dict[str, dict[str, tuple[str, str]]] = {
    "Z-Image-Turbo": {
        "P300x2": (
            "known_broken",
            (
                "Wedges Blackhole P300 devices during warmup (eth-core init timeout "
                "or a hard device hang mid kernel-compile) badly enough that the host "
                "needs a board reset. Re-enable once the media image ships a "
                "tt-metal/firmware combo validated on fw 19.7.0."
            ),
        ),
    },
    "Motif-Image-6B-Preview": {
        "P300x2": (
            "known_broken",
            (
                "Media container never reaches a healthy state. Verified broken on a "
                "P300x2 (4x p300c Blackhole) box. Untested on this model's other "
                "boards, so it stays available there."
            ),
        ),
    },
    "gpt-oss-120b": {
        "P300x2": (
            "known_broken",
            (
                "vLLM container never reaches a healthy state. Verified broken on a "
                "P300x2 (4x p300c Blackhole) box. Untested on this model's other "
                "boards, so it stays available there."
            ),
        ),
    },
    "mochi-1-preview": {
        "P300x2": (
            "known_broken",
            (
                "Deploy fails with the catalog-pinned image; needs a newer media "
                "image plus a spec-level env override the artifact does not carry. "
                "Verified broken on a P300x2 (4x p300c Blackhole) box. Untested on "
                "this model's other boards, so it stays available there."
            ),
        ),
    },
    "bge-m3": {
        "P300x2": (
            "known_broken",
            (
                "Non-functional deploy (#869). Separate from the embedding modality "
                "gap: this model does not run. Verified broken on a P300x2 (4x p300c "
                "Blackhole) box. Untested on this model's other boards, so it stays "
                "available there."
            ),
        ),
    },
    "DeepSeek-R1-Distill-Llama-70B": {
        "P300x2": (
            "known_broken",
            (
                "Non-functional deploy (#869). Verified broken on a P300x2 (4x p300c "
                "Blackhole) box. Untested on this model's other boards, so it stays "
                "available there."
            ),
        ),
    },
    "Llama-3.1-70B": {
        "P300x2": (
            "known_broken",
            (
                "Base (non-instruct) 70B pulled alongside the Instruct variant in "
                "#904; deploy does not resolve a usable image. Verified broken on a "
                "P300x2 (4x p300c Blackhole) box. Untested on this model's other "
                "boards, so it stays available there."
            ),
        ),
    },
    "Llama-3.1-70B-Instruct": {
        "P300x2": (
            "known_broken",
            (
                "Removed from the deploy UI in #904 - deploy needs a docker image "
                "override the catalog cannot express. Use Llama-3.3-70B-Instruct. "
                "Verified broken on a P300x2 (4x p300c Blackhole) box. Untested on "
                "this model's other boards, so it stays available there."
            ),
        ),
    },
    "Qwen3-8B": {
        "P300": (
            "known_broken",
            (
                "Removed from the deploy UI in #878 after failing on our Blackhole "
                "box. Scoped to P300 rather than P300x2 because this model only ever "
                "claims the single-chip Blackhole device; its Wormhole boards "
                "(N150/N300/T3K/Galaxy) are untested and stay available."
            ),
        ),
    },
    "Llama-3.3-70B-Instruct": {
        "P150X4": (
            "known_broken",
            (
                "Trace region size currently set to 30MB, it needs to be increased to minimum 57MB."
            ),
        ),
    }
}


def apply_device_availability(models: list) -> list:
    """Drop per-device entries a board can't actually run, recording why.

    Returns [(model_name, device, reason)] for what was removed. Idempotent: the
    device is already gone on a re-run, and the recorded reason is rebuilt from
    the table rather than trusted from the file.
    """
    removed = []
    for model in models:
        model.pop("unavailable_devices", None)
        overrides = STUDIO_UNAVAILABLE_DEVICES.get(model["model_name"])
        if not overrides:
            continue

        devices = list(model.get("device_configurations") or [])
        marks = {}
        for device, (reason, details) in overrides.items():
            if reason not in STUDIO_UNAVAILABLE_REASONS:
                raise ValueError(
                    f"{model['model_name']}/{device}: unknown reason {reason!r}; "
                    f"expected one of {STUDIO_UNAVAILABLE_REASONS}"
                )
            # Record the mark even if the artifact never claimed this device, so a
            # stale table entry is visible rather than silently doing nothing.
            marks[device] = {"reason": reason, "details": details}
            if device in devices:
                devices.remove(device)
                removed.append((model["model_name"], device, reason))
            else:
                # The key matched no declared device, so nothing was blocked. Nearly
                # always a typo -- "P150x4" vs the catalog's "P150X4" shipped once
                # and left the model on offer on a board it was meant to be pulled
                # from. Say so loudly; a silent no-op is the whole failure mode.
                near = [d for d in devices if d.lower() == device.lower()]
                hint = f" Did you mean {near[0]!r}?" if near else ""
                print(
                    f"WARNING: {model['model_name']}: '{device}' is not one of its "
                    f"devices {devices}, so nothing was blocked.{hint}"
                )

        model["device_configurations"] = devices
        model["unavailable_devices"] = marks

        # Nothing left to deploy on: hide the model rather than shipping an entry
        # with an empty device list, which every board would read as incompatible
        # with no explanation.
        if not devices:
            model["available_in_studio"] = False
            model["unavailable_reason"] = "known_broken"
            model["unavailable_details"] = (
                "No supported device left: "
                + "; ".join(f"{d}: {m['details']}" for d, m in sorted(marks.items()))
            )

    return removed


def apply_studio_availability(models: list) -> list:
    """Stamp availability marks on every model, and return the hidden ones.

    Authoritative and idempotent: any pre-existing mark is cleared first, so the
    tables above fully determine what is hidden. A model that is available
    carries no availability fields at all -- the catalog stays readable, and a
    consumer treats "no mark" as available.
    """
    hidden = []
    for model in models:
        for key in ("available_in_studio", "unavailable_reason", "unavailable_details"):
            model.pop(key, None)

        override = STUDIO_UNAVAILABLE_MODELS.get(model["model_name"])
        if override:
            reason, details = override
        elif model.get("model_type") in UNSUPPORTED_STUDIO_MODEL_TYPES:
            reason = "unsupported_in_studio"
            details = UNSUPPORTED_STUDIO_MODEL_TYPES[model["model_type"]]
        else:
            continue

        if reason not in STUDIO_UNAVAILABLE_REASONS:
            raise ValueError(
                f"{model['model_name']}: unknown reason {reason!r}; "
                f"expected one of {STUDIO_UNAVAILABLE_REASONS}"
            )
        model["available_in_studio"] = False
        model["unavailable_reason"] = reason
        model["unavailable_details"] = details
        hidden.append((model["model_name"], reason))

    return hidden


def _impl_selector(value):
    """Reduce tt-inference-server's impl object to the string its endpoints match on.

    The server selects with `spec.impl.impl_name == impl` and run.py builds its
    --impl choices from impl_name, so the hyphenated impl_name ("tt-transformers")
    is the wire value -- not the underscored impl_id ("tt_transformers"). The two
    differ for 9 of the 10 impls in the v0.19.0 artifact. impl_id is a fallback
    for objects that predate impl_name.

    Stdlib-only, kept local: this script runs standalone on the host interpreter,
    so it can't import the Django-bound copy in model_config. Keep the two in
    step -- shared_config/test_sync_models.py and test_model_config.py assert the
    same vectors against each."""
    if isinstance(value, str):
        return value or None
    if isinstance(value, dict):
        for key in ("impl_name", "impl_id"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


def load_existing_catalog(path: Path) -> dict:
    """Return {model_name: entry} for the catalog already on disk, or {} if none.

    Never fatal: a missing or malformed catalog just means there is nothing to
    preserve, which is the correct outcome for a first-time sync.
    """
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Warning: could not read existing catalog ({e}); nothing to preserve")
        return {}
    return {
        m["model_name"]: m
        for m in data.get("models", [])
        if isinstance(m, dict) and m.get("model_name")
    }


def merge_hand_owned(models: list, existing: dict) -> tuple[list, list, list]:
    """Fold hand-curated state from `existing` into freshly-synced `models`.

    Two distinct losses to prevent:
    - A hand-set field on a model that IS in the source JSON (e.g. a dev-catalog
      flag) has nothing in the source to regenerate it.
    - A model that exists ONLY in the dev-tier catalog can't appear in a prod
      release snapshot at all, so a rebuild deletes the whole entry.

    A third loss, and the reason for HAND_OWNED_MARKER: a hand-added entry whose
    model_name COLLIDES with a synced one. Name-keyed preservation silently hands
    the synced entry the hand-owned fields and throws the rest of the hand-added
    row away -- a different model_type, engine, service_route and env_vars. The
    marked entry wins outright instead, and the colliding synced entry is dropped
    so model_name stays unique.

    Returns (merged_models, preserved_field_names, retained_model_names).
    """
    preserved, retained = [], []
    hand_owned = {
        name for name, old in existing.items() if old.get(HAND_OWNED_MARKER)
    }

    # Drop synced entries whose name is claimed by a hand-owned entry; the
    # hand-owned row is re-appended intact by the retain loop below.
    displaced = [m["model_name"] for m in models if m["model_name"] in hand_owned]
    if displaced:
        models = [m for m in models if m["model_name"] not in hand_owned]
        print(
            f"Kept {len(displaced)} hand-owned entry(ies) over a same-named source "
            f"entry: {', '.join(sorted(displaced))}"
        )

    synced_names = {m["model_name"] for m in models}

    for model in models:
        old = existing.get(model["model_name"])
        if not old:
            continue
        for key in HAND_OWNED_KEYS:
            if key in old and key not in model:
                model[key] = old[key]
                preserved.append(f"{model['model_name']}.{key}")

    for name, old in existing.items():
        if name not in synced_names:
            models.append(old)
            retained.append(name)

    return models, preserved, retained


def resolve_source_json(override: str | None = None) -> Path:
    """Return the path to the model spec JSON, trying candidates in order."""
    if override:
        p = Path(override)
        if not p.exists():
            raise FileNotFoundError(f"--source path not found: {p}")
        return p.resolve()

    # Check env var set by run.py
    artifact_path = os.environ.get("TT_INFERENCE_ARTIFACT_PATH")
    if artifact_path:
        for name in _SOURCE_FILENAMES:
            p = Path(artifact_path) / name
            if p.exists():
                return p.resolve()

    # Try static candidates
    for candidate in _CANDIDATE_SOURCES:
        if candidate.exists():
            return candidate.resolve()

    raise FileNotFoundError(
        "Cannot find a model spec JSON. Tried:\n"
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
    if raw_model_type == "TRAINING":
        return "TRAINING"
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
        if raw_model_type == "TRAINING":
            return "/v1/jobs"
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
                for _impl_key, entry in by_impl.items():
                    if isinstance(entry, dict):
                        # Store the impl_name STRING so the catalog can disambiguate
                        # models whose name+device match multiple engine specs.
                        # No fallback to _impl_key: that nesting key is the
                        # underscored impl_id, which the server does not match on,
                        # and a wrong impl is a hard failure (argparse invalid
                        # choice / ValueError) whereas None just lets the server
                        # pick its default spec.
                        entry["impl"] = _impl_selector(entry.get("impl"))
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

        # Record an impl only when it actually disambiguates. The server does a
        # stricter (model, device, impl) lookup that misses specs outside the prod
        # tier, so an impl that buys no disambiguation turns a working resolve into
        # a 404 (e.g. speecht5_tts on Blackhole). A future dev-catalog spec that
        # collides on name+device won't appear in this prod artifact, so it can't be
        # seen here; such models arrive as hand-added retained entries whose impl is
        # preserved, or the impl can be set by hand.
        distinct_impls = {_impl_selector(e.get("impl")) for e in entries}
        distinct_impls.discard(None)
        disambiguating_impl = _impl_selector(first.get("impl")) if len(distinct_impls) > 1 else None

        models.append({
            "model_name": model_name,
            "model_type": map_model_type(raw_model_type, inference_engine),
            "display_model_type": raw_model_type,
            "device_configurations": device_configurations,
            "hf_model_id": first.get("hf_model_repo"),
            "inference_engine": inference_engine,
            "impl": disambiguating_impl,
            "status": status,
            "version": canonical.get("version", "0.0.0"),
            "docker_image": canonical.get("docker_image"),
            "service_route": service_route,
            "health_route": map_health_route(inference_engine, service_route),
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

    # Fold in hand-curated state before writing. normalize() rebuilds every entry
    # purely from the source JSON, so without this the write below silently
    # discards anything the source can't express (issue #977).
    existing = load_existing_catalog(OUTPUT_JSON.resolve())
    models, preserved, retained = merge_hand_owned(models, existing)

    # Hand-retained entries bypass normalize() entirely and may carry a stale
    # impl object from an older catalog; reduce every impl to its impl_id string.
    for _m in models:
        if "impl" in _m:
            _m["impl"] = _impl_selector(_m.get("impl"))

    # Mark (don't delete) the models TT-Studio won't offer. Keeping the rows means
    # the next resync doesn't silently reintroduce them and the reason travels
    # with the catalog.
    # Order matters: the model-wide pass clears availability fields before
    # re-stamping them, and the per-device pass may set those same fields when it
    # strips a model's last device. Device pass second, so that survives.
    apply_studio_availability(models)
    dropped = apply_device_availability(models)
    if dropped:
        print(f"Blocked {len(dropped)} model/device pair(s):")
        for name, device, reason in sorted(dropped):
            print(f"  {name} on {device}: {reason}")

    # Report the FINAL state, not `hidden` from the model-wide pass: the device
    # pass runs after it and can hide a model outright by taking its last device.
    final_hidden: dict[str, list[str]] = {}
    for m in models:
        if m.get("available_in_studio") is False:
            final_hidden.setdefault(m["unavailable_reason"], []).append(m["model_name"])
    if final_hidden:
        print(f"Hidden from TT-Studio: {sum(len(v) for v in final_hidden.values())} model(s)")
        for reason, names in sorted(final_hidden.items()):
            print(f"  {reason}: {', '.join(sorted(names))}")

    if preserved:
        print(f"Preserved {len(preserved)} hand-set field(s): {', '.join(preserved)}")
    if retained:
        print(f"Retained {len(retained)} model(s) absent from source: {', '.join(retained)}")

    # Re-sort after merging so retained entries land in their proper position
    # rather than appended at the end (same key as normalize()).
    models.sort(key=lambda m: (-STATUS_ORDER.get(m["status"], 0), m["model_name"].lower()))

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
    print(f"  Shown in TT-Studio:        {sum(1 for m in models if m.get('available_in_studio', True) is not False)} of {len(models)}")
    print(f"  Status distribution:       {dict(status_counts)}")
    print(f"  Type distribution:         {dict(type_counts)}")
    print(f"  Display type distribution: {dict(display_type_counts)}")


if __name__ == "__main__":
    main()
