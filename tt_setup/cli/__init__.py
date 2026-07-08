# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Argument parsing + orchestration entrypoint for `python run.py`.

Split into _args (Typer app / callback / main) and _run (the phased orchestration).
Re-exports app / main / _entry so `from tt_setup.cli import main` and
`import tt_setup.cli as M` keep working unchanged.
"""

from tt_setup.cli._args import _entry, app, main

__all__ = ["app", "main", "_entry"]
