#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"""TT-Studio license-attribution compliance check.

Deterministic gate intended to run on every pull request (and locally before
pushing). It complements the SPDX-header checks (backend-license-checker.yml /
frontend-lint-license-checker.yml) by verifying that *third-party attribution*
is kept up to date when dependencies change.

Two checks:

  --check-frontend   Ensure app/frontend/third-party-licenses.txt is in sync
                     with the current production dependency tree. Regenerates
                     it with the pinned generate-license-file@4.0.0 into a temp
                     file and diffs. (4.1.0 silently drops react/react-dom, so
                     the version is pinned both here and in package.json.)
                     Requires node/npm on PATH; skips with a warning if absent.

  --check-new-deps   Detect top-level dependencies ADDED in this PR (vs --base)
                     across the backend requirements files and the frontend
                     package.json "dependencies", and require each to be
                     attributed: present in the root LICENSE "Third-Party
                     Dependencies" list, present in third-party-licenses.txt
                     (frontend), or acknowledged in the allowlist.

With no flags, both checks run. Exit code is non-zero if any check fails.

The companion `/license-attribution-compliance` Claude skill performs the
judgment-heavy review (license classification, NonCommercial/copyleft flags,
bundled-binary provenance) that a deterministic script cannot.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# --- Paths (relative to repo root) -----------------------------------------

REQUIREMENTS_FILES = [
    "app/backend/requirements.txt",
    "app/agent/requirements.txt",
    "inference-api/requirements.txt",
    "docker-control-service/requirements-api.txt",
]
PACKAGE_JSON = "app/frontend/package.json"
FRONTEND_DIR = "app/frontend"
THIRD_PARTY_LICENSES = "app/frontend/third-party-licenses.txt"
ROOT_LICENSE = "LICENSE"
ALLOWLIST = "dev-tools/license_attribution_allowlist.txt"

# generate-license-file >= 4.1.0 has a regression that drops react/react-dom
# from the output. Pin the regenerator here so the freshness check is stable.
GENERATE_LICENSE_FILE_VERSION = "4.0.0"


# --- Helpers ----------------------------------------------------------------


