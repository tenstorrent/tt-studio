# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Single source of truth for coding-agent (Claude Code / Cursor) gateway eligibility.

Both the LiteLLM gateway endpoints (model_control) and the canonical deployments serializer (docker_control) import from here.
"""

from shared_config.model_type_config import ModelTypes

# Models eligible for coding-agent native tool calling.
CODING_AGENT_ELIGIBLE_MODELS = {
    "Qwen3-32B",
    "Llama-3.1-8B",
    "Llama-3.1-8B-Instruct",
    "Llama-3.3-70B-Instruct",
    "Qwen3.5-9B",
    "Qwen3.6-27B",
    "Qwen3.8-27B",
    "gemma-4-31B-it",
    "diffusiongemma-26B-A4B-it",
}

# Model types coding agents can talk to.
CODING_AGENT_MODEL_TYPES = (ModelTypes.CHAT, ModelTypes.VLM)

# Suffix that selects thinking mode for a reasoning model over the gateway,
# e.g. "Qwen3-32B-thinking" is the thinking variant of "Qwen3-32B".
THINKING_SUFFIX = "-thinking"


def is_coding_agent_eligible(model_impl) -> bool:
    """True if a deployed model is usable via the coding-agent gateway.

    Operates on a ModelImpl object (reads .model_type / .model_name).

    Catalog models are allowlisted by name: we know which of them we have
    verified against coding agents. An externally-registered model has no
    catalog entry to allowlist, so it qualifies on structure instead — a chat or
    VLM container the user explicitly registered. A community bundle qualifies the
    same way, its parser being declared in the manifest rather than guessed.
    Whether it can actually be driven is a separate question answered by
    `tool_calling_enabled`, which every caller here already filters on (see
    _running_coding_agent_deploys); that keeps a tool-calling-less container out of
    the usable list while still letting the UI explain how to relaunch it.
    """
    if model_impl is None:
        return False
    if getattr(model_impl, "model_type", None) not in CODING_AGENT_MODEL_TYPES:
        return False
    # An externally-registered or community model has no catalog entry to allowlist,
    # so it qualifies on structure. A community bundle's tool-calling support is
    # declared in its manifest, which is stronger evidence than the name allowlist.
    if getattr(model_impl, "is_external", False) or getattr(model_impl, "is_community", False):
        return True
    return getattr(model_impl, "model_name", None) in CODING_AGENT_ELIGIBLE_MODELS


def get_reasoning_parser(model_name) -> str | None:
    """vLLM --reasoning-parser the catalog records for a model, or None."""
    from shared_config.model_config import model_implmentations

    for impl in model_implmentations.values():
        if impl.model_name == model_name and impl.reasoning_parser:
            return impl.reasoning_parser
    return None


def has_thinking_toggle(model_name) -> bool:
    """True for coding-agent models whose thinking mode can be toggled per request."""
    return model_name in CODING_AGENT_ELIGIBLE_MODELS and get_reasoning_parser(model_name) is not None


def get_gateway_model_names(model_name) -> list[str]:
    """
        Return the names a model is exposed under to coding agents: the plain name, plus a
        "-thinking" variant for reasoning models.
    """
    if has_thinking_toggle(model_name):
        return [model_name, model_name + THINKING_SUFFIX]
    return [model_name]


def resolve_thinking_variant(requested_model):
    """Map a requested gateway model name to (base_name, enable_thinking)."""
    if requested_model and requested_model.endswith(THINKING_SUFFIX):
        base = requested_model[: -len(THINKING_SUFFIX)]
        if has_thinking_toggle(base):
            return base, True
    if has_thinking_toggle(requested_model):
        return requested_model, False
    return requested_model, None
