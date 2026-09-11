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


def frontend_config_drift(get_env):
    """Which frontend settings differ from what CI bakes into the published image.

    The prod frontend inlines its VITE_* settings at build time, so a pulled
    image is only correct for the stock configuration. Returns the names of the
    offending vars (empty == stock) so the launcher can say *which* setting is
    costing the user a local build, not merely that one is. Must stay in sync
    with the frontend build-args in .github/workflows/publish-images.yml.
    """
    truthy = ("true", "1", "t", "y", "yes")
    drift = []
    if str(get_env("VITE_ENABLE_DEPLOYED", "")).lower().strip() in truthy:
        drift.append("VITE_ENABLE_DEPLOYED")
    if get_env("VITE_APP_TITLE", "") not in ("", "TT Studio", '"TT Studio"'):
        drift.append("VITE_APP_TITLE")
    if str(get_env("VITE_ENABLE_RAG_ADMIN", "")).lower().strip() in truthy:
        drift.append("VITE_ENABLE_RAG_ADMIN")
    return drift


def frontend_config_is_stock(get_env):
    """Whether the frontend config matches the published image (see drift)."""
    return not frontend_config_drift(get_env)


BUILD_REASON_FRONTEND = "custom frontend settings are baked in at build time"


def decide_image_source(build_images, worktree_dirty, dev_mode, frontend_stock):
    """Return ("pull"|"build", reason). Pure so the matrix is unit-testable."""
    if build_images:
        return "build", "--build-images was passed"
    if worktree_dirty:
        return "build", "app/ has local changes"
    if not dev_mode and not frontend_stock:
        return "build", BUILD_REASON_FRONTEND
    return "pull", ""


def required_image_refs(dev_mode, registry, tag, include_docker_control=True):
    """The TT-Studio images the selected compose overlay will run."""
    names = ["backend", "agent", "frontend-dev" if dev_mode else "frontend"]
    if include_docker_control:
        names.append("docker-control")
    return [f"{registry}/{name}:{tag}" for name in names]


def describe_pull_fallback(kind, tag, cached):
    """Explain a skipped image pull in one calm sentence: why, and what happens
    instead. `kind` comes from docker_diag.classify_pull_failure. Returns
    (message, hint) where hint is None unless there's something to act on.

    Pulling is an optimization, never a requirement — so this reads as a note,
    not an error: falling back to the local images or to a build is a normal,
    complete outcome.
    """
    next_step = "using local images" if cached else "building locally"
    reasons = {
        "unpublished": f"Prebuilt images for {tag} aren't published",
        "auth": "ghcr.io needs a login for these images",
        "unreachable": "Couldn't reach ghcr.io",
        "unknown": f"Couldn't pull the prebuilt images ({tag})",
    }
    reason = reasons.get(kind, reasons["unknown"])
    hint = "run: docker login ghcr.io" if kind == "auth" else None
    return f"{reason} — {next_step}", hint


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
