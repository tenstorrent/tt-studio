# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`--switch REF`: move this tt-studio checkout to a branch or release tag.

Fetches origin, then checks out the requested ref — a branch (local or
origin-only, fast-forwarded to origin) or a tag (detached HEAD, how release
candidates are consumed). Always exits afterwards instead of continuing into
startup: the code on disk just changed under the running process, so the next
`python run.py` must re-bootstrap against the new ref.
"""

import subprocess

from tt_setup.console import console, notice_panel, step
from tt_setup.constants import TT_STUDIO_ROOT


def _git(*argv):
    """Run git in the repo root with output captured (surfaced only on failure)."""
    return subprocess.run(
        ["git", "-C", TT_STUDIO_ROOT, *argv],
        capture_output=True, text=True, check=False,
    )


def _ref_exists(full_ref):
    return _git("rev-parse", "--verify", "--quiet", full_ref).returncode == 0


def plan_switch(has_local_branch, has_remote_branch, has_tag):
    """Classify a ref as 'branch', 'tag', or None. A branch of the same name
    wins over a tag — branches are the common case and stay updatable."""
    if has_local_branch or has_remote_branch:
        return "branch"
    if has_tag:
        return "tag"
    return None


def _fail_panel(title, lines):
    console.print(notice_panel(f"[bold]{title}[/bold]", lines, border_style="error"))
    return 1


def switch_checkout(ref):
    """Orchestrate `--switch REF`. Returns a process exit code (0 ok, 1 failed)."""
    dirty = _git("status", "--porcelain", "--untracked-files=no")
    if dirty.returncode != 0:
        return _fail_panel(
            "⛔ Couldn't inspect this checkout",
            [
                "[muted]git wasn't able to report the working-tree state:[/muted]",
                (dirty.stderr or dirty.stdout).strip() or "(no output)",
            ],
        )
    if dirty.stdout.strip():
        return _fail_panel(
            "⛔ Your tt-studio checkout has local changes — can't switch",
            [
                "Switching branches would clobber uncommitted work.",
                "",
                f"[bold]Fix →[/bold]  commit or stash your changes ([info]git status[/info] shows them),",
                f"then re-run  [info]python run.py --switch {ref}[/info]",
            ],
        )

    fetch_error = ""
    with step("Fetching origin (branches and tags)") as s:
        fetched = _git("fetch", "origin", "--tags")
        if fetched.returncode != 0:
            fetch_error = (fetched.stderr or fetched.stdout).strip()
            s.fail()
    if fetch_error:
        return _fail_panel(
            "⛔ Couldn't reach origin",
            [
                "[muted]Check your network connection / git remote, or switch manually with git.[/muted]",
                "",
                fetch_error,
            ],
        )

    kind = plan_switch(
        _ref_exists(f"refs/heads/{ref}"),
        _ref_exists(f"refs/remotes/origin/{ref}"),
        _ref_exists(f"refs/tags/{ref}"),
    )
    if kind is None:
        return _fail_panel(
            f"⛔ '{ref}' isn't a branch or tag on origin",
            [
                "[muted]List what's available with[/muted] [info]git branch -r[/info]"
                " [muted]and[/muted] [info]git tag[/info][muted], then retry.[/muted]",
            ],
        )

    checkout_error = ""
    if kind == "branch":
        with step(f"Switching to branch {ref}") as s:
            # `checkout <ref>` also creates the local tracking branch when the
            # ref only exists on origin; the ff-only pull then syncs it without
            # ever merging (a diverged local branch fails instead).
            result = _git("checkout", ref)
            if result.returncode == 0:
                result = _git("pull", "--ff-only", "origin", ref)
            if result.returncode != 0:
                checkout_error = (result.stderr or result.stdout).strip()
                s.fail()
        if checkout_error:
            return _fail_panel(
                f"⛔ Couldn't switch to branch '{ref}'",
                [
                    f"[muted]If your local '{ref}' has diverged from origin, resolve it "
                    "with git, then retry.[/muted]",
                    "",
                    checkout_error,
                ],
            )
        switched_to = f"branch '{ref}'"
    else:
        with step(f"Checking out tag {ref}") as s:
            result = _git("checkout", f"tags/{ref}")
            if result.returncode != 0:
                checkout_error = (result.stderr or result.stdout).strip()
                s.fail()
        if checkout_error:
            return _fail_panel(
                f"⛔ Couldn't check out tag '{ref}'",
                ["", checkout_error],
            )
        sha = _git("rev-parse", "--short", "HEAD").stdout.strip()
        switched_to = f"tag {ref}" + (f" (detached at {sha})" if sha else "")

    console.print(notice_panel(
        f"[bold]✅ Switched to {switched_to}[/bold]",
        [
            f"[bold]Next →[/bold]  re-run [info]python run.py[/info] [muted](or [/muted][info]tt-studio[/info][muted]) to start on this version.[/muted]",
            "[muted]If TT Studio is currently running, restart it:[/muted] "
            "[info]python run.py --stop[/info][muted], then start again.[/muted]",
        ],
        border_style="accent",
    ))
    return 0
