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
import re

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


# Matches the shell function to recover the repo path baked into an install.
_SHORTCUT_PATH_RE = re.compile(
    rf'^{re.escape(SHORTCUT_NAME)}\(\)\s*{{\s*\(\s*cd\s+"(.+)"\s+&&'
)


def extract_shortcut_path(content):
    """Repo path baked into an installed shortcut block, or None. Pure."""
    for line in content.splitlines():
        match = _SHORTCUT_PATH_RE.match(line.strip())
        if match:
            return match.group(1)
    return None


def installed_shortcut_path(rc_path=None):
    """Repo path the installed shortcut points at, or None when there is no
    supported rc file, no block, or the file can't be read."""
    if rc_path is None:
        _, rc_path = _detect_shell_rc()
    if not rc_path or not os.path.exists(rc_path):
        return None
    try:
        with open(rc_path, "r") as f:
            return extract_shortcut_path(f.read())
    except OSError:
        return None


def _strip_block(lines):
    """Drop a *complete* marked block (inclusive) so re-install replaces cleanly.

    If the start marker has no matching end marker (a partial previous install or
    a manual edit), leave the file untouched — dropping everything after an
    unclosed start marker would truncate the user's shell config.
    """
    starts = sum(1 for ln in lines if ln.strip() == _MARKER_START)
    ends = sum(1 for ln in lines if ln.strip() == _MARKER_END)
    if starts != ends:
        return list(lines)  # unbalanced markers → don't touch anything

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


def _write_shortcut_block(rc_path):
    """Strip any existing complete block and append a fresh one pointing at the
    current TT_STUDIO_ROOT. Returns True on success."""
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
    return True


def maybe_repair_shortcut():
    """Re-point an installed shortcut whose baked-in path no longer matches this
    checkout (the repo moved, or the user launched a different clone). Silent
    no-op otherwise; never raises — a broken rc file must not block startup."""
    # Under the pip shim the checkout lives in ~/.tt-studio and `tt-studio` is
    # already a console script — re-pointing a dev clone's rc shortcut at the
    # managed root would hijack it (and shadow the pip entry point).
    if os.environ.get("TT_STUDIO_MANAGED") == "1":
        return
    try:
        _, rc_path = _detect_shell_rc()
        if not rc_path or not is_shortcut_installed(rc_path):
            return
        current = installed_shortcut_path(rc_path)
        if not current or os.path.realpath(current) == os.path.realpath(TT_STUDIO_ROOT):
            return
        if _write_shortcut_block(rc_path):
            console.print(
                f"[muted]Updated the {SHORTCUT_NAME} shortcut to this checkout: {TT_STUDIO_ROOT}[/muted]"
            )
    except Exception:
        pass


def uninstall_shortcut():
    """Remove the marked shortcut block from the shell rc. Returns True if the
    block was removed."""
    _, rc_path = _detect_shell_rc()
    if not rc_path or not is_shortcut_installed(rc_path):
        console.print(f"[muted]No {SHORTCUT_NAME} shell shortcut found — nothing to remove.[/muted]")
        return False
    try:
        with open(rc_path, "r") as f:
            lines = f.read().splitlines(keepends=True)
        stripped = _strip_block(lines)
        if stripped == lines:
            # Unbalanced markers: _strip_block refused rather than truncate.
            console.print(
                f"[warning]⚠  Couldn't remove the {SHORTCUT_NAME} shortcut automatically — "
                f"the markers in {rc_path} look edited. Remove the lines between "
                f"'{_MARKER_START}' and '{_MARKER_END}' manually.[/warning]"
            )
            return False
        with open(rc_path, "w") as f:
            f.write("".join(stripped))
    except OSError as e:
        console.print(f"[error]❌ Could not update {rc_path}: {e}[/error]")
        return False
    console.print(
        f"[success]✓[/success] Removed the {SHORTCUT_NAME} shortcut from {rc_path} "
        f"[muted](reopen your terminal, or `source {rc_path}`, to drop it from this shell)[/muted]"
    )
    return True


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
    if not _write_shortcut_block(rc_path):
        return False

    # Put the activation command on the clipboard so it's one paste away — the
    # shortcut is useless until the shell reloads, and that's the easy-to-miss bit.
    activate_cmd = f"source {rc_path}"
    copied = False
    try:
        from tt_setup.shell import copy_to_clipboard
        copied = copy_to_clipboard(activate_cmd)
    except Exception:
        copied = False

    console.print(notice_panel(
        f"[bold]✅ `{SHORTCUT_NAME}` shortcut {'updated' if already else 'added'} — one step left[/bold]",
        [
            "[warning]⚠  It's not active in this terminal yet[/warning] — your shell has to reload first.",
            "",
            f"[bold]Activate it →[/bold]  [info]{activate_cmd}[/info]"
            + ("   [muted](copied to your clipboard — just paste)[/muted]" if copied else ""),
            "[muted]…or just open a new terminal window.[/muted]",
            "",
            f"[muted]Then, from any directory:[/muted]  [info]{SHORTCUT_NAME}[/info]"
            f"   [muted]· {SHORTCUT_NAME} --dev / --stop / --help[/muted]",
            f"[muted]Added to:[/muted]  {rc_path}",
        ],
        border_style="accent",
    ))
    return True


def maybe_offer_shortcut(args):
    """One-time offer to install the shortcut during a normal launch. Skips when
    non-interactive, already installed, already offered, or the shell isn't
    auto-supported — so it never nags."""
    if os.environ.get("TT_STUDIO_MANAGED") == "1":
        # pip-shim install: `tt-studio` already exists as a console script; the
        # rc shell function would shadow it and point at the managed checkout.
        return
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
