# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Sanity-check the built `tt-studio` wheel before it is published.

Run from the repo root after `python -m build` (needs hatchling importable, for
hatch_build's file list):

    python dev-tools/check_pypi_dist.py dist/

Checks:
  * the wheel's bundled app tree is exactly the git-tracked files hatch_build.py
    is meant to ship (nothing dropped by ignore rules, nothing extra);
  * on a tag build (GITHUB_REF=refs/tags/vX.Y.Z), the wheel version equals the
    tag, and the tag is either a final release (-> PyPI) or a pre-release
    (-> TestPyPI).

Prints `version=` and `channel=` (pypi | testpypi | none), and appends them to
$GITHUB_OUTPUT when set so the publish jobs can read them.
"""

import glob
import os
import re
import subprocess
import sys
import zipfile

sys.path.insert(0, os.getcwd())
from hatch_build import BUNDLE_PATHS, WHEEL_BUNDLE_PREFIX  # noqa: E402

# Release tags: v2.12.0, or v2.12.0-rc1 for a pre-release (built as 2.12.0rc1).
# Only the hyphenated spelling: images are pushed under the tag name, and the
# launcher (install_mode.release_tag) maps 2.12.0rc1 back to v2.12.0-rc1.
_TAG_RE = re.compile(r"^v(\d+\.\d+\.\d+)(?:-(a|b|rc)(\d+))?$")


def tag_version(tag):
    """(PEP 440 version, is_prerelease) for a release tag, or None."""
    match = _TAG_RE.match(tag)
    if not match:
        return None
    base, pre, num = match.groups()
    return (f"{base}{pre}{num}" if pre else base), bool(pre)


def wheel_version(wheel_path):
    # tt_studio-<version>-py3-none-any.whl
    return os.path.basename(wheel_path).split("-")[1]


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def main(dist_dir):
    wheels = glob.glob(os.path.join(dist_dir, "tt_studio-*.whl"))
    if len(wheels) != 1:
        fail(f"expected exactly one tt_studio wheel in {dist_dir}, found {wheels}")
    wheel = wheels[0]
    version = wheel_version(wheel)

    prefix = WHEEL_BUNDLE_PREFIX + "/"
    with zipfile.ZipFile(wheel) as zf:
        bundled = {n[len(prefix) :] for n in zf.namelist() if n.startswith(prefix)}
    tracked = set(
        subprocess.run(
            ["git", "ls-files", "--", *BUNDLE_PATHS],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split("\n")
    ) - {""}
    if bundled != tracked:
        missing = sorted(tracked - bundled)[:20]
        extra = sorted(bundled - tracked)[:20]
        fail(f"wheel bundle differs from git ls-files: missing={missing} extra={extra}")
    print(f"bundle: {len(bundled)} files match git ls-files", file=sys.stderr)

    channel = "none"
    ref = os.environ.get("GITHUB_REF", "")
    if ref.startswith("refs/tags/"):
        tag = ref[len("refs/tags/") :]
        parsed = tag_version(tag)
        if parsed is None:
            fail(
                f"tag {tag} is not a release tag (vX.Y.Z or vX.Y.Z-rcN); not publishing"
            )
        expected, prerelease = parsed
        if version != expected:
            fail(
                f"wheel version {version} does not match tag {tag} (expected {expected})"
            )
        channel = "testpypi" if prerelease else "pypi"
    elif os.environ.get("PUBLISH_TARGET") == "testpypi":
        if "+" in version:
            fail(f"{version} has a local segment; TestPyPI would reject it")
        channel = "testpypi"

    outputs = f"version={version}\nchannel={channel}\n"
    print(outputs, end="")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(outputs)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dist")
