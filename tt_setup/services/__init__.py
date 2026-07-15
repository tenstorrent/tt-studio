# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Host-service + health orchestration for the launcher.

Split into _ports (port checks/freeing), _health (probes + waits), _fastapi
(inference-api lifecycle), _docker_control (Docker Control lifecycle), _frontend
(npm deps). Re-exports the full prior surface so `from tt_setup.services import X`
and `import tt_setup.services as M` keep working unchanged.
"""

from tt_setup.constants import *  # noqa: F401,F403  (re-export constants: M.TT_STUDIO_ROOT etc.)

from tt_setup.services._ports import (
    _process_is_docker,
    check_and_free_ports,
    check_port_available,
    kill_process_on_port,
)
from tt_setup.services._health import (
    get_frontend_config,
    probe_service,
    snapshot_health,
    wait_for_all_services,
    wait_for_frontend_and_open_browser,
    wait_for_service_health,
)
from tt_setup.services._fastapi import (
    apply_media_catalog_env_overlay,
    cleanup_fastapi_server,
    setup_fastapi_environment,
    start_fastapi_server,
)
from tt_setup.services._docker_control import (
    cleanup_docker_control_service,
    start_docker_control_service,
)
from tt_setup.services._frontend import ensure_frontend_dependencies, is_valid_git_repo

__all__ = [
    "check_port_available", "check_and_free_ports", "_process_is_docker", "kill_process_on_port",
    "probe_service", "snapshot_health", "wait_for_service_health", "wait_for_all_services",
    "wait_for_frontend_and_open_browser", "get_frontend_config",
    "setup_fastapi_environment", "apply_media_catalog_env_overlay", "start_fastapi_server",
    "cleanup_fastapi_server", "start_docker_control_service", "cleanup_docker_control_service",
    "ensure_frontend_dependencies", "is_valid_git_repo",
]
