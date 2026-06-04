# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared Rich console + theme for tt-studio output.

Provides a single `console` instance so all modules render through one place.
The legacy ANSI `C_*` constants in tt_setup.constants still work; this is used
for the structured output (progress bars, tables, panels, tracebacks) and for
new code. Color migration of existing prints is intentionally gradual.
"""

from rich.console import Console
from rich.theme import Theme

TT_THEME = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "bold red",
    "muted": "dim",
    "tt": "magenta",
})

console = Console(theme=TT_THEME)
