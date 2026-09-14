# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Model implementations for community bundles served by tt-model-manager.

Community bundles are published to the Hugging Face Hub by users, so they cannot live
in the tt-inference-server catalog: that file is regenerated from the release artifact
on every ``--resync`` and hand-added rows there are a maintenance burden by design
(see sync_models_from_inference_server.HAND_OWNED_KEYS). Instead a bundle's manifest,
read through tt-model-manager, is turned into a stand-in impl here.

This follows external_model_config.ExternalModelImpl: the rest of the backend reads
only a handful of attributes off ``model_impl``, so a lightweight frozen dataclass is
enough and avoids pretending a bundle has the deploy-time fields (image_version,
volume_path, env_file) that a catalog ModelImpl carries.

Only the vLLM engines are modelled. tt-model-manager may support more kinds than
TT Studio has a UI for, so an unsupported kind is filtered out upstream rather than
mapped onto a route that would 404.
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, FrozenSet, Optional, Tuple

from shared_config.device_config import DeviceConfigurations
from shared_config.model_type_config import ModelTypes

MODEL_ID_PREFIX = "id_community-"

# Both vLLM launchers in tt-model-manager run `vllm serve`, so a bundle is an
# OpenAI-compatible chat server on its published port — the same contract as a
# catalog CHAT model.
SUPPORTED_KINDS = frozenset({"vllm-plugin", "vllm-fork"})

SERVICE_ROUTE = "/v1/chat/completions"
HEALTH_ROUTE = "/health"

# A profile's `hardware` label is tt-model-manager's device target. Mapping it onto
# DeviceConfigurations lets a community model flow through the same board-compatibility
# check as a catalog model instead of needing a parallel one.
_HARDWARE_TO_DEVICE = {
    "p100": DeviceConfigurations.P100,
    "p150": DeviceConfigurations.P150,
    "p150x4": DeviceConfigurations.P150X4,
    "p150x8": DeviceConfigurations.P150X8,
    "p300": DeviceConfigurations.P300,
    "p300x2": DeviceConfigurations.P300x2,
    "n150": DeviceConfigurations.N150,
    "n300": DeviceConfigurations.N300,
    "t3k": DeviceConfigurations.T3K,
}


# tt-model-manager filters the Hub catalog by architecture, while TT Studio detects a
# board. Blackhole boards are P-series, Wormhole boards N-series (T3K/Galaxy included).
_BOARD_PREFIX_TO_ARCH = (("p", "blackhole"), ("n", "wormhole"), ("e", "grayskull"))


def arch_for_board(board_type: Optional[str]) -> Optional[str]:
    """The tt-model-manager arch for a detected board, or None when unknown."""
    board = (board_type or "").lower()
    if not board or board == "unknown":
        return None
    if board.startswith(("t3k", "t3000", "galaxy")):
        return "wormhole"
    for prefix, arch in _BOARD_PREFIX_TO_ARCH:
        if board.startswith(prefix):
            return arch
    return None


def community_model_id(repo_id: str, profile: Optional[str] = None) -> str:
    """The model_id TT Studio uses for one (bundle, profile) pair.

    Namespaced so a Hub repo can never collide with a catalog entry: several lookups
    resolve a model by name, and a bundle called "Llama-3.1-8B-Instruct" must not
    shadow the catalog's.
    """
    return f"{MODEL_ID_PREFIX}{repo_id}@{profile}" if profile else f"{MODEL_ID_PREFIX}{repo_id}"


def is_community_model_id(model_id: Optional[str]) -> bool:
    return bool(model_id) and str(model_id).startswith(MODEL_ID_PREFIX)


def parse_community_model_id(model_id: str) -> Tuple[str, Optional[str]]:
    """Split a community model_id back into ``(repo_id, profile)``."""
    if not is_community_model_id(model_id):
        raise ValueError(f"not a community model_id: {model_id!r}")
    remainder = str(model_id)[len(MODEL_ID_PREFIX):]
    repo_id, _, profile = remainder.partition("@")
    return repo_id, profile or None


def devices_for_hardware(hardware: Optional[str]) -> FrozenSet[DeviceConfigurations]:
    """Device configurations a profile's hardware label corresponds to.

    An unknown label yields an empty set, which reads as "compatibility unknown"
    rather than "incompatible" — a new device target should not silently hide a model.
    """
    device = _HARDWARE_TO_DEVICE.get((hardware or "").lower())
    return frozenset({device}) if device else frozenset()


