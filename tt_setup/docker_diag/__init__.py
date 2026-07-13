# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Docker/compose build-progress streaming + failure diagnostics.

Split into `_build_progress` (parse + stream `docker compose up --build`) and
`_diagnostics` (failure parsing, container verification, remediation panels).
This package re-exports the full prior surface so `from tt_setup.docker_diag
import X` and `import tt_setup.docker_diag as M` keep working unchanged.
"""

from tt_setup.docker_diag._build_progress import (
    _BUILD_STEP_RE,
    _BUILT_RE,
    _CACHED_RE,
    _short_service,
    friendly_build_label,
    parse_build_line,
    run_docker_compose_with_progress,
)
from tt_setup.docker_diag._diagnostics import (
    _resolve_container_name,
    diagnose_container_failure,
    handle_docker_compose_result,
    parse_docker_build_failure,
    print_container_diagnostics,
    suggest_docker_fixes,
    suggest_pip_fixes,
    verify_docker_containers,
)

__all__ = [
    "_BUILD_STEP_RE",
    "_BUILT_RE",
    "_CACHED_RE",
    "_resolve_container_name",
    "_short_service",
    "diagnose_container_failure",
    "friendly_build_label",
    "handle_docker_compose_result",
    "parse_build_line",
    "parse_docker_build_failure",
    "print_container_diagnostics",
    "run_docker_compose_with_progress",
    "suggest_docker_fixes",
    "suggest_pip_fixes",
    "verify_docker_containers",
]
