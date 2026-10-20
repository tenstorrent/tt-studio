# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Launcher backends: the two ways TT Studio brings a model up.

``for_model_id`` is the single dispatch point. Everything else in the deploy path —
chip allocation, deployment records, progress, health — is shared between backends.
"""

from shared_config.community_model_config import is_community_model_id

from docker_control.launchers.base import (
    LauncherBackend,
    StartRequest,
    StartResult,
    StopResult,
)
from docker_control.launchers.inference_server import (
    NAME as INFERENCE_SERVER,
    TTInferenceServerLauncher,
)
from docker_control.launchers.model_manager import (
    NAME as COMMUNITY,
    TTModelManagerLauncher,
)

_LAUNCHERS = {
    INFERENCE_SERVER: TTInferenceServerLauncher(),
    COMMUNITY: TTModelManagerLauncher(),
}


def source_for_model_id(model_id) -> str:
    """Which backend owns a model_id. Also the ``source`` the UI groups models by."""
    return COMMUNITY if is_community_model_id(model_id) else INFERENCE_SERVER


def for_model_id(model_id) -> LauncherBackend:
    return _LAUNCHERS[source_for_model_id(model_id)]


def get(name: str) -> LauncherBackend:
    return _LAUNCHERS[name]


__all__ = [
    "COMMUNITY",
    "INFERENCE_SERVER",
    "LauncherBackend",
    "StartRequest",
    "StartResult",
    "StopResult",
    "TTInferenceServerLauncher",
    "TTModelManagerLauncher",
    "for_model_id",
    "get",
    "source_for_model_id",
]