@dataclass(frozen=True)
class CommunityModelImpl:
    """Stand-in model_impl for a tt-model-manager bundle."""

    model_name: str
    model_id: str
    repo_id: str
    profile: str
    model_type: ModelTypes = ModelTypes.CHAT
    service_route: str = SERVICE_ROUTE
    health_route: str = HEALTH_ROUTE
    service_port: int = 7000
    hf_model_id: Optional[str] = None
    inference_engine: str = "vllm"
    display_model_type: str = "LLM"
    param_count: Optional[int] = None
    # Declared by the bundle author in the manifest, so unlike the catalog path this
    # needs no per-family parser heuristic.
    tool_calling_enabled: bool = False
    reasoning_parser: Optional[str] = None
    # Chips the profile's mesh opens. Authoritative for chip-slot reservation:
    # tt-model-manager grants the container every device and selects the mesh itself.
    chips_required: int = 1
    device_configurations: FrozenSet[DeviceConfigurations] = frozenset()
    arch: Optional[str] = None
    kind: str = "vllm-plugin"
    image: Optional[str] = None
    author: Optional[str] = None
    downloads: Optional[int] = None
    installed: bool = False
    max_model_len: Optional[int] = None
    # True for every instance — lets callers tell a community impl from a catalog one.
    is_community: bool = True
    profiles: Tuple[str, ...] = field(default_factory=tuple)

    def asdict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["model_type"] = self.model_type.value
        data["device_configurations"] = sorted(d.name for d in self.device_configurations)
        return data


def build_community_model_impl(
    bundle: Dict[str, Any],
    profile_name: Optional[str] = None,
    service_port: int = 7000,
) -> CommunityModelImpl:
    """Build an impl from a ``/community/models/{repo_id}`` document.

    ``bundle`` is the runner's ``inspect`` output: repo_id, kind, arch, image,
    weights_repo, default_profile and one entry per serve profile.
    """
    repo_id = bundle["repo_id"]
    profiles = bundle.get("profiles") or []
    wanted = profile_name or bundle.get("default_profile")
    profile = next(
        (p for p in profiles if p.get("name") == wanted),
        profiles[0] if profiles else {},
    )
    resolved_profile = profile.get("name") or wanted or "default"
    return CommunityModelImpl(
        # The Hub id is the model's identity everywhere in the UI: it carries the
        # author, which is the whole point of showing a community model as community.
        model_name=repo_id,
        model_id=community_model_id(repo_id, resolved_profile),
        repo_id=repo_id,
        profile=resolved_profile,
        service_port=service_port,
        hf_model_id=bundle.get("weights_repo"),
        tool_calling_enabled=bool(profile.get("tool_parser")),
        reasoning_parser=profile.get("reasoning_parser"),
        chips_required=int(profile.get("chips_required") or 1),
        device_configurations=devices_for_hardware(profile.get("hardware")),
        arch=bundle.get("arch"),
        kind=bundle.get("kind") or "vllm-plugin",
        image=bundle.get("image"),
        author=repo_id.split("/")[0] if "/" in repo_id else None,
        downloads=bundle.get("downloads"),
        installed=bool(bundle.get("installed")),
        max_model_len=profile.get("max_model_len"),
        profiles=tuple(p.get("name") for p in profiles if p.get("name")),
    )


def community_impl_from_deployment(deployment) -> Optional[CommunityModelImpl]:
    """Rebuild an impl from a community deployment record, with no Hub request.

    Used when reconciling live containers: the record already holds everything the
    deploy cache and the inference views read, and the canonical listing runs often
    enough that re-reading a manifest per container would be a network call per poll.
    """
    model_id = getattr(deployment, "community_model_id", None)
    if not model_id:
        return None
    try:
        repo_id, profile = parse_community_model_id(model_id)
    except ValueError:
        return None
    return CommunityModelImpl(
        model_name=getattr(deployment, "model_name", None) or repo_id,
        model_id=model_id,
        repo_id=repo_id,
        profile=profile or "default",
        service_route=getattr(deployment, "service_route", None) or SERVICE_ROUTE,
        service_port=getattr(deployment, "port", None) or 7000,
        hf_model_id=getattr(deployment, "hf_model_id", None),
        tool_calling_enabled=bool(getattr(deployment, "tool_calling_enabled", False)),
        chips_required=len(getattr(deployment, "device_ids", None) or [0]),
        arch=getattr(deployment, "device", None) or None,
        author=repo_id.split("/")[0] if "/" in repo_id else None,
        installed=True,
    )
