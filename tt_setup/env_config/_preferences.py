# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Persistent CLI preferences (JSON) + first-run detection."""

import json
import os
from tt_setup.constants import *
from tt_setup.console import console


def load_preferences():
    """Load user preferences from JSON file."""
    if os.path.exists(PREFS_FILE_PATH):
        try:
            with open(PREFS_FILE_PATH, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_preferences(prefs):
    """Save user preferences to JSON file."""
    try:
        with open(PREFS_FILE_PATH, 'w') as f:
            json.dump(prefs, f, indent=2)
    except IOError as e:
        console.print(f"[warning]Warning: Could not save preferences: {e}[/warning]")


def save_preference(key, value):
    """Save a single preference key-value pair."""
    prefs = load_preferences()
    prefs[key] = value
    save_preferences(prefs)


def get_preference(key, default=None):
    """Get a preference value by key, returning default if not found."""
    prefs = load_preferences()
    return prefs.get(key, default)


def clear_preferences():
    """Clear all user preferences by deleting the preferences file."""
    if os.path.exists(PREFS_FILE_PATH):
        try:
            os.remove(PREFS_FILE_PATH)
            return True
        except IOError:
            return False
    return True


def is_first_time_setup():
    """Check if this is the first time setup by checking if preferences exist."""
    return not os.path.exists(PREFS_FILE_PATH)

