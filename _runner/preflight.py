# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Preflight checks run before the main startup sequence.
"""


def run_preflight_checks(ctx=None):
    """
    Run preflight checks before main startup.

    Currently a no-op placeholder; add system-level checks here as needed.

    Args:
        ctx: RunContext (optional)

    Returns:
        bool: True if all checks passed
    """
    return True
