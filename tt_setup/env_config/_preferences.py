# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Persistent CLI preferences + first-run detection.

Backed by the ``preferences`` namespace of the consolidated config store
(``.tt_studio_config.json``); see tt_setup/config_store.py.
"""

from tt_setup import config_store


def load_preferences():
    """Load user preferences."""
    return config_store.get_ns("preferences")


def save_preferences(prefs):
    """Replace all user preferences."""
    config_store.set_ns("preferences", dict(prefs))


def save_preference(key, value):
    """Save a single preference key-value pair."""
    config_store.set("preferences", key, value)


def get_preference(key, default=None):
    """Get a preference value by key, returning default if not found."""
    return config_store.get("preferences", key, default)


def clear_preferences():
    """Clear all user preferences (leaves other config namespaces untouched)."""
    config_store.set_ns("preferences", {})
    return True


def is_first_time_setup():
    """First run == no preferences recorded yet."""
    return not config_store.get_ns("preferences")
