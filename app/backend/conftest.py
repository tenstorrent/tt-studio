# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Pytest bootstrap for the backend suite — plain pytest, no pytest-django.

Order matters here: shared_config/backend_config.py and api/settings.py
hard-require TT_STUDIO_ROOT / *_PERSISTENT_STORAGE_VOLUME /
BACKEND_API_HOSTNAME at import time (fail-fast by design), backend_config
mkdirs the backend volume on import, and get_jwt_secret() auto-generates *and
persists* user_config.env when JWT_SECRET is unset — so everything is pointed
at a throwaway temp dir before Django loads.

A reachable ChromaDB is required: vector_db_control.apps.ready() connects to
it during django.setup(). CI runs a chromadb/chroma:0.5.3 service container;
locally the dev stack's chroma (localhost:8111) works, or a throwaway one:
`docker run --rm -p 8111:8000 chromadb/chroma:0.5.3`.
"""

import os
import tempfile
from pathlib import Path

_scratch = Path(tempfile.mkdtemp(prefix="tt_studio_test_"))
os.environ.setdefault("TT_STUDIO_ROOT", str(_scratch / "tt_studio_root"))
os.environ.setdefault("HOST_PERSISTENT_STORAGE_VOLUME", str(_scratch / "volume"))
os.environ.setdefault("INTERNAL_PERSISTENT_STORAGE_VOLUME", str(_scratch / "volume"))
os.environ.setdefault("BACKEND_API_HOSTNAME", "localhost")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("DJANGO_SECRET_KEY", "django-insecure-test")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
# The settings default (tt_studio_chromadb) only resolves inside the compose
# network; outside a container the chroma port is published on localhost.
os.environ.setdefault("CHROMA_DB_HOST", "localhost")
os.environ.setdefault("CHROMA_DB_PORT", "8111")
# DockerControlClient's constructor fails fast without these; tests that use
# it mock the actual HTTP traffic, so dummy values are fine.
os.environ.setdefault("DOCKER_CONTROL_SERVICE_URL", "http://localhost:8002")
os.environ.setdefault("DOCKER_CONTROL_JWT_SECRET", "test-docker-control-secret")

import django  # noqa: E402  (env vars above must be set before Django loads)

django.setup()

# What Django's own test runner (and pytest-django) do before tests run:
# adds "testserver" to ALLOWED_HOSTS so the django/DRF test clients work,
# switches to the locmem email backend, etc.
from django.test.utils import setup_test_environment  # noqa: E402

setup_test_environment()

# Live-stack tests need deployed models and/or Tenstorrent hardware, and
# model_control/test_model_utils.py deploys a container at *import* time —
# marker deselection is not enough because pytest imports every collected
# module. Keep them out of collection entirely unless explicitly requested;
# they run via deploy-healthcheck.yml on self-hosted hardware runners.
if not os.environ.get("TT_STUDIO_LIVE_TESTS"):
    collect_ignore = [
        "docker_control/test_docker_utils.py",
        "docker_control/test_docker_control_api.py",
        "model_control/test_model_api.py",
        "model_control/test_model_utils.py",
        "model_control/test_e2e.py",
    ]
