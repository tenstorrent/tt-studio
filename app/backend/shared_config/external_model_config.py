# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Synthetic model implementations for externally-registered containers.

A container registered through the Register Model flow may serve a model that is
not in the tt-inference-server catalog, so no ``ModelImpl`` exists for it. The
rest of the backend (deploy cache, health probe, inference views) only reads a
handful of attributes off ``model_impl``, so we hand it a lightweight stand-in
built from what the container itself told us.

This is deliberately NOT a ``ModelImpl``: that class carries deploy-time concerns
(docker config, volumes, image tags) which have no meaning for a container we did
not start.
"""

from dataclasses import asdict, dataclass
from typing import Optional

from shared_config.model_type_config import ModelTypes

# Per-type service route and inference engine, mirroring how the catalog
# describes the same model types (see models_from_inference_server.json).
_TYPE_ROUTING = {
    ModelTypes.CHAT: ("/v1/chat/completions", "vllm"),
    ModelTypes.MOCK: ("/v1/chat/completions", "vllm"),
    ModelTypes.VLM: ("/v1/chat/completions", "vllm"),
    ModelTypes.CNN: ("/v1/chat/completions", "forge"),
    # Embedding models on the media server take /enqueue, not a chat route.
    # TT Studio has no embedding UI, so this is for identification/parity only.
    ModelTypes.EMBEDDING: ("/enqueue", "media"),
    ModelTypes.TTS: ("/v1/audio/speech", "media"),
    ModelTypes.SPEECH_RECOGNITION: ("/v1/audio/transcriptions", "media"),
    ModelTypes.IMAGE_GENERATION: ("/v1/images/generations", "media"),
    ModelTypes.VIDEO: ("/v1/videos/generations", "media"),
    ModelTypes.OBJECT_DETECTION: ("/objdetection_v2", "vllm"),
}

# Model types we can actually drive from the UI. Anything else registers as
# UNKNOWN: visible and manageable, but with no interaction surface.
SUPPORTED_EXTERNAL_MODEL_TYPES = frozenset(_TYPE_ROUTING)


def normalize_external_model_type(value) -> ModelTypes:
    """Coerce a model_type string into a ModelTypes we can route, or UNKNOWN."""
    try:
        model_type = ModelTypes(str(value or "").lower())
    except ValueError:
        return ModelTypes.UNKNOWN
    return model_type if model_type in SUPPORTED_EXTERNAL_MODEL_TYPES else ModelTypes.UNKNOWN


@dataclass(frozen=True)
class ExternalModelImpl:
    """Minimal model_impl for a container TT Studio registered but did not deploy."""

    model_name: str
    model_id: str
    model_type: ModelTypes
    service_route: str
    hf_model_id: Optional[str] = None
    health_route: str = "/health"
    service_port: int = 7000
    inference_engine: str = "vllm"
    display_model_type: str = "EXTERNAL"
    param_count: Optional[int] = None
    # Whether the container was launched with vLLM tool-calling support, detected
    # at registration. Coding agents and marketplace apps require it.
    tool_calling_enabled: bool = False
    # True for every instance — lets callers tell a synthetic impl from a catalog one.
    is_external: bool = True

    def asdict(self):
        return asdict(self)


def build_external_model_impl(
    model_name: str,
    model_type,
    hf_model_id: Optional[str] = None,
    service_port: int = 7000,
    tool_calling_enabled: bool = False,
) -> ExternalModelImpl:
    """Build the stand-in impl for an externally-registered container.

    An UNKNOWN type still gets an impl (so the container is tracked) but keeps a
    bare service route: nothing in the UI offers inference against it, and health
    is reported as unknown rather than probing a guessed endpoint.
    """
    resolved_type = normalize_external_model_type(
        getattr(model_type, "value", model_type)
    )
    service_route, engine = _TYPE_ROUTING.get(resolved_type, ("/", "vllm"))
    return ExternalModelImpl(
        model_name=model_name,
        model_id=f"id_external-{model_name}",
        model_type=resolved_type,
        service_route=service_route,
        hf_model_id=hf_model_id or model_name,
        service_port=service_port,
        inference_engine=engine,
        tool_calling_enabled=tool_calling_enabled,
    )
