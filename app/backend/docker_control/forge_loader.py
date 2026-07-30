# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"""Forge Loader: take a Hugging Face model card and serve the model via Forge.

Forge (tt-xla -> tt-mlir) compiles a model's PyTorch math, so it can stand up models
that were never ported to tt-metal by hand and have no entry in any catalog. Two things
it cannot do, which preflight_model() screens for before we spend ~10 minutes compiling:

  * Hybrid / linear-attention models (Gated DeltaNet, Mamba, and friends). Their layers
    are hand-written Triton/CUDA kernels, not PyTorch math, so there is nothing for MLIR
    to lower. The TT runner also rejects their two-KV-cache shape outright.
  * Models too large for the available chips.
"""
import json
import re
import urllib.error
import urllib.request

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

HF_HOST = "huggingface.co"

# Architectures whose attention layers are GPU kernels rather than traceable PyTorch.
# Derived from the vLLM modules that import layers.mamba / layers.fla / causal_conv1d.
_HYBRID_MODEL_TYPES = frozenset({
    "qwen3_5", "qwen3_next", "jamba", "bamba", "falcon_h1", "granitemoehybrid",
    "nemotron_h", "zamba2", "plamo2", "lfm2", "lfm2_moe", "minimax_m2",
    "minimax_text_01", "kimi_linear", "olmo_hybrid", "bailing_moe_linear", "mamba",
    "mamba2",
})
# Config keys that betray a recurrent/convolutional state even on an unfamiliar model_type.
_HYBRID_CONFIG_KEYS = ("mamba_n_heads", "mamba_d_state", "mamba_expand", "conv_kernel",
                       "linear_attn_config", "linear_conv_kernel_dim")

# Weights are loaded at bfp_bf8, so roughly one byte per parameter. A single Blackhole
# chip must also hold the KV cache and activations, hence the headroom.
_BYTES_PER_PARAM = 1
_USABLE_GB_PER_CHIP = 20


class PreflightError(Exception):
    """Model cannot be served by Forge. The message is shown to the user verbatim."""


def parse_model_card_url(raw: str) -> str:
    """Turn a Hugging Face model card URL (or a bare repo id) into 'org/model'."""
    value = (raw or "").strip()
    if not value:
        raise PreflightError("Enter a Hugging Face model card URL.")

    # Accept a bare repo id as typed.
    if "/" in value and "://" not in value and HF_HOST not in value:
        repo_id = value.strip("/")
    else:
        cleaned = re.sub(r"^https?://", "", value).strip("/")
        if not cleaned.startswith(HF_HOST):
            raise PreflightError(
                f"That is not a Hugging Face link. Expected {HF_HOST}/<org>/<model>."
            )
        parts = cleaned[len(HF_HOST):].strip("/").split("/")
        # Drop viewer suffixes such as /tree/main or /blob/main/config.json.
        for marker in ("tree", "blob", "resolve"):
            if marker in parts:
                parts = parts[: parts.index(marker)]
        if len(parts) < 2:
            raise PreflightError(
                "That link points at an organisation, not a model. "
                f"Expected {HF_HOST}/<org>/<model>."
            )
        repo_id = "/".join(parts[:2])

    if not re.fullmatch(r"[\w.\-]+/[\w.\-]+", repo_id):
        raise PreflightError(f"Could not read a model id from '{raw}'.")
    return repo_id


def _fetch_json(url: str, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "tt-studio-forge-loader"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _param_count(repo_id: str) -> int | None:
    """Parameter count from the HF API, when it publishes safetensors metadata."""
    try:
        meta = _fetch_json(f"https://{HF_HOST}/api/models/{repo_id}")
    except Exception as e:  # noqa: BLE001 - popularity metadata is best-effort
        logger.info(f"forge-loader: no safetensors metadata for {repo_id}: {e}")
        return None
    return (meta.get("safetensors") or {}).get("total")


def preflight_model(repo_id: str, available_chips: int = 1) -> dict:
    """Check a model can plausibly be compiled and fit, before we launch anything.

    Returns a summary dict on success; raises PreflightError with a user-facing
    explanation otherwise.
    """
    try:
        config = _fetch_json(f"https://{HF_HOST}/{repo_id}/raw/main/config.json")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise PreflightError(
                f"'{repo_id}' is private or gated. Accept its licence on Hugging Face "
                "and make sure HF_TOKEN is set."
            ) from e
        if e.code == 404:
            raise PreflightError(f"No model found at {HF_HOST}/{repo_id}.") from e
        raise PreflightError(f"Could not read that model's config ({e.code}).") from e
    except Exception as e:  # noqa: BLE001
        raise PreflightError(f"Could not reach Hugging Face: {e}") from e

    text_config = config.get("text_config") or config
    model_type = (config.get("model_type") or "").lower()
    architecture = (config.get("architectures") or ["unknown"])[0]

    # --- Gate 1: hybrid / linear-attention models cannot be compiled ---
    hybrid_key = next((k for k in _HYBRID_CONFIG_KEYS if k in text_config), None)
    if model_type in _HYBRID_MODEL_TYPES or hybrid_key:
        raise PreflightError(
            f"{repo_id} ({architecture}) uses hybrid or linear attention, which Forge "
            "cannot compile yet: those layers are hand-written GPU kernels rather than "
            "PyTorch operations, so there is nothing for our compiler to lower. Pick a "
            "standard transformer model instead."
        )

    # --- Gate 2: it has to fit ---
    params = _param_count(repo_id)
    budget_gb = _USABLE_GB_PER_CHIP * max(available_chips, 1)
    est_gb = round(params * _BYTES_PER_PARAM / 1e9, 1) if params else None
    if est_gb and est_gb > budget_gb:
        raise PreflightError(
            f"{repo_id} needs roughly {est_gb} GB at 8-bit, but only about {budget_gb} GB "
            f"is usable across {available_chips} chip(s). Try a smaller model."
        )

    # Chat needs a template. Newer models ship it as a standalone chat_template.jinja,
    # so absence from tokenizer_config.json alone does not mean it is a base model.
    return {
        "repo_id": repo_id,
        "architecture": architecture,
        "model_type": model_type,
        "param_count": params,
        "estimated_gb": est_gb,
        "max_position_embeddings": text_config.get("max_position_embeddings"),
        "has_chat_template": _has_chat_template(repo_id),
    }


def _has_chat_template(repo_id: str) -> bool:
    """True when the model can serve /v1/chat/completions without a supplied template."""
    try:
        tok = _fetch_json(f"https://{HF_HOST}/{repo_id}/raw/main/tokenizer_config.json")
        if tok.get("chat_template"):
            return True
    except Exception:  # noqa: BLE001
        pass
    # Modern transformers keeps the template in its own file.
    try:
        req = urllib.request.Request(
            f"https://{HF_HOST}/{repo_id}/raw/main/chat_template.jinja",
            method="HEAD",
            headers={"User-Agent": "tt-studio-forge-loader"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception:  # noqa: BLE001
        return False
