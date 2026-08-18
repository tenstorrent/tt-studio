# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The destructive-action confirmation shared by --purge-all and --purge-model."""

from tt_setup.console import console


def _confirm_purge(assume_yes, prompt_text):
    """Hand-rolled y/n loop (kept off `console.confirm` so Enter defaults to
    abort, never to delete). Returns True to proceed; prints the abort line and
    returns False on n/no/empty/Ctrl-C. `assume_yes` (--yes) skips the prompt."""
    if assume_yes:
        console.print("\n[muted]--yes passed; proceeding without prompt.[/muted]")
        return True
    while True:
        try:
            answer = console.input(
                f"\n[warning]{prompt_text}[/warning] [muted](y/yes or n/no)[/muted] "
            ).strip().lower()
        except (KeyboardInterrupt, EOFError):
            console.print("\n[warning]🛑 Aborted — nothing was deleted.[/warning]")
            return False
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no", ""):
            console.print("\n[info]🛑 Aborted — nothing was deleted.[/info]")
            return False
        console.print("[muted]Please answer y/yes or n/no.[/muted]")
