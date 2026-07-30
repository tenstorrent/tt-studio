# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Decide where container images come from: pulled from the registry or built locally.

The compose files reference ``${TT_STUDIO_IMAGE_REGISTRY}/<name>:${TT_STUDIO_IMAGE_TAG}``
for the images CI publishes (.github/workflows/publish-images.yml). The launcher
prefers pulling those prebuilt images and falls back to the compose ``build:``
contexts whenever a pull cannot succeed or would produce the wrong bits
(unpublished checkout, local modifications, custom frontend config, --build-images).
"""

import subprocess

from tt_setup.constants import TT_STUDIO_ROOT

DEFAULT_IMAGE_REGISTRY = "ghcr.io/tenstorrent/tt-studio"


def compute_image_tag(exact_tag, full_sha):
    """Image tag pinned to the current checkout.

    Release tag verbatim when HEAD sits exactly on one, else ``sha-<12>`` (the
    same 12 hex chars CI derives from ``GITHUB_SHA``), else ``latest`` for
    checkouts with no usable git metadata (e.g. a source tarball).
    """
    if exact_tag:
        return exact_tag
    if full_sha:
        return f"sha-{full_sha[:12]}"
    return "latest"


def frontend_config_is_stock(get_env):
    """Whether the frontend config matches what CI bakes into the published image.

    The prod frontend inlines its VITE_* settings at build time, so a pulled
    image is only correct for the stock configuration. Must stay in sync with
    the frontend build-args in .github/workflows/publish-images.yml.
    """
    truthy = ("true", "1", "t", "y", "yes")
    if str(get_env("VITE_ENABLE_DEPLOYED", "")).lower().strip() in truthy:
        return False
    if get_env("VITE_APP_TITLE", "") not in ("", "TT Studio"):
        return False
    if str(get_env("VITE_ENABLE_RAG_ADMIN", "")).lower().strip() in truthy:
        return False
    return True


def decide_image_source(build_images, worktree_dirty, dev_mode, frontend_stock):
    """Return ("pull"|"build", reason). Pure so the matrix is unit-testable."""
    if build_images:
        return "build", "--build-images was passed"
    if worktree_dirty:
        return "build", "app/ has local changes"
    if not dev_mode and not frontend_stock:
        return "build", "custom frontend settings are baked in at build time"
    return "pull", ""


def required_image_refs(dev_mode, registry, tag):
    """The TT-Studio images the selected compose overlay will run."""
    names = ["backend", "agent", "frontend-dev" if dev_mode else "frontend"]
    return [f"{registry}/{name}:{tag}" for name in names]


def is_worktree_dirty():
    """True when app/ differs from HEAD (or git state can't be read — build is
    the safe default: never run prebuilt bits over modified sources)."""
    try:
        result = subprocess.run(
            ["git", "-C", TT_STUDIO_ROOT, "status", "--porcelain", "--", "app/"],
            capture_output=True, text=True, check=False,
        )
    except Exception:
        return True
    if result.returncode != 0:
        return True
    return bool(result.stdout.strip())


def images_present_locally(refs, use_sudo=False):
    """Whether every ref already exists in the local Docker image store."""
    from tt_setup.docker import run_docker_command

    result = run_docker_command(
        ["docker", "image", "inspect"] + list(refs),
        use_sudo=use_sudo, capture_output=True, interactive=False,
    )
    return result.returncode == 0
