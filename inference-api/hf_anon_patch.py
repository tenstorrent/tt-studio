# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Patch the tt-inference-server artifact's HF_TOKEN hard-gates so public
(non-gated) models deploy without a token.

tt-inference-server requires a non-empty HF_TOKEN in three places, all of which
either block on an interactive getpass() prompt (which hangs forever — or hits
EOFError with stdin closed — inside a headless process, leaving the deploy
frozen at 0%) or assert:
  1. run.handle_secrets()                       — prompt/assert before anything runs
  2. HostSetupManager.get_hf_env_vars()         — assert check_hf_access(token)
  3. HostSetupManager.setup_weights_huggingface — `assert self.hf_token` before download

Public models need none of that: huggingface_hub treats an empty HF_TOKEN env var
as no token and downloads anonymously (utils._auth._clean_token("") -> None). So
when no token is configured we pass a truthy-but-empty token through the asserts,
and replace the token validation with an anonymous repo check that fails fast —
with an actionable message — only for genuinely gated repos.

Used from two places, which is why it lives in its own module:
  - api.py applies it at import time against the globally pinned artifact
    (the in-process deploy path);
  - run_py_entry.py applies it inside each dev-mode run.py subprocess, whose
    fresh interpreter re-imports the artifact and can't inherit api.py's
    in-memory patches.
"""

import json
import logging
import os
import urllib.request


class AnonymousHFToken(str):
    """Truthy empty string: satisfies the artifact's `assert self.hf_token` gates
    while exporting an empty HF_TOKEN env var, which downstream tooling
    (huggingface_hub / the `hf` CLI) treats as anonymous access."""

    __slots__ = ()

    def __new__(cls):
        return super().__new__(cls, "")

    def __bool__(self):
        return True


def apply_hf_anon_patches(run_module, setup_host_module):
    """Install the anonymous-HF patches on an imported artifact.

    All lookups are getattr-guarded: the test suite imports api against stub
    artifact modules that don't define these attributes; the real artifact
    always does.
    """
    _orig_handle_secrets = getattr(run_module, "handle_secrets", None)

    def _patched_handle_secrets(runtime_config):
        if os.getenv("HF_TOKEN"):
            return _orig_handle_secrets(runtime_config)
        # Keep the original's JWT gate as a fail-fast instead of a hidden prompt.
        jwt_required = (
            str(runtime_config.workflow).lower() == "server"
            and runtime_config.docker_server
            and not runtime_config.interactive
            and not runtime_config.no_auth
        )
        if jwt_required and not os.getenv("JWT_SECRET"):
            raise RuntimeError(
                "JWT_SECRET is not set — refusing to start a docker-server deploy."
            )
        logging.getLogger(__name__).warning(
            "HF_TOKEN not set — deploying anonymously. Public models download "
            "normally; gated models (Llama, Gemma, ...) need a token set in "
            "TT-Studio Settings or .env."
        )
        # Keep the original's side effect of materializing the repo-root .env:
        # run_docker_server.py passes it to `docker run --env-file`
        # unconditionally, and docker errors out if the file doesn't exist.
        # Write the secrets that ARE present (JWT_SECRET); HF_TOKEN is simply
        # absent, which downstream tooling treats as anonymous access.
        load_dotenv = getattr(run_module, "load_dotenv", None)
        write_dotenv = getattr(run_module, "write_dotenv", None)
        if load_dotenv is not None and write_dotenv is not None:
            if not load_dotenv():
                write_dotenv(
                    {k: os.environ[k] for k in ("JWT_SECRET",) if os.getenv(k)}
                )
                load_dotenv()

    if _orig_handle_secrets is not None:
        run_module.handle_secrets = _patched_handle_secrets

    manager_cls = getattr(setup_host_module, "HostSetupManager", None)
    if manager_cls is None:
        return

    _orig_get_hf_env_vars = getattr(manager_cls, "get_hf_env_vars", None)

    def _patched_get_hf_env_vars(self):
        if not (self.hf_token or os.getenv("HF_TOKEN")):
            self.hf_token = AnonymousHFToken()
        return _orig_get_hf_env_vars(self)

    if _orig_get_hf_env_vars is not None:
        manager_cls.get_hf_env_vars = _patched_get_hf_env_vars

    _orig_check_hf_access = getattr(manager_cls, "check_hf_access", None)

    def _patched_check_hf_access(self, token):
        if token and not isinstance(token, AnonymousHFToken):
            return _orig_check_hf_access(self, token)
        # Anonymous path: usable iff the repo is public. The models API serves gated
        # repos' metadata anonymously, so inspect the `gated` field rather than the
        # HTTP status.
        repo = self.model_spec.hf_weights_repo
        log = logging.getLogger(__name__)
        url = f"https://huggingface.co/api/models/{repo}"
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "tt-studio/anon-access-check"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                info = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            log.error(
                "⛔ Anonymous Hugging Face access check failed for %s: %s. "
                "Set a HF token in TT-Studio Settings (or HF_TOKEN in .env) and retry.",
                repo,
                exc,
            )
            return False
        if info.get("gated"):
            log.error(
                "⛔ %s is a gated model — it cannot be downloaded anonymously. "
                "Set your Hugging Face token in TT-Studio Settings (or HF_TOKEN in .env).",
                repo,
            )
            return False
        if not info.get("siblings"):
            log.error("⛔ No files found in repository %s.", repo)
            return False
        return True

    if _orig_check_hf_access is not None:
        manager_cls.check_hf_access = _patched_check_hf_access
