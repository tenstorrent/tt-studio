# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Which tt-inference-server build and docker image a deploy should use.

Lives in its own module because both deploy paths need it: views.py for the CHAT
path (start_chat_deployment) and docker_utils.run_container for the media/forge
path. Keeping it in views.py forced docker_utils -- a low-level utility -- to
import the web layer, which is backwards and only avoided a circular import by
being a function-local import.

Deliberately depends on neither views nor docker_utils, so it can be imported at
module scope from both.
"""


from shared_config.logger_config import get_logger

logger = get_logger(__name__)


# Pin these Llama variants to the v0.14.0 release image for P300x2 compatibility (PR #815).
# Sent as override_docker_image so the inference server uses the published -release- tag
# even when dev_mode is on (e.g. tool calling), avoiding the -dev- variant which is not
# published for this build.
_LLAMA_V014_IMAGE = (
    "ghcr.io/tenstorrent/tt-inference-server/"
    "vllm-tt-metal-src-release-ubuntu-22.04-amd64:0.14.0-80180b9-7678b70"
)
_LLAMA_V014_MODELS = {
    "Llama-3.1-8B",
    "Llama-3.1-8B-Instruct",
    "Llama-3.1-70B",
    "Llama-3.1-70B-Instruct",
    "Llama-3.3-70B-Instruct",
}


def resolve_override_docker_image(impl) -> str | None:
    """Pin an explicit docker image where the inference server can't infer one.

    Two independent reasons a model needs this:
    - _LLAMA_V014_MODELS: the inference server's own model_spec default is an
      older image that's rejected on P300x2 (PR #815) -- unrelated to catalog tier.
    - requires_dev_catalog: "dev" tier catalog entries don't pin a docker_image
      (unlike "prod"), so run.py refuses to guess one and requires
      --override-docker-image whenever --dev-mode is combined with
      --docker-server. The catalog's own image_version is exactly what's needed.
    """
    if impl.model_name in _LLAMA_V014_MODELS:
        return _LLAMA_V014_IMAGE
    if impl.requires_dev_catalog:
        return impl.image_version
    return None


def resolve_artifact_ref(impl, device, board_type) -> str | None:
    """Pick this entry's tt-inference-server build for the board being deployed to.

    The catalog field is keyed by device because one entry usually covers several
    boards (47 of 56 entries do) and only some may need a non-default build.

    Returns None -- meaning "use the globally pinned artifact" -- for every case
    except an explicit, matched, eligible pin. Callers need no other fallback.
    """
    ref_map = getattr(impl, "inference_artifact_ref", None)
    if not ref_map:
        return None

    # Only dev-catalog deploys run run.py as a subprocess, which is the only path
    # that can be pointed at a different artifact directory. The in-process path
    # is bound to the artifact imported at inference-api boot, so honouring a ref
    # there would silently deploy against the wrong build.
    if not impl.requires_dev_catalog:
        logger.warning(
            f"{impl.model_name}: ignoring inference_artifact_ref -- it only applies to "
            f"models with requires_dev_catalog=true. Using the globally pinned artifact."
        )
        return None

    # Match the resolved runtime device first ("p150"), then the detected board
    # type ("P300x2"). These differ on multi-chip boards: _BOARD_TO_SINGLE_CHIP_DEVICE
    # maps P300x2 -> p150, so a P300x2 box actually deploys with --tt-device p150.
    # Accept either spelling so a catalog author can key on what they see.
    lookup = {str(k).strip().lower(): v for k, v in ref_map.items()}
    for candidate in (device, board_type):
        if not candidate:
            continue
        ref = lookup.get(str(candidate).strip().lower())
        if ref:
            logger.info(
                f"{impl.model_name}: using tt-inference-server ref '{ref}' "
                f"(matched '{candidate}')"
            )
            return ref

    # A pin exists but nothing matched -- almost always a typo'd key. Say so
    # rather than silently falling back to a build that lacks this model.
    logger.warning(
        f"{impl.model_name}: inference_artifact_ref has no entry for device "
        f"'{device}' or board '{board_type}' (keys: {sorted(ref_map)}). "
        f"Using the globally pinned artifact."
    )
    return None
