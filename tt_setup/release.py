# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Maintainer release flags: --make-rc-branch / --update-rc-branch / --merge-rc-branch.

TT Studio's release model (CONTRIBUTING.md → Release Process): a release
candidate branch `rc-vX.Y.Z` is cut from `main`, validated changes are
cherry-picked from `dev`, the "Rc vX.Y.Z" PR is squash-merged back into `main`
with at least two approvals, and the merge commit is tagged `vX.Y.Z`. Git tags
are the only version source of truth — nothing bumps package.json.

Pushing the tag triggers the Publish images workflow (GHCR); publishing the
GitHub release fires it a second time. That duplicate is known and accepted:
the workflow's concurrency group serializes the runs and the rebuild produces
identical image tags.

These flags require the GitHub CLI (`gh`), authenticated with push access —
the only part of the launcher that does. Everything degrades to a clear
"install / log in" panel when it's missing.
"""

import os
import re
import shutil
import subprocess
import sys

from tt_setup.cleanup import _parse_picker_selection
from tt_setup.console import ask, confirm, console, notice_panel, step
from tt_setup.constants import TT_STUDIO_ROOT, _RC_BUMP_PICKER

_BUMP_PARTS = ("major", "minor", "patch")
# Strict vX.Y.Z (no suffixes) — deliberately rejects junk like v0.0.0-ghcr-test.
_VERSION_RE = re.compile(r"v(\d+)\.(\d+)\.(\d+)")
_ACTIONS_URL = "https://github.com/tenstorrent/tt-studio/actions/workflows/publish-images.yml"


def _git(*argv):
    """Run git in the repo root with output captured (surfaced only on failure)."""
    return subprocess.run(
        ["git", "-C", TT_STUDIO_ROOT, *argv],
        capture_output=True, text=True, check=False,
    )


def _gh(*argv, stdin_text=None):
    """Run the GitHub CLI in the repo root with output captured."""
    return subprocess.run(
        ["gh", *argv],
        cwd=TT_STUDIO_ROOT, input=stdin_text,
        capture_output=True, text=True, check=False,
    )


def _proc_output(proc):
    return (proc.stderr or proc.stdout).strip() or "(no output)"


def _ref_exists(full_ref):
    return _git("rev-parse", "--verify", "--quiet", full_ref).returncode == 0


def _fail_panel(title, lines):
    console.print(notice_panel(f"[bold]{title}[/bold]", lines, border_style="error"))
    return 1


# --- pure planners (no subprocess — unit-tested directly) ---------------------

def parse_version(text):
    """Strict `vX.Y.Z` → (X, Y, Z) int tuple, or None. The whole string must be
    the version (so `v0.0.0-ghcr-test` and branch names don't parse here)."""
    m = re.fullmatch(_VERSION_RE, (text or "").strip())
    return tuple(int(g) for g in m.groups()) if m else None


def bump_version(last, part):
    """`("v2.9.1", "minor")` → `"v2.10.0"`. Raises ValueError on junk input."""
    v = parse_version(last)
    if v is None:
        raise ValueError(f"not a vX.Y.Z version: {last!r}")
    if part not in _BUMP_PARTS:
        raise ValueError(f"bump part must be one of {_BUMP_PARTS}, got {part!r}")
    major, minor, patch = v
    if part == "major":
        return f"v{major + 1}.0.0"
    if part == "minor":
        return f"v{major}.{minor + 1}.0"
    return f"v{major}.{minor}.{patch + 1}"


def find_last_rc_version(tags, branches, merge_subjects):
    """Latest release version seen anywhere — release tags, `rc-vX.Y.Z`
    branches, or `Rc vX.Y.Z (#N)`-style merge subjects on main. Sources are
    combined because they have drifted: v2.9.x RCs merged without tags ever
    being pushed. Returns `"vX.Y.Z"` or None."""
    versions = []
    for tag in tags:
        v = parse_version(tag)
        if v:
            versions.append(v)
    for branch in branches:
        name = branch.strip().split("/")[-1]
        if name.startswith("rc-"):
            v = parse_version(name[len("rc-"):])
            if v:
                versions.append(v)
    for subject in merge_subjects:
        m = re.search(r"\b(?:rc[- ]v?|release candidate v)(\d+)\.(\d+)\.(\d+)\b",
                      subject, re.IGNORECASE)
        if m:
            versions.append(tuple(int(g) for g in m.groups()))
    if not versions:
        return None
    return "v{}.{}.{}".format(*max(versions))


def parse_oneline(lines):
    """`git log --oneline` lines → [(sha, subject)], skipping blanks."""
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        sha, _, subject = line.partition(" ")
        out.append((sha, subject))
    return out


def render_test_plan(version):
    """RC PR body: what this PR is, plus the release test checklist."""
    return f"""## Rc {version}

Cut from `main`; validated changes cherry-picked from `dev` (see CONTRIBUTING → Release Process).

### Test plan

- [ ] Fresh `python run.py` completes (setup → ready panel)
- [ ] Backend healthy: `curl localhost:8000/up/` and `curl localhost:8000/models/health/`
- [ ] Frontend loads at `localhost:3000`
- [ ] Deploy a model end-to-end; inference server healthy: `curl localhost:8001/health`
- [ ] `python run.py --stop`, then a restart works
- [ ] `IS_QB2` is off in `.env.default` (rc-* branches never ship it on)
- [ ] Release notes drafted and applied to this description
"""


def render_release_body(version, generated_notes):
    """GitHub release body: auto-generated notes plus the changelog link."""
    notes = (generated_notes or "").strip()
    compare = f"https://github.com/tenstorrent/tt-studio/releases/tag/{version}"
    return f"{notes}\n\n---\n\nRelease page: {compare}\n" if notes else f"TT Studio {version}\n"


# --- shared guards ------------------------------------------------------------

def _guard_clean_worktree(rerun_hint):
    """None when the checkout is clean; an exit code (int) after an error panel
    otherwise. Same rules as --switch: uncommitted work blocks branch surgery."""
    dirty = _git("status", "--porcelain", "--untracked-files=no")
    if dirty.returncode != 0:
        return _fail_panel(
            "⛔ Couldn't inspect this checkout",
            ["[muted]git wasn't able to report the working-tree state:[/muted]",
             _proc_output(dirty)],
        )
    if dirty.stdout.strip():
        return _fail_panel(
            "⛔ Your tt-studio checkout has local changes — can't touch release branches",
            [
                "Release branch operations switch branches and would clobber uncommitted work.",
                "",
                "[bold]Fix →[/bold]  commit or stash your changes ([info]git status[/info] shows them),",
                f"then re-run  [info]python run.py {rerun_hint}[/info]",
            ],
        )
    return None


def _preflight_gh():
    """None when `gh` is present and logged in; an exit code after a panel
    otherwise. Release flags are the only launcher feature that needs it."""
    if not shutil.which("gh"):
        return _fail_panel(
            "⛔ The GitHub CLI (gh) isn't installed",
            [
                "The release flags open and merge PRs and publish releases through gh.",
                "",
                "[bold]Fix →[/bold]  install it from [info]https://cli.github.com[/info], "
                "run [info]gh auth login[/info], then retry.",
            ],
        )
    auth = _gh("auth", "status")
    if auth.returncode != 0:
        return _fail_panel(
            "⛔ The GitHub CLI isn't logged in",
            [
                "[bold]Fix →[/bold]  run [info]gh auth login[/info] (needs repo push access), then retry.",
                "",
                _proc_output(auth),
            ],
        )
    return None


def _fetch_origin():
    """None on success; an exit code after a panel when origin is unreachable."""
    fetch_error = ""
    with step("Fetching origin (branches and tags)") as s:
        fetched = _git("fetch", "origin", "--tags")
        if fetched.returncode != 0:
            fetch_error = _proc_output(fetched)
            s.fail()
    if fetch_error:
        return _fail_panel(
            "⛔ Couldn't reach origin",
            ["[muted]Check your network connection / git remote, then retry.[/muted]",
             "", fetch_error],
        )
    return None


def _last_rc_version(branches_only=False):
    """Probe git for the latest known release version (see find_last_rc_version)."""
    branches = _git("branch", "-r").stdout.splitlines()
    if branches_only:
        return find_last_rc_version([], branches, [])
    tags = _git("tag", "-l", "v[0-9]*").stdout.splitlines()
    subjects = _git("log", "origin/main", "--format=%s", "-50").stdout.splitlines()
    return find_last_rc_version(tags, branches, subjects)


def _tag_on_origin(version):
    out = _git("ls-remote", "--tags", "origin", f"refs/tags/{version}")
    return bool(out.stdout.strip())


# --- --make-rc-branch ---------------------------------------------------------

def _resolve_new_version(part_or_version, last):
    """Turn the flag value (bump part, explicit vX.Y.Z, or the picker sentinel)
    into the new version string. Returns (version, None) or (None, exit_code)."""
    value = (part_or_version or "").strip()
    if value == _RC_BUMP_PICKER:
        if not sys.stdin.isatty():
            console.print()
            console.print(notice_panel(
                "[bold]--make-rc-branch needs a terminal to ask which part to bump[/bold]",
                ["stdin is not interactive.",
                 "Pass the bump directly:  [accent]python run.py --make-rc-branch minor[/accent]"
                 "  [muted](or major / patch / an explicit vX.Y.Z)[/muted]"],
                border_style="error",
            ))
            return None, 1
        current = last or "v0.0.0"
        console.print(f"\n[bold]Current version:[/bold] {current}"
                      + ("" if last else " [muted](no previous release found)[/muted]"))
        console.print(
            "[muted]  major — breaking changes (APIs, networking, incompatible redesigns)\n"
            "  minor — new backwards-compatible features (e.g. new model support)\n"
            "  patch — backwards-compatible bug fixes[/muted]")
        try:
            part = ask("Bump which part?", choices=list(_BUMP_PARTS), default="minor")
        except (KeyboardInterrupt, EOFError):
            console.print("\n[info]🛑 Aborted — nothing was created.[/info]")
            return None, 0
        return bump_version(current, part), None
    if value.lower() in _BUMP_PARTS:
        return bump_version(last or "v0.0.0", value.lower()), None
    explicit = value if value.startswith("v") else f"v{value}"
    if parse_version(explicit):
        return explicit, None
    return None, _fail_panel(
        f"⛔ '{part_or_version}' isn't a bump part or a version",
        ["Use [info]major[/info], [info]minor[/info], [info]patch[/info], "
         "or an explicit version like [info]v2.10.0[/info]."],
    )


def _warn_if_qb2_enabled():
    """rc-* branches must not ship IS_QB2=true (CONTRIBUTING → QB2 launch branch)."""
    env_default = os.path.join(TT_STUDIO_ROOT, ".env.default")
    try:
        with open(env_default) as f:
            content = f.read()
    except OSError:
        return
    if re.search(r"^\s*IS_QB2\s*=\s*true\s*$", content, re.IGNORECASE | re.MULTILINE):
        console.print("[warning]⚠  .env.default has IS_QB2=true — rc-* branches must keep "
                      "it off (that flag belongs to the QB2 launch branch only). "
                      "Remove it on this RC before merging.[/warning]")


def make_rc_branch(part_or_version):
    """Cut `rc-vX.Y.Z` from origin/main and open the "Rc vX.Y.Z" PR against
    main with the release test plan. Returns a process exit code."""
    code = _guard_clean_worktree("--make-rc-branch")
    if code is not None:
        return code
    code = _preflight_gh()
    if code is not None:
        return code
    code = _fetch_origin()
    if code is not None:
        return code

    version, code = _resolve_new_version(part_or_version, _last_rc_version())
    if version is None:
        return code
    branch = f"rc-{version}"

    if _ref_exists(f"refs/heads/{branch}") or _ref_exists(f"refs/remotes/origin/{branch}"):
        return _fail_panel(
            f"⛔ Branch '{branch}' already exists",
            ["Cherry-pick into it with [info]python run.py --update-rc-branch[/info], "
             "or pick a different bump."],
        )
    if _ref_exists(f"refs/tags/{version}") or _tag_on_origin(version):
        return _fail_panel(
            f"⛔ Tag '{version}' already exists — that version has shipped",
            ["Pick a different bump."],
        )

    branch_error = ""
    with step(f"Cutting {branch} from origin/main") as s:
        result = _git("checkout", "-B", branch, "origin/main")
        if result.returncode == 0:
            result = _git("push", "-u", "origin", branch)
        if result.returncode != 0:
            branch_error = _proc_output(result)
            s.fail()
    if branch_error:
        return _fail_panel(f"⛔ Couldn't create and push '{branch}'", ["", branch_error])

    _warn_if_qb2_enabled()

    pr_url, pr_error = "", ""
    with step(f"Opening the 'Rc {version}' PR against main") as s:
        result = _gh("pr", "create", "--base", "main", "--head", branch,
                     "--title", f"Rc {version}", "--body-file", "-",
                     stdin_text=render_test_plan(version))
        if result.returncode != 0:
            pr_error = _proc_output(result)
            s.fail()
        else:
            pr_url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    if pr_error:
        return _fail_panel(
            f"⛔ Branch '{branch}' was pushed, but the PR couldn't be opened",
            ["[muted]Open it manually:[/muted] "
             f"[info]gh pr create --base main --head {branch} --title 'Rc {version}'[/info]",
             "", pr_error],
        )

    console.print(notice_panel(
        f"[bold]✅ Release candidate {version} is cut[/bold]",
        [
            f"Branch [info]{branch}[/info] (you are now on it) · PR: [info]{pr_url}[/info]",
            "",
            "[bold]Next →[/bold]  cherry-pick validated fixes from dev with "
            "[info]python run.py --update-rc-branch[/info],",
            "then, once the PR has ≥2 approvals and green checks, ship it with "
            "[info]python run.py --merge-rc-branch[/info].",
        ],
        border_style="accent",
    ))
    return 0


# --- --update-rc-branch -------------------------------------------------------

def _current_rc_branch():
    """(version, branch) for the newest rc-v* branch on origin, or (None, None)."""
    version = _last_rc_version(branches_only=True)
    return (version, f"rc-{version}") if version else (None, None)


def _pick_commits_interactively(candidates):
    """Numbered multi-select over the candidate dev commits (oldest first).
    Returns the chosen (sha, subject) list, or None when the user cancels."""
    console.print("\n[bold]Commits on dev that aren't on the RC yet[/bold] [muted](oldest first)[/muted]")
    for i, (sha, subject) in enumerate(candidates, start=1):
        console.print(f"  {i}. [info]{sha}[/info] {subject}")
    while True:
        try:
            raw = ask("Commits to cherry-pick (e.g. '1 3', or 'all'; Enter to cancel)", default="")
        except (KeyboardInterrupt, EOFError):
            raw = ""
        raw = (raw or "").strip()
        if raw.lower() in ("", "q", "quit", "n", "no"):
            console.print("\n[info]🛑 Aborted — the RC branch was not changed.[/info]")
            return None
        selection = _parse_picker_selection(raw, len(candidates))
        if selection:
            return [candidates[i - 1] for i in selection]
        console.print(f"[muted]Enter numbers between 1 and {len(candidates)} "
                      f"(space/comma separated), or 'all'.[/muted]")


def update_rc_branch():
    """Cherry-pick new dev commits into the current rc-vX.Y.Z branch.
    Returns a process exit code."""
    code = _guard_clean_worktree("--update-rc-branch")
    if code is not None:
        return code
    code = _preflight_gh()
    if code is not None:
        return code
    code = _fetch_origin()
    if code is not None:
        return code

    version, branch = _current_rc_branch()
    if branch is None:
        return _fail_panel(
            "⛔ No rc-v* branch found on origin",
            ["Cut one first with [info]python run.py --make-rc-branch[/info]."],
        )

    checkout_error = ""
    with step(f"Switching to {branch}") as s:
        result = _git("checkout", branch)
        if result.returncode == 0:
            result = _git("pull", "--ff-only", "origin", branch)
        if result.returncode != 0:
            checkout_error = _proc_output(result)
            s.fail()
    if checkout_error:
        return _fail_panel(f"⛔ Couldn't switch to '{branch}'", ["", checkout_error])

    # --cherry-pick drops commits whose patch already landed on the RC (dev is
    # squash-merged, and cherry-picks preserve the patch, so patch-id matching
    # works). --reverse lists oldest first — the order they must apply in.
    log = _git("log", "--cherry-pick", "--right-only", "--no-merges", "--reverse",
               "--oneline", f"origin/{branch}...origin/dev")
    if log.returncode != 0:
        return _fail_panel("⛔ Couldn't compare the RC against dev", ["", _proc_output(log)])
    candidates = parse_oneline(log.stdout.splitlines())
    if not candidates:
        console.print(notice_panel(
            f"[bold]✅ {branch} is up to date with dev[/bold]",
            ["No new commits to cherry-pick."],
            border_style="accent",
        ))
        return 0

    if not sys.stdin.isatty():
        console.print()
        console.print(notice_panel(
            "[bold]--update-rc-branch needs a terminal for its commit picker[/bold]",
            [f"{len(candidates)} candidate commit(s) found, but stdin is not interactive.",
             "Run this from a terminal to choose which ones to cherry-pick."],
            border_style="error",
        ))
        return 1
    picked = _pick_commits_interactively(candidates)
    if picked is None:
        return 0

    for sha, subject in picked:
        pick_error = ""
        with step(f"Cherry-picking {sha} {subject}") as s:
            result = _git("cherry-pick", sha)
            if result.returncode != 0:
                pick_error = _proc_output(result)
                _git("cherry-pick", "--abort")
                s.fail()
        if pick_error:
            return _fail_panel(
                f"⛔ Cherry-pick of {sha} hit a conflict — it was rolled back",
                [
                    f"[muted]{subject}[/muted]",
                    "",
                    "Commits picked before this one are applied locally but NOT pushed.",
                    f"[bold]Fix →[/bold]  resolve it manually: [info]git cherry-pick {sha}[/info], "
                    "fix the conflicts, then",
                    f"[info]git cherry-pick --continue[/info] and [info]git push origin {branch}[/info].",
                    "", pick_error,
                ],
            )

    push_error = ""
    with step(f"Pushing {branch}") as s:
        result = _git("push", "origin", branch)
        if result.returncode != 0:
            push_error = _proc_output(result)
            s.fail()
    if push_error:
        return _fail_panel(f"⛔ Couldn't push '{branch}'", ["", push_error])

    pr = _gh("pr", "view", branch, "--json", "url", "--jq", ".url")
    pr_url = pr.stdout.strip() if pr.returncode == 0 else ""
    console.print(notice_panel(
        f"[bold]✅ {branch} updated — {len(picked)} commit(s) cherry-picked[/bold]",
        [f"[muted]·[/muted] {sha} {subject}" for sha, subject in picked]
        + ([""] if pr_url else [])
        + ([f"PR: [info]{pr_url}[/info]"] if pr_url else []),
        border_style="accent",
    ))
    return 0


# --- --merge-rc-branch --------------------------------------------------------

def _failing_checks(rollup):
    """Names of failed checks from a gh statusCheckRollup list."""
    bad = {"FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}
    names = []
    for item in rollup or []:
        outcome = (item.get("conclusion") or item.get("state") or "").upper()
        if outcome in bad:
            names.append(item.get("name") or item.get("context") or "unnamed check")
    return names


def merge_rc_branch():
    """Merge the approved RC PR into main, push the vX.Y.Z tag (publishes GHCR
    images), and create the GitHub release. Returns a process exit code."""
    import json

    code = _guard_clean_worktree("--merge-rc-branch")
    if code is not None:
        return code
    code = _preflight_gh()
    if code is not None:
        return code
    code = _fetch_origin()
    if code is not None:
        return code

    version, branch = _current_rc_branch()
    if branch is None:
        return _fail_panel(
            "⛔ No rc-v* branch found on origin",
            ["Cut one first with [info]python run.py --make-rc-branch[/info]."],
        )
    if _tag_on_origin(version):
        return _fail_panel(
            f"⛔ Tag '{version}' already exists on origin — {version} looks released already",
            ["If the release itself is missing, create it from the tag: "
             f"[info]gh release create {version} --verify-tag[/info]"],
        )

    view = _gh("pr", "view", branch, "--json",
               "number,url,state,reviewDecision,statusCheckRollup")
    if view.returncode != 0:
        return _fail_panel(
            f"⛔ No open PR found for '{branch}'",
            ["Open it with [info]python run.py --make-rc-branch[/info] "
             "(or [info]gh pr create --base main[/info]).", "", _proc_output(view)],
        )
    try:
        pr = json.loads(view.stdout)
    except ValueError:
        return _fail_panel("⛔ Couldn't read the PR state from gh", ["", _proc_output(view)])

    if pr.get("state") != "OPEN":
        return _fail_panel(
            f"⛔ The PR for '{branch}' is {pr.get('state', 'gone').lower()}, not open",
            [f"PR: [info]{pr.get('url', '')}[/info]"],
        )
    if pr.get("reviewDecision") != "APPROVED":
        return _fail_panel(
            f"⛔ The PR for '{branch}' isn't approved yet",
            ["Merging to main needs at least two approvals (CONTRIBUTING → Release Process).",
             f"Request reviews on [info]{pr.get('url', '')}[/info], then re-run."],
        )
    failing = _failing_checks(pr.get("statusCheckRollup"))
    if failing:
        return _fail_panel(
            f"⛔ The PR for '{branch}' has failing checks",
            [f"[muted]·[/muted] {name}" for name in failing]
            + ["", f"Fix them on [info]{pr.get('url', '')}[/info], then re-run."],
        )

    console.print(notice_panel(
        f"[bold]Ready to ship {version}[/bold]",
        [
            f"PR [info]#{pr['number']}[/info] ({pr.get('url', '')}) → squash-merge into main as "
            f"[info]Rc {version}[/info],",
            f"then tag [info]{version}[/info] (builds + publishes the GHCR images) "
            "and create the GitHub release.",
        ],
        border_style="accent",
    ))
    try:
        if not confirm(f"Merge Rc {version} into main, tag, and publish the release?", default=False):
            console.print("\n[info]🛑 Aborted — nothing was merged.[/info]")
            return 0
    except (KeyboardInterrupt, EOFError):
        console.print("\n[info]🛑 Aborted — nothing was merged.[/info]")
        return 0

    merge_error = ""
    with step(f"Squash-merging PR #{pr['number']} into main") as s:
        result = _gh("pr", "merge", str(pr["number"]), "--squash", "--subject", f"Rc {version}")
        if result.returncode != 0:
            merge_error = _proc_output(result)
            s.fail()
    if merge_error:
        return _fail_panel(
            "⛔ The merge was rejected",
            ["[muted]Branch protection may require something gh can't see "
             "(e.g. up-to-date branch, merge queue).[/muted]", "", merge_error],
        )

    with step("Fetching the merge commit from main"):
        _git("fetch", "origin", "main")
    merge_sha = _git("rev-parse", "origin/main").stdout.strip()
    tip_subject = _git("log", "-1", "--format=%s", "origin/main").stdout.strip()
    if f"Rc {version}" not in tip_subject:
        return _fail_panel(
            "⛔ main's tip isn't the RC merge — not tagging",
            [f"Expected the tip of main to be 'Rc {version} (#N)' but found:",
             f"[muted]{tip_subject}[/muted]", "",
             "Something else landed on main in between. Tag the RC merge commit manually:",
             f"[info]git tag {version} <merge-sha> && git push origin {version}[/info]"],
        )

    tag_error = ""
    with step(f"Tagging {version} and pushing (this publishes the GHCR images)") as s:
        result = _git("tag", version, merge_sha)
        if result.returncode == 0:
            result = _git("push", "origin", version)
        if result.returncode != 0:
            tag_error = _proc_output(result)
            s.fail()
    if tag_error:
        return _fail_panel(
            f"⛔ Couldn't tag/push '{version}' (the PR IS merged)",
            ["Finish manually:",
             f"[info]git tag {version} {merge_sha} && git push origin {version}[/info]",
             f"[info]gh release create {version} --verify-tag --title 'TT Studio {version}'[/info]",
             "", tag_error],
        )

    notes = _gh("api", "repos/{owner}/{repo}/releases/generate-notes",
                "-f", f"tag_name={version}", "-f", "target_commitish=main",
                "--jq", ".body")
    generated = notes.stdout if notes.returncode == 0 else ""

    release_url, release_error = "", ""
    with step(f"Creating the GitHub release for {version}") as s:
        result = _gh("release", "create", version, "--verify-tag",
                     "--title", f"TT Studio {version}", "--notes-file", "-",
                     stdin_text=render_release_body(version, generated))
        if result.returncode != 0:
            release_error = _proc_output(result)
            s.fail()
        else:
            release_url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    if release_error:
        return _fail_panel(
            f"⛔ Tag '{version}' is pushed, but the release couldn't be created",
            ["Create it manually: "
             f"[info]gh release create {version} --verify-tag --title 'TT Studio {version}'[/info]",
             "", release_error],
        )

    console.print(notice_panel(
        f"[bold]✅ TT Studio {version} is shipped[/bold]",
        [
            f"Release: [info]{release_url}[/info]",
            f"Images:  [info]{_ACTIONS_URL}[/info] [muted](watch the Publish images run; "
            "the release event queues a second, identical run — that's expected)[/muted]",
            "",
            "[bold]Next →[/bold]  polish the release notes "
            "[muted](draft-release-notes skill, then[/muted] [info]gh release edit[/info][muted]).[/muted]",
        ],
        border_style="accent",
    ))
    return 0
