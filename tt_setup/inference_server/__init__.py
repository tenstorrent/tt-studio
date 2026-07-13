# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""TT Inference Server artifact setup (download/extract/validate/sync).

Split into focused submodules (_config, _git, _metadata, _env, _catalog,
_privileges, _orchestrator). Re-exports the full prior surface so
`from tt_setup.inference_server import X` / `import tt_setup.inference_server as M`
keep working unchanged.
"""

from tt_setup.inference_server._config import configure_inference_server_artifact
from tt_setup.inference_server._env import _set_artifact_environment_variables
from tt_setup.inference_server._git import _is_commit_sha, fetch_branch_commit_sha
from tt_setup.inference_server._metadata import (
    _write_artifact_info,
    get_inference_server_version,
    validate_artifact_structure,
)
from tt_setup.inference_server._catalog import _sync_model_catalog
from tt_setup.inference_server._privileges import (
    remove_artifact_with_sudo,
    request_sudo_authentication,
)
from tt_setup.inference_server._orchestrator import setup_tt_inference_server

__all__ = [
    "configure_inference_server_artifact",
    "setup_tt_inference_server",
    "_sync_model_catalog",
    "_set_artifact_environment_variables",
    "_is_commit_sha",
    "fetch_branch_commit_sha",
    "_write_artifact_info",
    "get_inference_server_version",
    "validate_artifact_structure",
    "remove_artifact_with_sudo",
    "request_sudo_authentication",
]
