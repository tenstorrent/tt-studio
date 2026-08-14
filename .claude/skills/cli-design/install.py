# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Drop the cli-design skill (and its console module) into another repo.

    python3 install.py ../other-repo              # skill + module, into that repo
    python3 install.py ../other-repo --module-dest mycli/console.py
    python3 install.py --user                     # every repo on this machine

Stdlib only, so it runs anywhere with a python3. Idempotent: existing files are
left alone unless you pass --force.
"""

import argparse
import os
import shutil
import sys

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_NAME = os.path.basename(SKILL_DIR)
MODULE_SRC = os.path.join(SKILL_DIR, "reference", "console.py")

# A module dir looks like a CLI package if it holds one of these.
CLI_MARKERS = ("__main__.py", "cli.py", "main.py", "console.py")
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", "build", "dist",
             ".tox", ".mypy_cache", ".pytest_cache", "site-packages"}

GREEN, YELLOW, DIM, BOLD, RESET = "\033[32m", "\033[33m", "\033[2m", "\033[1m", "\033[0m"


def _color(text, code):
    return text if not sys.stdout.isatty() else f"{code}{text}{RESET}"


def ok(label, detail=""):
    print(f"{_color('✓', GREEN)} {label}" + (f"  {_color(detail, DIM)}" if detail else ""))


def skip(label, detail=""):
    print(f"{_color('○', DIM)} {_color(label, DIM)}" + (f"  {_color(detail, DIM)}" if detail else ""))


def warn(label):
    print(f"{_color('!', YELLOW)} {label}")


def copy_tree(src, dest, force):
    """Copy the skill directory, skipping caches. Returns True if anything landed."""
    if os.path.exists(dest) and not force:
        skip(f"Skill already present at {dest}", "pass --force to overwrite")
        return False
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return True


def guess_cli_packages(root):
    """Directories that look like they hold the project's CLI — suggested, never
    written to without an explicit --module-dest."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        if dirpath.count(os.sep) - root.count(os.sep) > 2:
            dirnames[:] = []
            continue
        if any(marker in filenames for marker in CLI_MARKERS):
            found.append(os.path.relpath(dirpath, root))
    return found[:4]


def main():
    parser = argparse.ArgumentParser(
        description="Install the cli-design skill into another repo.")
    parser.add_argument("target", nargs="?", default=".",
                        help="repo to install into (default: current directory)")
    parser.add_argument("--user", action="store_true",
                        help="install to ~/.claude/skills instead, for every repo on this machine")
    parser.add_argument("--module-dest", metavar="PATH",
                        help="also copy reference/console.py to this path inside the target")
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    args = parser.parse_args()

    target = os.path.abspath(os.path.expanduser(args.target))
    if args.user:
        skill_dest = os.path.join(os.path.expanduser("~"), ".claude", "skills", SKILL_NAME)
        where = "~/.claude/skills (all repos)"
    else:
        if not os.path.isdir(target):
            sys.exit(f"No such directory: {target}")
        skill_dest = os.path.join(target, ".claude", "skills", SKILL_NAME)
        where = os.path.relpath(skill_dest, target)

    print(f"\n{_color('Installing the CLI design', BOLD)}  {_color('→ ' + where, DIM)}\n")

    if copy_tree(SKILL_DIR, skill_dest, args.force):
        ok("Skill installed", skill_dest)

    module_dest = None
    if args.module_dest:
        module_dest = os.path.join(target, args.module_dest)
        if os.path.exists(module_dest) and not args.force:
            skip(f"{args.module_dest} already exists", "pass --force to overwrite")
        else:
            os.makedirs(os.path.dirname(module_dest) or ".", exist_ok=True)
            shutil.copy2(MODULE_SRC, module_dest)
            ok("Module copied", args.module_dest)

    try:
        import rich  # noqa: F401
        ok("rich is available", getattr(rich, "__version__", ""))
    except ImportError:
        warn("rich is not installed here — the module needs it: pip install rich")

    # Plain string building (no nested f-string quotes) so this runs on older
    # Python 3 too — the target repo's interpreter is not ours to choose.
    rel_skill = skill_dest if args.user else os.path.relpath(skill_dest, target)
    demo_path = os.path.join(rel_skill, "reference", "demo.py")
    skeleton_path = os.path.join(rel_skill, "reference", "cli_skeleton.py")
    module_path = os.path.join(rel_skill, "reference", "console.py")
    tests_path = os.path.join(rel_skill, "reference", "test_cli_output.py")

    print("\n" + _color("Next", BOLD))
    print("  1. See the output run:  " + _color("python3 " + demo_path, DIM))
    print("     See the CLI shape:   " + _color("python3 " + skeleton_path + " --help", DIM))
    if module_dest:
        dotted = args.module_dest[:-3].replace(os.sep, ".")
        print("  2. Import it:           "
              + _color("from " + dotted + " import phase, step, note", DIM))
    else:
        candidates = [] if args.user else guess_cli_packages(target)
        suggestion = os.path.join(candidates[0], "console.py") if candidates else "yourcli/console.py"
        print("  2. Put the module in your CLI package:")
        print("     " + _color("cp " + module_path + " " + suggestion, DIM))
        if len(candidates) > 1:
            print("     " + _color("other candidates: " + ", ".join(candidates[1:]), DIM))
    print("  3. Copy the tests:      " + _color("cp " + tests_path + " tests/", DIM))
    print("  4. Ask Claude:          "
          + _color('"use the cli-design skill on my CLI"', DIM))
    print("\n" + _color("console.py is Apache-2.0 — keep its SPDX header when you copy it.", DIM) + "\n")


if __name__ == "__main__":
    main()
