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
}

# Model types coding agents can talk to.
CODING_AGENT_MODEL_TYPES = (ModelTypes.CHAT, ModelTypes.VLM)

# Models with a toggleable "thinking" mode, mapped to their vLLM --reasoning-parser.
# The parser splits reasoning into reasoning_content instead of inline <think> text.
REASONING_MODELS = {
    "Qwen3-32B": "qwen3",
}

# Suffix that selects thinking mode for a reasoning model over the gateway,
# e.g. "Qwen3-32B-thinking" is the thinking variant of "Qwen3-32B".
THINKING_SUFFIX = "-thinking"


def is_coding_agent_eligible(model_impl) -> bool:
    """True if a deployed model is usable via the coding-agent gateway.

    Operates on a ModelImpl object (reads .model_type / .model_name).
    """
    if model_impl is None:
        return False
    return (
        getattr(model_impl, "model_type", None) in CODING_AGENT_MODEL_TYPES
        and getattr(model_impl, "model_name", None) in CODING_AGENT_ELIGIBLE_MODELS
    )


def get_reasoning_parser(model_name) -> str | None:
    """vLLM --reasoning-parser for a model, or None if it has no thinking mode."""
    return REASONING_MODELS.get(model_name)


def get_gateway_model_names(model_name) -> list[str]:
    """
        Return the names a model is exposed under to coding agents: the plain name, plus a
        "-thinking" variant for reasoning models.
    """
    if model_name in REASONING_MODELS:
        return [model_name, model_name + THINKING_SUFFIX]
    return [model_name]


def resolve_thinking_variant(requested_model):
    """Map a requested gateway model name to (base_name, enable_thinking)."""
    if requested_model and requested_model.endswith(THINKING_SUFFIX):
        base = requested_model[: -len(THINKING_SUFFIX)]
        if base in REASONING_MODELS:
            return base, True
    if requested_model in REASONING_MODELS:
        return requested_model, False
    return requested_model, None
