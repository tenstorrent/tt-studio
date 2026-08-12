# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared Rich console + calm phase output for tt-studio.

Split into submodules: _theme (consoles/verbose), _stepper (sticky phase stepper +
build pulse + phase API + prompt guard), _panels (Rich panels), _prompts (ask/
confirm/secret), _steps (the step() primitive + download bar). This package
re-exports the full prior surface so `from tt_setup.console import X` and
`import tt_setup.console as C` keep working unchanged.
"""

from tt_setup.console._theme import (
    TT_THEME,
    Console,
    _fmt_duration,
    _real_console,
    console,
    is_verbose,
    no_clear,
    progress_status,
    real_console,
    set_no_clear,
    set_verbose,
)
from tt_setup.console._stepper import (
    add_note,
    begin_phase,
    build_activity,
    build_event,
    build_log,
    build_note,
    end_phase,
    end_run,
    ensure_region_reset,
    get_notes,
    in_phase,
    register_phases,
    register_setup_phases,
    rename_phase,
    set_mode,
    show_detail,
    start_pulse,
    sticky_active,
    stop_active_phase,
    stop_pulse,
)
from tt_setup.console._panels import (
    kept_panel,
    notice_panel,
    ready_panel,
    steps_panel,
    welcome_panel,
)
from tt_setup.console._prompts import ask, confirm, secret
from tt_setup.console._steps import download_with_progress, step

__all__ = [
    "TT_THEME", "Console", "console", "_real_console", "real_console", "set_verbose",
    "is_verbose", "set_no_clear", "no_clear", "progress_status", "_fmt_duration",
    "in_phase", "show_detail", "add_note", "get_notes",
    "register_phases", "register_setup_phases", "rename_phase", "set_mode", "ensure_region_reset",
    "sticky_active", "begin_phase", "end_phase", "end_run",
    "build_event", "build_log", "build_note", "build_activity", "start_pulse", "stop_pulse",
    "stop_active_phase",
    "welcome_panel", "ready_panel", "kept_panel", "notice_panel", "steps_panel",
    "ask", "confirm", "secret",
    "step", "download_with_progress",
]
