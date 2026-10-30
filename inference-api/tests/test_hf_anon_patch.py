# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for hf_anon_patch's patched handle_secrets — specifically the
repo-root .env materialization: run_docker_server.py passes that file to
`docker run --env-file` unconditionally, so a token-less deploy that skips the
original handle_secrets must still create it."""

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hf_anon_patch import apply_hf_anon_patches  # noqa: E402


def _runtime_config():
    return SimpleNamespace(
        workflow="server", docker_server=True, interactive=False, no_auth=False
    )


class TestPatchedHandleSecretsDotenv(TestCase):
    def _make_run_module(self, load_results):
        calls = {"write": [], "load": 0}

        def load_dotenv():
            calls["load"] += 1
            return load_results[min(calls["load"], len(load_results)) - 1]

        def write_dotenv(env_vars):
            calls["write"].append(env_vars)

        run_module = SimpleNamespace(
            handle_secrets=lambda cfg: (_ for _ in ()).throw(
                AssertionError("original handle_secrets must not run without a token")
            ),
            load_dotenv=load_dotenv,
            write_dotenv=write_dotenv,
        )
        return run_module, calls

    def test_writes_env_file_when_missing(self):
        run_module, calls = self._make_run_module(load_results=[False, True])
        apply_hf_anon_patches(run_module, SimpleNamespace())

        with mock.patch.dict(os.environ, {"JWT_SECRET": "test-jwt"}, clear=True):
            run_module.handle_secrets(_runtime_config())

        self.assertEqual(calls["write"], [{"JWT_SECRET": "test-jwt"}])
        self.assertEqual(calls["load"], 2)

    def test_leaves_existing_env_file_alone(self):
        run_module, calls = self._make_run_module(load_results=[True])
        apply_hf_anon_patches(run_module, SimpleNamespace())

        with mock.patch.dict(os.environ, {"JWT_SECRET": "test-jwt"}, clear=True):
            run_module.handle_secrets(_runtime_config())

        self.assertEqual(calls["write"], [])
        self.assertEqual(calls["load"], 1)

    def test_no_jwt_secret_fails_fast_before_writing(self):
        run_module, calls = self._make_run_module(load_results=[False, True])
        apply_hf_anon_patches(run_module, SimpleNamespace())

        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                run_module.handle_secrets(_runtime_config())

        self.assertEqual(calls["write"], [])
