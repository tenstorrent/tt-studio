# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Themed interactive prompts (ask / confirm / secret), guarded against the
sticky header."""

from rich.prompt import Confirm, InvalidResponse, Prompt
from tt_setup.console._theme import console
from tt_setup.console._stepper import _prompt_guard


class _YesNoConfirm(Confirm):
    """Confirm that accepts the full words 'yes'/'no' as well as 'y'/'n'.

    Rich's stock Confirm only accepts single letters and rejects 'yes'/'no'
    with 'Please enter Y or N', which trips people up. Empty input still falls
    through to the default (handled by the base prompt before this runs)."""

    def process_response(self, value):
        value = value.strip().lower()
        if value in ("y", "yes"):
            return True
        if value in ("n", "no"):
            return False
        raise InvalidResponse(self.validate_error_message)


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
        return _YesNoConfirm.ask(prompt, console=console, default=default)


def secret(prompt):
    """Masked input via getpass, with the pinned stepper suspended for the
    duration so it doesn't clash with the (non-Rich) prompt. Returns the raw string."""
    import getpass
    with _prompt_guard():
        return getpass.getpass(prompt)

