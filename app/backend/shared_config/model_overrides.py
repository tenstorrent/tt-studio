# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Load and validate model_overrides.toml (co-located with this file).

Stdlib-only, deliberately: sync_models_from_inference_server.py runs standalone
on the host interpreter (outside Django), and docker_control.docker_utils runs
inside it -- this module is the one place both can import overrides data from
without either pulling in the other's dependencies.

Exposes the exact shapes each caller already consumed as Python literals
before this file existed, so callers (and their tests, which monkeypatch these
dicts directly) need no changes beyond where the data now comes from:

    STUDIO_UNAVAILABLE_REASONS  tuple[str, ...]
    STUDIO_UNAVAILABLE_MODELS   {model_name: (reason, details)}
    STUDIO_UNAVAILABLE_DEVICES  {model_name: {device: (reason, details)}}
    VLLM_MESH_SPEC_FALLBACK     {device: (alt_device, ...)}
    MEDIA_IMAGE_OVERRIDES       {(model_name, device_or_"*"): docker_image}
    TRACE_REGION_OVERRIDES      {(model_name, device): trace_region_size}
    CHIP_TIER_MODELS            {model_name: base_device}
    CHIP_TIERS                  {model_name: {device: device_ids}}
"""

from __future__ import annotations

import sys
import tomllib
from difflib import get_close_matches
from pathlib import Path

OVERRIDES_PATH = Path(__file__).parent / "model_overrides.toml"
OVERRIDES_SCHEMA_VERSION = 1
VALID_REASONS = ("known_broken", "unsupported_in_studio")


class OverridesError(Exception):
    """A model_overrides.toml entry the loader refuses to guess its way past."""


def _require(entry: dict, fields: tuple[str, ...], where: str) -> None:
    missing = [f for f in fields if not entry.get(f)]
    if missing:
        raise OverridesError(f"{where}: entry {entry!r} is missing {', '.join(missing)}.")


def _check_lowercase(value: str, field: str, where: str) -> None:
    if value != value.lower():
        raise OverridesError(
            f"{where}: {field} {value!r} must be lowercase (the runtime "
            f"inference-server device name) -- use {value.lower()!r}."
        )


def _parse_unavailable(entries: list[dict], where: str) -> tuple[dict, dict]:
    models: dict[str, tuple[str, str]] = {}
    devices: dict[str, dict[str, tuple[str, str]]] = {}
    seen: set[tuple[str, str | None]] = set()
    for entry in entries:
        _require(entry, ("model", "reason", "details"), where)
        if entry["reason"] not in VALID_REASONS:
            raise OverridesError(
                f"{where}: {entry['model']} has unknown reason {entry['reason']!r}; "
                f"expected one of {VALID_REASONS}."
            )
        key = (entry["model"], entry.get("device"))
        if key in seen:
            raise OverridesError(
                f"{where}: duplicate [[unavailable]] entry for "
                f"{key[0]} / {key[1] or '(model-wide)'}."
            )
        seen.add(key)

        mark = (entry["reason"], " ".join(entry["details"].split()))
        device = entry.get("device")
        if device is None:
            models[entry["model"]] = mark
        else:
            devices.setdefault(entry["model"], {})[device] = mark
    return models, devices


def _parse_device_fallback(entries: list[dict], where: str) -> dict[str, tuple[str, ...]]:
    fallback: dict[str, list[str]] = {}
    for entry in entries:
        _require(entry, ("device", "serve_as"), where)
        _check_lowercase(entry["device"], "device", where)
        _check_lowercase(entry["serve_as"], "serve_as", where)
        if entry["device"] == entry["serve_as"]:
            raise OverridesError(f"{where}: device_fallback for {entry['device']!r} points at itself.")
        fallback.setdefault(entry["device"], []).append(entry["serve_as"])
    return {device: tuple(alts) for device, alts in fallback.items()}


def _parse_serve_override(
    entries: list[dict], where: str
) -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], int]]:
    images: dict[tuple[str, str], str] = {}
    trace_regions: dict[tuple[str, str], int] = {}
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        _require(entry, ("model",), where)
        if not (entry.get("docker_image") or entry.get("trace_region_size")):
            raise OverridesError(
                f"{where}: serve_override for {entry['model']} sets nothing; "
                "give it a docker_image or a trace_region_size."
            )
        device = entry.get("device", "*")
        if device != "*":
            _check_lowercase(device, "device", where)
        key = (entry["model"], device)
        if key in seen:
            raise OverridesError(
                f"{where}: duplicate serve_override for {key[0]} / {key[1]}."
            )
        seen.add(key)
        if entry.get("docker_image"):
            images[key] = entry["docker_image"]
        if entry.get("trace_region_size"):
            trace_regions[key] = int(entry["trace_region_size"])
    return images, trace_regions


def _parse_chip_tier(
    entries: list[dict], where: str
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    base_devices: dict[str, str] = {}
    tiers: dict[str, dict[str, str]] = {}
    for entry in entries:
        _require(entry, ("model", "base_device", "tiers"), where)
        if entry["model"] in base_devices:
            raise OverridesError(f"{where}: duplicate chip_tier entry for {entry['model']}.")
        base_devices[entry["model"]] = entry["base_device"]
        tiers[entry["model"]] = dict(entry["tiers"])
    return base_devices, tiers


def known_devices_hint(device: str, known: list[str]) -> str:
    """A " Did you mean 'X'?" hint for an unavailable/serve_override device typo, or ""."""
    near = get_close_matches(device, known, n=1)
    return f" Did you mean {near[0]!r}?" if near else ""


class ModelOverrides:
    """Parsed, validated contents of model_overrides.toml."""

    def __init__(self, path: Path = OVERRIDES_PATH) -> None:
        where = str(path)
        try:
            doc = tomllib.loads(path.read_text())
        except FileNotFoundError:
            raise OverridesError(f"{where}: not found.") from None
        except tomllib.TOMLDecodeError as exc:
            raise OverridesError(f"{where}: invalid TOML ({exc}).") from exc

        if doc.get("schema_version") != OVERRIDES_SCHEMA_VERSION:
            raise OverridesError(
                f"{where}: schema_version {doc.get('schema_version')!r}, "
                f"expected {OVERRIDES_SCHEMA_VERSION}."
            )

        self.unavailable_models, self.unavailable_devices = _parse_unavailable(
            doc.get("unavailable") or [], where
        )
        self.vllm_mesh_spec_fallback = _parse_device_fallback(
            doc.get("device_fallback") or [], where
        )
        self.media_image_overrides, self.trace_region_overrides = _parse_serve_override(
            doc.get("serve_override") or [], where
        )
        self.chip_tier_models, self.chip_tiers = _parse_chip_tier(
            doc.get("chip_tier") or [], where
        )


def _load() -> ModelOverrides:
    try:
        return ModelOverrides()
    except OverridesError as e:
        print(f"model_overrides.toml: {e}", file=sys.stderr)
        raise


_overrides = _load()

STUDIO_UNAVAILABLE_REASONS: tuple[str, ...] = VALID_REASONS
STUDIO_UNAVAILABLE_MODELS: dict[str, tuple[str, str]] = _overrides.unavailable_models
STUDIO_UNAVAILABLE_DEVICES: dict[str, dict[str, tuple[str, str]]] = _overrides.unavailable_devices
VLLM_MESH_SPEC_FALLBACK: dict[str, tuple[str, ...]] = _overrides.vllm_mesh_spec_fallback
MEDIA_IMAGE_OVERRIDES: dict[tuple[str, str], str] = _overrides.media_image_overrides
TRACE_REGION_OVERRIDES: dict[tuple[str, str], int] = _overrides.trace_region_overrides
CHIP_TIER_MODELS: dict[str, str] = _overrides.chip_tier_models
CHIP_TIERS: dict[str, dict[str, str]] = _overrides.chip_tiers
