# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Fetch tt-cli's published model lists.

model_support.json is the source the model catalog is synced from;
community_catalog.json lists the community bundles verified to deploy.
"""

import json
import os
import subprocess
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
COMMUNITY_CATALOG_CACHE = os.path.join(_SHARED_CONFIG, "community_catalog.json")
COMMUNITY_CATALOG_BUNDLED = os.path.join(_SHARED_CONFIG, "community_catalog_bundled.json")
COMMUNITY_CATALOG_ENRICHED = os.path.join(_SHARED_CONFIG, "community_catalog_enriched.json")
COMMUNITY_CATALOG_SCHEMA_VERSION = 1

# Where this run's lists came from, by cache path: "live" (fetched now), "cached" (the
# last fetched spec) or "bundled" (the catalog committed in the repo).
LIST_SOURCE = {}


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


def describe_list_source(cache=MODEL_SUPPORT_CACHE, label="Model list", spec="model support spec", fallback="bundled catalog"):
    """One line saying where a list came from, for the detail output."""
    source = LIST_SOURCE.get(cache, "bundled")
    if source == "live":
        return f"{label}: live from the {spec}"
    if source == "cached":
        try:
            fetched = os.path.getmtime(cache)
        except OSError:
            return f"{label}: cached copy of the {spec}"
        when = datetime.fromtimestamp(fetched).strftime("%Y-%m-%d")
        days = int((time.time() - fetched) // 86400)
        return f"{label}: cached copy of the {spec} (last fetched {when}, {days}d ago)"
    return f"{label}: {fallback} ({spec} unavailable)"


def describe_community_source():
    return describe_list_source(
        COMMUNITY_CATALOG_CACHE, "Community list", "community catalog", "bundled community catalog"
    )


def _fetch(name, url, cache, is_valid, label, kept, timeout):
    """The bytes at ``url``, or None when it is unset, unreachable or invalid."""
    LIST_SOURCE[cache] = "cached" if _load(cache, is_valid) else "bundled"
    if not url:
        console.print(f"[warning]⚠️  {name} is unset; keeping the existing {kept}[/warning]")
        return None
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
        return None
    if not is_valid(doc):
        console.print(f"[warning]⚠️  {url} is not a valid {label}; ignoring it[/warning]")
        return None
    return body


def _save(cache, body):
    """Cache fetched bytes. Returns True when the cached copy changed."""
    LIST_SOURCE[cache] = "live"
    try:
        with open(cache, "rb") as f:
            if f.read() == body:
                os.utime(cache)  # mtime = last successful fetch
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


def fetch_model_support(timeout=10):
    """The upstream spec's bytes, or None when it is unset, unreachable or invalid.

    Nothing is cached here: save_model_support() does that once the matching
    inference server artifact is installed.
    """
    return _fetch(
        "TT_MODEL_SUPPORT_URL", model_support_url(), MODEL_SUPPORT_CACHE,
        _is_valid, "model support spec", "model catalog", timeout,
    )


def save_model_support(body):
    """Cache a fetched spec. Returns True when the cached copy changed."""
    return _save(MODEL_SUPPORT_CACHE, body)


def refresh_community_catalog(timeout=10):
    """Download tt-cli's verified community bundle list into the cache."""
    body = _fetch(
        "TT_COMMUNITY_CATALOG_URL", community_catalog_url(), COMMUNITY_CATALOG_CACHE,
        _is_valid_community_catalog, "community catalog", "community model list", timeout,
    )
    return bool(body) and _save(COMMUNITY_CATALOG_CACHE, body)


def enrich_community_catalog(timeout=300):
    """Write the community catalog with each bundle's manifest. Returns True on success.

    Runs the tt-model-manager runner, so it needs the artifact installed. Failure is
    non-fatal: inference-api falls back to the bundled catalog.
    """
    from tt_setup.model_manager import model_manager_python

    python = model_manager_python()
    if not os.path.exists(python):
        return False
    if _load(COMMUNITY_CATALOG_CACHE, _is_valid_community_catalog):
        catalog = COMMUNITY_CATALOG_CACHE
    else:
        catalog = COMMUNITY_CATALOG_BUNDLED
    runner = os.path.join(TT_STUDIO_ROOT, "inference-api", "tt_model_runner.py")
    env = os.environ.copy()
    token = get_env_var("HF_TOKEN")
    if token:
        env["HF_TOKEN"] = token
    cmd = [
        python, runner, "enrich", "--catalog", catalog,
        "--out", COMMUNITY_CATALOG_ENRICHED, "--previous", COMMUNITY_CATALOG_BUNDLED,
    ]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        failure = None if done.returncode == 0 else ((done.stderr or "").strip().splitlines() or ["no output"])[-1]
    except (OSError, subprocess.TimeoutExpired) as e:
        failure = str(e)
    if failure:
        console.print(f"[warning]⚠️  Couldn't read the community bundle manifests ({failure}); using the bundled catalog[/warning]")
    return failure is None


def load_model_support():
    """The cached spec, or None if it is missing or unreadable."""
    return _load(MODEL_SUPPORT_CACHE, _is_valid)


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
