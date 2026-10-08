# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Fetch tt-cli's model support spec, the source the model catalog is synced from."""

import json
import os
import time
import urllib.request
from datetime import datetime

from dotenv import dotenv_values

from tt_setup.console import console, show_detail
from tt_setup.constants import ENV_FILE_DEFAULT, TT_STUDIO_ROOT
from tt_setup.env_config import get_env_var

_SHARED_CONFIG = os.path.join(TT_STUDIO_ROOT, "app", "backend", "shared_config")
# Gitignored; the catalog sync script reads it from the same path.
MODEL_SUPPORT_CACHE = os.path.join(_SHARED_CONFIG, "model_support.json")
CATALOG_PATH = os.path.join(_SHARED_CONFIG, "models_from_inference_server.json")

# Where this run's model list came from: "live" (fetched now), "cached" (the
# last fetched spec) or "bundled" (the catalog committed in the repo).
LIST_SOURCE = "bundled"


def model_support_url():
    """TT_MODEL_SUPPORT_URL from the environment or .env, else .env.default's value.

    .env.default is the one place the default is defined; .env files created
    before the variable existed don't carry it.
    """
    return (
        get_env_var("TT_MODEL_SUPPORT_URL")
        or dotenv_values(ENV_FILE_DEFAULT).get("TT_MODEL_SUPPORT_URL")
        or ""
    )


def _is_valid(spec):
    return (
        isinstance(spec, dict)
        and isinstance(spec.get("models"), list)
        and bool(spec.get("release_version"))
    )


def _read(url, timeout):
    if "://" not in url:
        with open(url, "rb") as f:
            return f.read()
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def describe_list_source():
    """One line saying where the model list came from, for the detail output."""
    if LIST_SOURCE == "live":
        return "Model list: live from the model support spec"
    if LIST_SOURCE == "cached":
        try:
            fetched = os.path.getmtime(MODEL_SUPPORT_CACHE)
        except OSError:
            return "Model list: cached copy of the model support spec"
        when = datetime.fromtimestamp(fetched).strftime("%Y-%m-%d")
        days = int((time.time() - fetched) // 86400)
        return f"Model list: cached copy of the model support spec (last fetched {when}, {days}d ago)"
    return "Model list: bundled catalog (model support spec unavailable)"


def fetch_model_support(timeout=10):
    """The upstream spec's bytes, or None when it is unset, unreachable or invalid.

    Nothing is cached here: save_model_support() does that once the matching
    inference server artifact is installed.
    """
    global LIST_SOURCE
    LIST_SOURCE = "cached" if load_model_support() else "bundled"
    url = model_support_url()
    if not url:
        console.print(
            "[warning]⚠️  TT_MODEL_SUPPORT_URL is unset; keeping the existing model catalog[/warning]"
        )
        return None
    try:
        body = _read(url, timeout)
        spec = json.loads(body)
    except (OSError, ValueError) as e:
        if load_model_support():
            if show_detail():
                console.print(
                    f"[muted]Couldn't fetch the model support spec ({e}); using the cached copy[/muted]"
                )
        else:
            console.print(
                f"[warning]⚠️  Couldn't fetch the model support spec from {url} ({e}); keeping the existing model catalog[/warning]"
            )
        return None
    if not _is_valid(spec):
        console.print(
            f"[warning]⚠️  {url} is not a model support spec (missing models/release_version); ignoring it[/warning]"
        )
        return None
    return body


def save_model_support(body):
    """Cache a fetched spec. Returns True when the cached copy changed."""
    global LIST_SOURCE
    LIST_SOURCE = "live"
    try:
        with open(MODEL_SUPPORT_CACHE, "rb") as f:
            if f.read() == body:
                os.utime(MODEL_SUPPORT_CACHE)  # mtime = last successful fetch
                return False
    except OSError:
        pass
    tmp_path = f"{MODEL_SUPPORT_CACHE}.tmp"
    with open(tmp_path, "wb") as f:
        f.write(body)
    os.replace(tmp_path, MODEL_SUPPORT_CACHE)
    return True


def load_model_support():
    """The cached spec, or None if it is missing or unreadable."""
    try:
        with open(MODEL_SUPPORT_CACHE) as f:
            spec = json.load(f)
    except (OSError, ValueError):
        return None
    return spec if _is_valid(spec) else None


def default_artifact_version(body=None):
    """The tt-inference-server release tag a spec was validated against.

    Uses `body` (a fetched spec), else the cached spec, else the release the
    committed catalog was synced from; None when there is none.
    """
    spec = json.loads(body) if body else load_model_support()
    release = spec["release_version"] if spec else None
    if not release:
        try:
            with open(CATALOG_PATH) as f:
                source = json.load(f).get("source") or {}
        except (OSError, ValueError, AttributeError):
            source = {}
        release = source.get("model_support_release")
    return f"v{str(release).lstrip('v')}" if release else None
