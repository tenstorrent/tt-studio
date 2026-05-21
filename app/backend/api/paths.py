# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import os

TT_STUDIO_ROOT = os.getenv("TT_STUDIO_ROOT", "/workspace")
FASTAPI_LOG = os.path.join(TT_STUDIO_ROOT, "fastapi.log")
FASTAPI_LOGS_DIR = os.path.join(TT_STUDIO_ROOT, "fastapi_logs")
TT_INFERENCE_WORKFLOW_LOGS = os.path.join(
    TT_STUDIO_ROOT, ".artifacts", "tt-inference-server", "workflow_logs"
)
