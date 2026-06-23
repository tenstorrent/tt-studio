# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""TT Studio Setup Script

This script sets up the TT Studio environment including:
- Environment configuration
- Frontend dependencies installation (node_modules)
- Docker services setup
- TT Inference Server FastAPI setup (clones tt-inference-server repo and starts FastAPI on port 8001)

Usage:
    python run.py [options]

Options:
    --dev              Development mode with suggested defaults
    --cleanup          Clean up Docker containers and networks
    --cleanup-all      Clean up everything including persistent data
    --skip-fastapi     Skip TT Inference Server FastAPI setup
    --no-sudo          Skip sudo usage for FastAPI setup
    --check-headers       Check for missing SPDX license headers
    --add-headers         Add missing SPDX license headers (excludes frontend)
    --help-env         Show environment variables help"""

# Thin entrypoint. Implementation lives in the tt_setup/ package.
# Names below are re-exported for backwards compatibility (e.g. `import run`).

# Ensure third-party deps exist in a managed venv (re-execs into it on first run).
# Only when run as a script, and BEFORE importing modules that use
# rich/typer/pydantic/requests — so the heavy imports below run inside the venv.
# Guarded by __main__ so `import run` (tests, other tools) never re-execs.
from tt_setup.bootstrap import ensure_environment

if __name__ == "__main__":
    ensure_environment()

from tt_setup.cli import main
from tt_setup.constants import (  # noqa: F401
    _CLEANUP_IMAGE_REFS,
    _CLEANUP_VOLUME_PREFIX,
    BROWSER_CLEANUP_SENTINEL,
    TT_STUDIO_ROOT,
    ENV_FILE_PATH,
    LOGS_DIR,
    STARTUP_LOG_FILE,
    PREFS_FILE_PATH,
    SETUP_CONFIG_FILE_PATH,
    LEGACY_SETUP_CONFIG_FILE_PATH,
    MODEL_RUN_LOG_FILE,
    MODEL_RUN_LOGS_DIR,
    FASTAPI_PID_FILE,
    DOCKER_CONTROL_LOG_FILE,
    DOCKER_CONTROL_PID_FILE,
    INFERENCE_API_DIR,
    DOCKER_CONTROL_SERVICE_DIR,
)
from tt_setup.env_config import (  # noqa: F401
    get_env_var,
    save_setup_config,
    set_app_version_env,
)
from tt_setup.docker import (  # noqa: F401
    check_docker_access,
    run_docker_command,
)
from tt_setup.cleanup import (  # noqa: F401
    cleanup_resources,
    _cleanup_runtime,
    _remove_local_tt_studio_images,
    _remove_tt_studio_model_volumes,
    _remove_tt_studio_network_containers,
    _prune_anonymous_volumes,
    _parse_size_to_bytes,
    _docker_reclaimable_bytes,
    _format_bytes,
    _path_size,
    _remove_path,
    _remove_directory_contents,
    _write_browser_cleanup_sentinel,
)
from tt_setup.services import (  # noqa: F401
    cleanup_fastapi_server,
    cleanup_docker_control_service,
)


if __name__ == "__main__":
    main()
