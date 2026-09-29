# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""tt-studio PyPI shim.

`pip install tt-studio` ships only this module. The real launcher lives in the
tt-studio repo and is checkout-bound (compose files, .env.default, host
services are all repo-relative), so the shim maintains a managed git clone
under ~/.tt-studio/checkout, keeps it on the latest GitHub release tag, and
then execs the checkout's run.py — which self-bootstraps its own venv.

Update policy: every launch asks the GitHub releases API for the newest tag
and silently fast-forwards the managed checkout to it (one-line notice).
Offline or rate-limited → run whatever is installed; only the very first run
needs the network. `--no-update` skips the check once, `--pin vX.Y.Z` sticks
to a release until `--pin latest`. A checkout without the shim's marker file
is never mutated.

Stdlib-only on purpose: the shim must run before any venv exists.
"""

import json
import os
import shutil
import subprocess
import sys
import urllib.request

REPO_URL = "https://github.com/tenstorrent/tt-studio.git"
LATEST_RELEASE_API = "https://api.github.com/repos/tenstorrent/tt-studio/releases/latest"
MARKER_NAME = ".tt-studio-managed"
PIN_NAME = "pin"


def studio_home() -> str:
    return os.path.expanduser(os.environ.get("TT_STUDIO_HOME", "~/.tt-studio"))


def checkout_dir(home: str) -> str:
    return os.path.join(home, "checkout")


def _git(checkout: str, *argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", checkout, *argv],
        capture_output=True, text=True, check=False,
    )


def fetch_latest_release_tag(timeout: float = 8.0) -> str | None:
    """Latest release tag (e.g. 'v2.10.0') from the GitHub API, or None on any
    failure — offline, rate-limited, or malformed. Never raises."""
    try:
        req = urllib.request.Request(
            LATEST_RELEASE_API,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "tt-studio-shim"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            tag = json.loads(resp.read()).get("tag_name")
            return tag if isinstance(tag, str) and tag else None
    except Exception:
        return None


def current_checkout_state(checkout: str) -> tuple[str | None, bool]:
    """(exact release tag or None, HEAD-is-on-a-named-branch). A managed
    checkout normally sits detached at a tag; a named branch means the user
    moved it deliberately (e.g. --switch dev) and auto-update must not undo
    that."""
    tag_res = _git(checkout, "describe", "--tags", "--exact-match", "HEAD")
    tag = tag_res.stdout.strip() if tag_res.returncode == 0 else None
    branch = _git(checkout, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    return tag, branch not in ("", "HEAD")


def read_pin(home: str) -> str | None:
    try:
        with open(os.path.join(home, PIN_NAME)) as f:
            pin = f.read().strip()
            return pin or None
    except OSError:
        return None


def write_pin(home: str, tag: str | None) -> None:
    path = os.path.join(home, PIN_NAME)
    if tag is None:
        try:
            os.remove(path)
        except OSError:
            pass
        return
    os.makedirs(home, exist_ok=True)
    with open(path, "w") as f:
        f.write(tag + "\n")


def plan_action(
    checkout_exists: bool,
    is_managed: bool,
    on_branch: bool,
    current_tag: str | None,
    target_tag: str | None,
    no_update: bool,
) -> str:
    """Pure decision: 'clone', 'update', or 'run'. target_tag is the pin when
    set, else the latest release (None when GitHub was unreachable)."""
    if not checkout_exists:
        return "clone"
    if not is_managed or no_update or on_branch:
        return "run"
    if target_tag is None or current_tag == target_tag:
        return "run"
    return "update"


def split_shim_args(argv: list[str]) -> tuple[dict, list[str]]:
    """Strip shim-owned flags; everything else is forwarded to run.py verbatim
    and in order. Returns ({no_update, pin, shim_version}, passthrough)."""
    opts = {"no_update": False, "pin": None, "shim_version": False}
    passthrough: list[str] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--no-update":
            opts["no_update"] = True
        elif arg == "--shim-version":
            opts["shim_version"] = True
        elif arg == "--pin":
            if i + 1 >= len(argv):
                raise SystemExit("tt-studio: --pin requires a release tag (or 'latest')")
            opts["pin"] = argv[i + 1]
            i += 1
        elif arg.startswith("--pin="):
            opts["pin"] = arg.split("=", 1)[1]
        else:
            passthrough.append(arg)
        i += 1
    return opts, passthrough


def clone_checkout(home: str, tag: str) -> str:
    checkout = checkout_dir(home)
    os.makedirs(home, exist_ok=True)
    print(f"tt-studio: installing TT Studio {tag} into {checkout} …")
    # Full clone (branches + tags): the launcher relies on git metadata for
    # image selection, freshness checks, and --switch.
    result = subprocess.run(
        ["git", "clone", "--branch", tag, REPO_URL, checkout],
        text=True, check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"tt-studio: git clone of {REPO_URL} failed — see output above.")
    with open(os.path.join(checkout, MARKER_NAME), "w") as f:
        f.write("Managed by the tt-studio pip shim; auto-updated to release tags.\n")
    return checkout


def update_checkout(checkout: str, current_tag: str | None, tag: str) -> None:
    """Move the managed checkout to `tag`. Refuses (with a warning, but still
    runs) when the tree has local edits — same guard as run.py --switch."""
    dirty = _git(checkout, "status", "--porcelain", "--untracked-files=no")
    if dirty.returncode != 0 or dirty.stdout.strip():
        print(
            f"tt-studio: {tag} is available but {checkout} has local changes — "
            "skipping update. Stash/reset them (or use your own clone for development)."
        )
        return
    fetched = _git(checkout, "fetch", "origin", "--tags")
    if fetched.returncode != 0:
        print("tt-studio: couldn't fetch updates from GitHub — running the installed version.")
        return
    switched = _git(checkout, "checkout", f"tags/{tag}")
    if switched.returncode != 0:
        print(f"tt-studio: couldn't check out {tag} — running the installed version.")
        return
    print(f"tt-studio: updated {current_tag or 'unknown'} → {tag}")


def exec_launcher(checkout: str, argv: list[str]) -> None:
    """Hand off to the checkout's run.py. chdir first: the launcher resolves
    everything from os.getcwd()."""
    os.chdir(checkout)
    os.environ["TT_STUDIO_MANAGED"] = "1"
    os.execv(sys.executable, [sys.executable, "run.py", *argv])


def main() -> None:
    opts, passthrough = split_shim_args(sys.argv[1:])
    if opts["shim_version"]:
        from tt_studio import __version__
        print(f"tt-studio shim {__version__}")
        return

    if shutil.which("git") is None:
        raise SystemExit(
            "tt-studio: git is required but wasn't found on PATH. "
            "Install git, then re-run tt-studio."
        )

    home = studio_home()
    if opts["pin"] is not None:
        if opts["pin"] == "latest":
            write_pin(home, None)
            print("tt-studio: pin removed — will follow the latest release.")
        else:
            write_pin(home, opts["pin"])
            print(f"tt-studio: pinned to {opts['pin']}.")

    checkout = checkout_dir(home)
    checkout_exists = os.path.isdir(os.path.join(checkout, ".git"))
    is_managed = os.path.exists(os.path.join(checkout, MARKER_NAME))
    current_tag, on_branch = current_checkout_state(checkout) if checkout_exists else (None, False)

    pin = read_pin(home)
    # --no-update with an existing checkout skips the API call entirely; a
    # first run still needs a tag to clone.
    need_target = not (opts["no_update"] and checkout_exists)
    target_tag = pin if pin else (fetch_latest_release_tag() if need_target else None)

    action = plan_action(
        checkout_exists, is_managed, on_branch, current_tag, target_tag, opts["no_update"]
    )
    if action == "clone":
        if target_tag is None:
            raise SystemExit(
                "tt-studio: couldn't reach the GitHub releases API to find the latest "
                "release, and no version is installed yet. Check your network (or pass "
                "--pin vX.Y.Z) and retry."
            )
        checkout = clone_checkout(home, target_tag)
    elif action == "update":
        update_checkout(checkout, current_tag, target_tag)
    elif checkout_exists and is_managed and on_branch:
        print(
            "tt-studio: managed checkout is on a branch (moved with --switch?) — "
            "auto-update paused until it's back on a release tag."
        )

    exec_launcher(checkout, passthrough)


if __name__ == "__main__":
    main()
