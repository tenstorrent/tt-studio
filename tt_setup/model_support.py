# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Fetch tt-cli's published model lists.

model_support.json is the source the model catalog is synced from;
community_catalog.json lists the community bundles verified to deploy.
"""

import json
import os
import urllib.request

from dotenv import dotenv_values

from tt_setup.console import console, show_detail
from tt_setup.constants import ENV_FILE_DEFAULT, TT_STUDIO_ROOT
from tt_setup.env_config import get_env_var

_SHARED_CONFIG = os.path.join(TT_STUDIO_ROOT, "app", "backend", "shared_config")
# Gitignored; the catalog sync script reads it from the same path.
MODEL_SUPPORT_CACHE = os.path.join(_SHARED_CONFIG, "model_support.json")
CATALOG_PATH = os.path.join(_SHARED_CONFIG, "models_from_inference_server.json")
COMMUNITY_CATALOG_CACHE = os.path.join(_SHARED_CONFIG, "community_catalog.json")
COMMUNITY_CATALOG_SCHEMA_VERSION = 1


def _env_or_default(name):
    """``name`` from the environment or .env, else .env.default's value.

    .env.default is the one place the default is defined; .env files created
    before the variable existed don't carry it.
    """
    return get_env_var(name) or dotenv_values(ENV_FILE_DEFAULT).get(name) or ""


def model_support_url():
    return _env_or_default("TT_MODEL_SUPPORT_URL")


def community_catalog_url():
    return _env_or_default("TT_COMMUNITY_CATALOG_URL")


def _is_valid(spec):
    return (
        isinstance(spec, dict)
        and isinstance(spec.get("models"), list)
        and bool(spec.get("release_version"))
    )


def _is_valid_community_catalog(doc):
    return (
        isinstance(doc, dict)
        and doc.get("schema_version") == COMMUNITY_CATALOG_SCHEMA_VERSION
        and isinstance(doc.get("bundles"), list)
    )


def _read(url, timeout):
    if "://" not in url:
        with open(url, "rb") as f:
            return f.read()
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _refresh(name, url, cache, is_valid, label, kept, timeout):
    """Download ``url`` into ``cache``. Returns True when the cached copy changed."""
    if not url:
        console.print(f"[warning]⚠️  {name} is unset; keeping the existing {kept}[/warning]")
        return False
    try:
        body = _read(url, timeout)
        doc = json.loads(body)
    except (OSError, ValueError) as e:
        if _load(cache, is_valid):
            if show_detail():
                console.print(f"[muted]Couldn't fetch the {label} ({e}); using the cached copy[/muted]")
        else:
            console.print(
                f"[warning]⚠️  Couldn't fetch the {label} from {url} ({e}); keeping the existing {kept}[/warning]"
            )
        return False
    if not is_valid(doc):
        console.print(f"[warning]⚠️  {url} is not a valid {label}; ignoring it[/warning]")
        return False

    try:
        with open(cache, "rb") as f:
            if f.read() == body:
                return False
    except OSError:
        pass
    tmp_path = f"{cache}.tmp"
    with open(tmp_path, "wb") as f:
        f.write(body)
    os.replace(tmp_path, cache)
    return True


def _load(cache, is_valid):
    try:
        with open(cache) as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return None
    return doc if is_valid(doc) else None


def refresh_model_support(timeout=10):
    """Download the spec into the cache. Returns True when the cached copy changed."""
    return _refresh(
        "TT_MODEL_SUPPORT_URL", model_support_url(), MODEL_SUPPORT_CACHE,
        _is_valid, "model support spec", "model catalog", timeout,
    )


def refresh_community_catalog(timeout=10):
    """Download tt-cli's verified community bundle list into the cache."""
    return _refresh(
        "TT_COMMUNITY_CATALOG_URL", community_catalog_url(), COMMUNITY_CATALOG_CACHE,
        _is_valid_community_catalog, "community catalog", "community model list", timeout,
    )


def load_model_support():
    """The cached spec, or None if it is missing or unreadable."""
    return _load(MODEL_SUPPORT_CACHE, _is_valid)


def default_artifact_version():
    """The tt-inference-server release tag the spec was validated against.

    Falls back to the release the committed catalog was synced from, else None.
    """
    spec = load_model_support()
    release = spec["release_version"] if spec else None
    if not release:
        try:
            with open(CATALOG_PATH) as f:
                source = json.load(f).get("source") or {}
        except (OSError, ValueError, AttributeError):
            source = {}
        release = source.get("model_support_release")
    return f"v{str(release).lstrip('v')}" if release else None
