# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Themed interactive prompts (ask / confirm / secret), guarded against the
sticky header."""

from rich.prompt import Confirm, Prompt
from tt_setup.console._theme import console
from tt_setup.console._stepper import _prompt_guard


def ask(prompt, default=None, choices=None, password=False):
    """Themed text prompt (rich.prompt.Prompt) — consistent styling, validated
    `choices`, and a shown default. Pass password=True to mask input. Suspends
    any active phase spinner; lets KeyboardInterrupt propagate so callers can
    print their resume hint."""
    with _prompt_guard():
        return Prompt.ask(prompt, console=console, default=default,
                          choices=choices, password=password)


def confirm(prompt, default=True):
    """Themed yes/no prompt (rich.prompt.Confirm). Suspends any active phase
    spinner; lets KeyboardInterrupt propagate."""
    with _prompt_guard():
        return Confirm.ask(prompt, console=console, default=default)


def secret(prompt):
    """Masked input via getpass, with the pinned stepper suspended for the
    duration so it doesn't clash with the (non-Rich) prompt. Returns the raw string."""
    import getpass
    with _prompt_guard():
        return getpass.getpass(prompt)

