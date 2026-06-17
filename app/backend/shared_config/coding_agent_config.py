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
