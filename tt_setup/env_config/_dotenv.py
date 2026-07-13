# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Read/write the repo-root .env (single unquoted format)."""

import os
import re
from dotenv import dotenv_values, set_key
from tt_setup.constants import *


def write_env_var(var_name, var_value, quote_value=None):
    """
    Update or add a variable in the repo-root .env using ONE consistent format.

    Uses python-dotenv (the standard .env library) and writes values unquoted
    (quote_mode="never"), so the file never mixes `KEY="value"` and `KEY=value`
    styles. This matches .env.default and avoids docker-compose treating
    surrounding quotes as literal characters. `quote_value` is accepted for
    backwards compatibility but intentionally ignored.
    """
    if not os.path.exists(ENV_FILE_PATH):
        open(ENV_FILE_PATH, 'w').close()
    value = "" if var_value is None else str(var_value)
    set_key(ENV_FILE_PATH, var_name, value, quote_mode="never")


def comment_out_env_var(var_name):
    """Comment out an environment variable in the .env file (VAR=val → # VAR=val)."""
    if not os.path.exists(ENV_FILE_PATH):
        return
    with open(ENV_FILE_PATH, 'r') as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if re.match(f"^{re.escape(var_name)}=", line):
            lines[i] = f"# {line}"
            break
    with open(ENV_FILE_PATH, 'w') as f:
        f.writelines(lines)


def get_env_var(var_name, default=""):
    """Safely get a variable from app/.env (quotes handled by python-dotenv)."""
    if not os.path.exists(ENV_FILE_PATH):
        return default
    value = dotenv_values(ENV_FILE_PATH, interpolate=False).get(var_name)
    return default if value is None else value


def get_existing_env_vars():
    """Read all existing environment variables from app/.env (via python-dotenv)."""
    if not os.path.exists(ENV_FILE_PATH):
        return {}
    return {
        key: value
        for key, value in dotenv_values(ENV_FILE_PATH, interpolate=False).items()
        if value is not None
    }

