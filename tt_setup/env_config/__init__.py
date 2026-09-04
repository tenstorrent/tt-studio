# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Environment + preferences configuration for the launcher.

Split into _values (predicates), _dotenv (.env I/O), _preferences (CLI prefs),
_hf_access (HF gated-model checks), _version (version stamp + snapshot), and
_configure (interactive flow + FORCE_OVERWRITE + the lazy inference-server wrapper).
Re-exports the full prior surface so `from tt_setup.env_config import X` and
`import tt_setup.env_config as M` keep working unchanged.
"""

from tt_setup.constants import *  # noqa: F401,F403  (re-export constants: M.ENV_FILE_PATH etc.)
from tt_setup.env_config._values import is_placeholder, parse_boolean_env
from tt_setup.env_config._dotenv import (
    comment_out_env_var,
    get_env_var,
    get_existing_env_vars,
    write_env_var,
)
from tt_setup.env_config._preferences import (
    clear_preferences,
    get_preference,
    is_first_time_setup,
    load_preferences,
    save_preference,
    save_preferences,
)
from tt_setup.env_config._hf_access import _hf_check_repo, check_hf_access, render_hf_access
from tt_setup.env_config._version import save_setup_config, set_app_version_env
from tt_setup.env_config._configure import (
    adopt_hf_token_from_environment,
    FORCE_OVERWRITE,
    ask_overwrite_preference,
    configure_environment_sequentially,
    configure_inference_server_artifact,
    display_first_time_welcome,
    should_configure_var,
)

__all__ = [
    "is_placeholder", "parse_boolean_env",
    "write_env_var", "comment_out_env_var", "get_env_var", "get_existing_env_vars",
    "load_preferences", "save_preferences", "save_preference", "get_preference",
    "clear_preferences", "is_first_time_setup",
    "_hf_check_repo", "check_hf_access", "render_hf_access",
    "save_setup_config", "set_app_version_env",
    "FORCE_OVERWRITE", "adopt_hf_token_from_environment", "should_configure_var", "display_first_time_welcome",
    "ask_overwrite_preference", "configure_environment_sequentially",
    "configure_inference_server_artifact",
]
