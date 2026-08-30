# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for per-deploy secret resolution (_resolve_secret_env_vars).

Regression guard for a TOCTOU race that broke concurrent deploys: all deploys share
one process and one os.environ, and each job applies its secrets there under
_run_main_lock then wipes them in a finally. Secret resolution happens at request
time, outside that lock, so a concurrent job holding the lock makes
os.getenv("JWT_SECRET") transiently truthy. The old code skipped the request-supplied
secret on that basis and lost it — the other job's finally removed the value before
this job acquired the lock, and the deploy died with "JWT_SECRET is not set".

Symptom: the Voice Agent page (three deploys at once) failed on the models that
lost the race, while a lone retry of the same model succeeded.
"""

import os
from unittest import mock

import pytest


def _resolve(**kwargs):
    """Import lazily: api.py monkey-patches the tt-inference-server artifact at
    import time, so importing it is only viable when that artifact is present."""
    api = pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )
    return api._resolve_secret_env_vars(**kwargs)


class TestJwtSecretRace:
    def test_request_secret_carried_even_when_env_already_set(self):
        """The race: a concurrent job has JWT_SECRET in the shared os.environ.

        This job must still carry its own copy, because that other value is about to
        be wiped by the other job's finally block.
        """
        with mock.patch.dict(os.environ, {"JWT_SECRET": "other-jobs-leaked-value"}):
            resolved = _resolve(jwt_secret="my-own-secret")
        assert resolved["JWT_SECRET"] == "my-own-secret"

    def test_request_secret_carried_when_env_empty(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            resolved = _resolve(jwt_secret="my-own-secret")
        assert resolved["JWT_SECRET"] == "my-own-secret"

    def test_no_request_secret_leaves_key_unset(self):
        """With no request secret we must not invent one. A JWT_SECRET exported from
        the root .env lives in the pristine env the lock restores, so it survives
        every job's cleanup and needs no per-job copy."""
        with mock.patch.dict(os.environ, {"JWT_SECRET": "from-dotenv"}):
            resolved = _resolve()
        assert "JWT_SECRET" not in resolved


class TestHfTokenPrecedence:
    def test_ui_token_wins_over_request(self):
        resolved = _resolve(hf_token="from-request", ui_hf_token="from-ui")
        assert resolved["HF_TOKEN"] == "from-ui"

    def test_request_token_carried_even_when_env_already_set(self):
        """HF_TOKEN had the identical guard and lost the identical race."""
        with mock.patch.dict(os.environ, {"HF_TOKEN": "other-jobs-leaked-value"}):
            resolved = _resolve(hf_token="from-request")
        assert resolved["HF_TOKEN"] == "from-request"

    def test_no_token_anywhere_leaves_key_unset(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            resolved = _resolve()
        assert "HF_TOKEN" not in resolved


def test_secrets_are_independent():
    """Two concurrent jobs resolving at the same time must not share state."""
    job_a = _resolve(jwt_secret="secret-a", hf_token="token-a")
    job_b = _resolve(jwt_secret="secret-b", hf_token="token-b")
    assert job_a["JWT_SECRET"] == "secret-a"
    assert job_b["JWT_SECRET"] == "secret-b"
    assert job_a["HF_TOKEN"] == "token-a"
    assert job_b["HF_TOKEN"] == "token-b"