def repo_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return Path(out.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path(__file__).resolve().parent.parent


def normalize(name: str) -> str:
    """Normalize a package name for comparison (pip: case- and _/- insensitive)."""
    return name.strip().lower().replace("_", "-")


def parse_requirements(text: str) -> set[str]:
    """Top-level package names from a requirements.txt body."""
    names: set[str] = set()
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        line = line.split(";", 1)[0].strip()  # drop env markers
        m = re.match(r"^([A-Za-z0-9_.\-]+)", line)
        if m:
            names.add(normalize(m.group(1)))
    return names


def parse_package_deps(text: str) -> set[str]:
    """Production dependency names from a package.json body (not devDependencies)."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return set()
    return {k.strip() for k in data.get("dependencies", {})}


def git_show(root: Path, ref: str, path: str) -> str | None:
    """Contents of `path` at `ref`, or None if it did not exist there."""
    out = subprocess.run(
        ["git", "-C", str(root), "show", f"{ref}:{path}"],
        capture_output=True, text=True,
    )
    return out.stdout if out.returncode == 0 else None


def resolve_base_ref(root: Path, requested: str | None) -> str | None:
    candidates = []
    if requested:
        candidates.append(requested)
    env_base = os.environ.get("GITHUB_BASE_REF")
    if env_base:
        candidates += [f"origin/{env_base}", env_base]
    candidates += ["origin/main", "origin/dev", "main"]
    for ref in candidates:
        ok = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--verify", "--quiet", ref],
            capture_output=True, text=True,
        )
        if ok.returncode == 0:
            return ref
    return None


def license_attribution_blob(root: Path) -> str:
    """Lowercased text of the LICENSE 'Third-Party Dependencies' section."""
    text = (root / ROOT_LICENSE).read_text(encoding="utf-8", errors="ignore")
    idx = text.find("Third-Party Dependencies")
    section = text[idx:] if idx != -1 else text
    return section.lower()


def load_allowlist(root: Path) -> set[str]:
    path = root / ALLOWLIST
    if not path.exists():
        return set()
    names: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            names.add(normalize(line))
    return names


# --- Check: frontend license file freshness ---------------------------------


def check_frontend(root: Path) -> bool:
    import shutil

    print("== Frontend third-party-licenses.txt freshness ==")
    committed = root / THIRD_PARTY_LICENSES
    if not committed.exists():
        print(f"  FAIL: {THIRD_PARTY_LICENSES} is missing.")
        return False

    npx = shutil.which("npx")
    if not npx:
        print("  SKIP: node/npx not on PATH; cannot regenerate to compare.")
        print("        (CI runners with node will enforce this check.)")
        return True

    with tempfile.NamedTemporaryFile("w+", suffix=".txt", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        proc = subprocess.run(
            [npx, "--yes", f"generate-license-file@{GENERATE_LICENSE_FILE_VERSION}",
             "--input", "package.json", "--output", tmp_path,
             "--overwrite", "--no-spinner"],
            cwd=str(root / FRONTEND_DIR), capture_output=True, text=True,
        )
        if proc.returncode != 0:
            print("  FAIL: could not regenerate license file:")
            print("   ", proc.stderr.strip()[:500])
            return False
        fresh = Path(tmp_path).read_text(encoding="utf-8")
        if fresh != committed.read_text(encoding="utf-8"):
            print(f"  FAIL: {THIRD_PARTY_LICENSES} is out of date.")
            print("        Regenerate it:  cd app/frontend && npm run generate-license")
            return False
        print("  OK: license file matches the current dependency tree.")
        return True
    finally:
        os.unlink(tmp_path)


# --- Check: newly added dependencies are attributed -------------------------


def check_new_deps(root: Path, base: str | None) -> bool:
    print("== Newly added dependencies are attributed ==")
    base_ref = resolve_base_ref(root, base)
    if not base_ref:
        print("  SKIP: could not resolve a base ref to diff against "
              "(pass --base <ref> or set GITHUB_BASE_REF).")
        # In CI this is intended to be a gate; treat inability to diff as failure.
        if os.environ.get("GITHUB_ACTIONS") == "true":
            return False
        return True

    license_blob = license_attribution_blob(root)
    tpl_blob = (root / THIRD_PARTY_LICENSES).read_text(
        encoding="utf-8", errors="ignore").lower() \
        if (root / THIRD_PARTY_LICENSES).exists() else ""
    allowlist = load_allowlist(root)

    def is_attributed(name: str) -> bool:
        n = normalize(name)
        raw = name.lower()
        return (n in allowlist
                or n in license_blob or raw in license_blob
                or n in tpl_blob or raw in tpl_blob)

    violations: list[tuple[str, str]] = []  # (dep, source file)

    sources = [(f, parse_requirements) for f in REQUIREMENTS_FILES]
    sources.append((PACKAGE_JSON, parse_package_deps))

    for rel, parser in sources:
        cur_path = root / rel
        current = parser(cur_path.read_text(encoding="utf-8")) if cur_path.exists() else set()
        old_text = git_show(root, base_ref, rel)
        previous = parser(old_text) if old_text is not None else set()
        for dep in sorted(current - previous):
            if not is_attributed(dep):
                violations.append((dep, rel))

    if not violations:
        print("  OK: no unattributed new dependencies.")
        return True

    print(f"  FAIL: {len(violations)} newly added dependency(ies) lack attribution:\n")
    for dep, rel in violations:
        print(f"    - {dep}   (added in {rel})")
    print(
        "\n  For each, do ONE of:\n"
        f"    1. Add an entry to the 'Third-Party Dependencies' list in {ROOT_LICENSE}\n"
        "       (frontend deps are also covered by regenerating "
        "third-party-licenses.txt).\n"
        f"    2. If runtime-only / not distributed, add it to {ALLOWLIST}.\n"
        "  Run the /license-attribution-compliance skill for help classifying the\n"
        "  license (watch for NonCommercial / copyleft) and choosing the destination."
    )
    return False


# --- Entry point ------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-frontend", action="store_true",
                    help="only run the frontend license-file freshness check")
    ap.add_argument("--check-new-deps", action="store_true",
                    help="only run the new-dependency attribution check")
    ap.add_argument("--base", default=None,
                    help="git ref to diff against for new deps (default: auto-detect)")
    args = ap.parse_args()

    root = repo_root()
    run_all = not (args.check_frontend or args.check_new_deps)

    ok = True
    if run_all or args.check_frontend:
        ok &= check_frontend(root)
        print()
    if run_all or args.check_new_deps:
        ok &= check_new_deps(root, args.base)
        print()

    if ok:
        print("license-attribution: PASS")
        return 0
    print("license-attribution: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
