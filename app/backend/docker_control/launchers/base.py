# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The launcher-backend contract: what TT Studio needs from a thing that serves models.

TT Studio has two ways to bring a model up — tt-inference-server for the released
catalog, tt-model-manager for community bundles — and everything around them is
shared: the chip allocator, the deployment record, the progress APIs, the health
monitor, the chat surfaces. This is the seam between them, so the deploy view chooses
a backend once instead of branching on model source throughout.

A launcher is deliberately narrow. It starts and stops a model and says how it should
be addressed; it does not allocate chips, write deployment records, or report progress,
because those are identical for both backends and belong to the caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


@dataclass(frozen=True)
class StartRequest:
    """Everything a launcher needs to start one model, resolved by the caller.

    ``device_ids`` is the full set of chip slots the deployment occupies; a launcher
    uses it to place or to pin, whichever it supports.
    """

    model_impl: Any
    device: str
    device_ids: List[int]
    service_port: int
    board_type: Optional[str] = None
    options: Dict[str, Any] = None


@dataclass(frozen=True)
class StartResult:
    """The outcome of a start. ``job_id`` addresses the shared progress APIs."""

    status: str  # "success" | "error"
    job_id: Optional[str] = None
    message: str = ""
    api_response: Optional[Dict[str, Any]] = None

    @property
    def ok(self) -> bool:
        return self.status == "success" and bool(self.job_id)


@dataclass(frozen=True)
class StopResult:
    status: str  # "success" | "error"
    message: str = ""
    # True when the backend had to reset the board as part of stopping, so the UI can
    # say why the devices went away.
    mesh_reset: bool = False


@runtime_checkable
class LauncherBackend(Protocol):
    """A backend that can serve models on this host."""

    #: Stable identifier, also the value reported to the UI as a model's source.
    name: str

    def available(self) -> bool:
        """Whether this backend can be used right now (artifact present, host ready)."""

    def start(self, request: StartRequest) -> StartResult:
        """Begin a deployment. Must return promptly with a job_id for progress polling."""

    def stop(self, deployment) -> StopResult:
        """Stop a deployment this backend started."""
