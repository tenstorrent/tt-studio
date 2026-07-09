# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Optional `tt-studio` shell shortcut.

Lets the user run the launcher from any directory with `tt-studio` instead of
`python3 run.py`. Installs a small shell function into the user's rc file
(~/.zshrc / ~/.bashrc). The function cd's into the repo inside a subshell, so it
keeps run.py's `TT_STUDIO_ROOT = os.getcwd()` assumption *and* leaves the caller's
working directory untouched. Bash/zsh are installed automatically; other shells
get a printed snippet to paste.

Surfaced two ways (see tt_setup/cli/_run.py): `python run.py --install-shortcut`,
and a one-time offer on a normal launch when it isn't already set up.
"""

import os

from tt_setup.console import confirm, console, notice_panel
from tt_setup.constants import OS_NAME, TT_STUDIO_ROOT
from tt_setup.env_config import get_preference, save_preference

SHORTCUT_NAME = "tt-studio"
# Sentinels bracket the block we own, so we can detect/replace it idempotently
# (e.g. re-point it if the repo moves) without touching the rest of the rc file.
_MARKER_START = "# >>> tt-studio shortcut >>>"
_MARKER_END = "# <<< tt-studio shortcut <<<"
_PREF_PROMPT_SEEN = "shortcut_prompt_seen"


def _detect_shell_rc():
    """(shell_name, rc_path) for the current shell; rc_path is None if the shell
    isn't auto-supported (only bash/zsh share this POSIX function syntax).

    Targets the file the user's *interactive* shell actually reads, which for
    bash differs by OS: macOS Terminal starts login shells (~/.bash_profile)
    while Linux terminals start non-login shells (~/.bashrc). zsh reads
    ~/.zshrc on both macOS and Linux.
    """
    shell = os.path.basename(os.environ.get("SHELL", ""))
    home = os.path.expanduser("~")
    if shell == "zsh":
        return "zsh", os.path.join(home, ".zshrc")
    if shell == "bash":
        rc = ".bash_profile" if OS_NAME == "Darwin" else ".bashrc"
        return "bash", os.path.join(home, rc)
    return shell or "unknown", None


def _shortcut_line():
    """The shell function itself (subshell cd → repo, forward all args)."""
    return f'{SHORTCUT_NAME}() {{ ( cd "{TT_STUDIO_ROOT}" && python3 run.py "$@" ); }}'


def _shortcut_block():
    return f"{_MARKER_START}\n{_shortcut_line()}\n{_MARKER_END}\n"


def _strip_block(lines):
    """Drop any existing marked block (inclusive) so re-install replaces cleanly."""
    out, skipping = [], False
    for line in lines:
        stripped = line.strip()
        if stripped == _MARKER_START:
            skipping = True
            continue
        if stripped == _MARKER_END:
            skipping = False
            continue
        if not skipping:
            out.append(line)
    return out


def is_shortcut_installed(rc_path=None):
    """True if our marked block is already present in the shell rc."""
    if rc_path is None:
        _, rc_path = _detect_shell_rc()
    if not rc_path or not os.path.exists(rc_path):
        return False
    try:
        with open(rc_path, "r") as f:
            return _MARKER_START in f.read()
    except OSError:
        return False


def install_shortcut():
    """Add (or update) the `tt-studio` shortcut in the user's shell rc. Returns
    True on success. Unsupported shells get a printed manual snippet instead."""
    shell, rc_path = _detect_shell_rc()

    if not rc_path:
        console.print(notice_panel(
            "[bold]Add a tt-studio shortcut manually[/bold]",
            [
                f"[muted]Shell '{shell}' isn't set up automatically. Add this line to[/muted]",
                "[muted]your shell config, then reopen your terminal:[/muted]",
                "",
                f"[info]{_shortcut_line()}[/info]",
            ],
            border_style="warning",
        ))
        return False

    already = is_shortcut_installed(rc_path)
    try:
        existing = ""
        if os.path.exists(rc_path):
            with open(rc_path, "r") as f:
                existing = f.read()
        cleaned = "".join(_strip_block(existing.splitlines(keepends=True))).rstrip("\n")
        new_content = (cleaned + "\n\n" if cleaned else "") + _shortcut_block()
        with open(rc_path, "w") as f:
            f.write(new_content)
    except OSError as e:
        console.print(f"[error]❌ Could not update {rc_path}: {e}[/error]")
        return False

    console.print(notice_panel(
        f"[bold]✅ `{SHORTCUT_NAME}` shortcut {'updated' if already else 'added'}[/bold]",
        [
            f"[muted]File     →[/muted]  {rc_path}",
            f"[muted]Use it   →[/muted]  {SHORTCUT_NAME}          (from any directory)",
            f"[muted]         →[/muted]  {SHORTCUT_NAME} --dev / --stop / --help",
            "",
            f"[muted]Activate now →[/muted]  source {rc_path}",
            "[muted]…or just open a new terminal.[/muted]",
        ],
        border_style="accent",
    ))
    return True


def maybe_offer_shortcut(args):
    """One-time offer to install the shortcut during a normal launch. Skips when
    non-interactive, already installed, already offered, or the shell isn't
    auto-supported — so it never nags."""
    if not console.is_terminal:
        return
    _, rc_path = _detect_shell_rc()
    if not rc_path or is_shortcut_installed(rc_path):
        return
    if get_preference(_PREF_PROMPT_SEEN):
        return

    # Remember we asked (yes or no) so this only ever surfaces once; the
    # --install-shortcut flag remains available afterward either way.
    save_preference(_PREF_PROMPT_SEEN, True)

    console.print()
    console.print(
        "[muted]Tip: run [/muted][info]python run.py[/info][muted] a lot? "
        f"Add a [/muted][info]{SHORTCUT_NAME}[/info][muted] shortcut and just type it instead.[/muted]"
    )
    try:
        if confirm(f"Set up the `{SHORTCUT_NAME}` shortcut now?", default=False):
            install_shortcut()
    except (KeyboardInterrupt, EOFError):
        pass
