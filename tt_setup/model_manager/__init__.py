# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""tt-model-manager artifact setup (pinned venv for the community-model path)."""

from tt_setup.model_manager._orchestrator import (
    model_manager_python,
    model_manager_status,
    setup_tt_model_manager,
)

__all__ = [
    "model_manager_python",
    "model_manager_status",
    "setup_tt_model_manager",
]
