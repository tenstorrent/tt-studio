# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for api.py's dev-mode subprocess deploy path (_run_dev_mode_job /
_execute_dev_mode_subprocess).

Builds a minimal fake tt-inference-server artifact whose run.py doubles as both
the import-time bootstrap target (api.py does `from run import main as run_main,
...` at its own module import) and the actual script the new subprocess branch
executes -- driven entirely by env-var toggles so one fixture script covers every
scenario. It prints plain text lines mimicking real run.py output (no `logging`
module needed -- just print()/stderr writes), and records each invocation's
argv/cwd/env as a JSON line to a dump file, so the tests can verify subprocess
isolation and retry behavior without needing the real artifact, Docker, or
hardware.
"""

import json
import logging
import os
import sys
import tempfile
import textwrap
import uuid
from collections import deque
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

INFERENCE_API_DIR = Path(__file__).resolve().parent.parent


def _write(path: Path, content: str) -> None:
    path.write_text(textwrap.dedent(content))


WORKFLOWS_UTILS_SRC = """
    from pathlib import Path

    def get_repo_root_path(marker=".git"):
        return Path(__file__).resolve().parent.parent

    default_dotenv_path = Path(__file__).resolve().parent.parent / ".env"

    def load_dotenv(dotenv_path=None):
        return {}

    def write_dotenv(key, value, dotenv_path=None):
        pass
"""

LOG_SETUP_SRC = """
    import logging

    class ConditionalFormatter(logging.Formatter):
        pass

    def setup_run_logger(logger, run_id, run_log_path, log_level=logging.DEBUG):
        return logger
"""

SETUP_HOST_SRC = """
    class HostSetupManager:
        def check_model_weights_dir(self, host_weights_dir):
            return True
"""

# api.py's own process never needs dev-tier awareness anymore (real deploy
# execution moved to a subprocess with its own fresh interpreter) -- no tier
# logic needed here, just enough for `from workflows.model_spec import
# MODEL_SPECS, get_runtime_model_spec` (api.py's own bootstrap import) to succeed.
MODEL_SPEC_SRC = """
    MODEL_SPECS = {}

    def get_runtime_model_spec(model_name, device=None, impl=None):
        raise ValueError(f"model {model_name} not in catalog")
"""

# The real script the dev-mode subprocess branch executes. Env-var toggles let one
# fixture drive every test scenario:
#   FAKE_RUN_DUMP_PATH            -- append one JSON line per invocation with
#                                    argv/cwd/env, so tests can inspect exactly
#                                    what _execute_dev_mode_subprocess launched.
#   FAKE_RUN_FAIL_ALWAYS=1        -- always exit 1.
#   FAKE_RUN_FAIL_ON_HOST_VOLUME=1 -- exit 1 only while --host-volume is in argv
#                                    (mimics a real host-volume-missing failure
#                                    that a retry without --host-volume clears).
RUN_PY_SRC = """
    import json, os, sys
    from enum import Enum

    class WorkflowType(Enum):
        SERVER = "server"

    class DeviceTypes(Enum):
        CPU = "cpu"

    def main():
        argv = sys.argv[1:]
        dump_path = os.environ.get("FAKE_RUN_DUMP_PATH")
        if dump_path:
            with open(dump_path, "a") as f:
                f.write(json.dumps({
                    "argv": argv,
                    "cwd": os.getcwd(),
                    "MODEL_SPECS_ENV": os.environ.get("MODEL_SPECS_ENV"),
                    "AUTOMATIC_HOST_SETUP": os.environ.get("AUTOMATIC_HOST_SETUP"),
                    "FAKE_RUN_DUMP_PATH_present": "FAKE_RUN_DUMP_PATH" in os.environ,
                }) + "\\n")
        print("Downloading model configuration files: Fetching 3 files:  10%", flush=True)
        print(": pulling fs layer", flush=True)
        print(": pull complete", flush=True)
        sys.stderr.write("diagnostic line on stderr\\n")
        sys.stderr.flush()
        if os.environ.get("FAKE_RUN_FAIL_ALWAYS") == "1":
            print("Weights directory does not exist for demo-model.", flush=True)
            return 1
        if os.environ.get("FAKE_RUN_FAIL_ON_HOST_VOLUME") == "1" and "--host-volume" in argv:
            print("Weights directory does not exist for demo-model.", flush=True)
            return 1
        print("This log file is saved on local machine at: /tmp/fake_run_log.log", flush=True)
        print("renamed container", flush=True)
        return 0

    if __name__ == "__main__":
        sys.exit(main())
"""


class TestDevModeSubprocess(TestCase):
    """Exercises api._run_dev_mode_job()/_execute_dev_mode_subprocess() against a
    fake run.py, run as a genuine subprocess -- the same mechanism used for real
    dev-tier deploys."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.artifact_dir = Path(cls._tmp.name)

        (cls.artifact_dir / "workflows").mkdir()
        _write(cls.artifact_dir / "workflows" / "__init__.py", "")
        _write(cls.artifact_dir / "workflows" / "utils.py", WORKFLOWS_UTILS_SRC)
        _write(cls.artifact_dir / "workflows" / "log_setup.py", LOG_SETUP_SRC)
        _write(cls.artifact_dir / "workflows" / "setup_host.py", SETUP_HOST_SRC)
        _write(cls.artifact_dir / "workflows" / "model_spec.py", MODEL_SPEC_SRC)
        _write(cls.artifact_dir / "run.py", RUN_PY_SRC)

        os.environ["TT_INFERENCE_ARTIFACT_PATH"] = str(cls.artifact_dir)

        sys.path.insert(0, str(INFERENCE_API_DIR))
        import api  # noqa: E402 -- must import after env/sys.path are ready

        cls.api = api

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def setUp(self):
        self.job_id = f"test-{uuid.uuid4().hex[:8]}"
        self.dump_path = self.artifact_dir / f"dump-{self.job_id}.jsonl"
        self.run_logger = logging.getLogger("run_log")
        # Mirror run_inference()'s own seeding of these two module-level dicts
        # (api.py:~1900-1907) before the background job ever starts.
        self.api.progress_store[self.job_id] = {
            "status": "starting", "stage": "initialization", "progress": 0,
            "message": "Starting deployment...", "last_updated": 0,
        }
        self.api.log_store[self.job_id] = deque(maxlen=100)

    def tearDown(self):
        self.api.progress_store.pop(self.job_id, None)
        self.api.log_store.pop(self.job_id, None)

    def _dump_lines(self):
        if not self.dump_path.exists():
            return []
        return [json.loads(l) for l in self.dump_path.read_text().splitlines() if l]

    def _log_messages(self):
        return [e["message"] for e in self.api.log_store[self.job_id]]

    def _sync_tokens_into(self, env_overrides):
        """Run sync_tokens_from_tt_studio() against a throwaway TT_STUDIO_ROOT with
        no .env, pointing the artifact .env at a fresh temp dir. Returns that file."""
        with tempfile.TemporaryDirectory() as studio_root, tempfile.TemporaryDirectory() as art:
            env = {k: v for k, v in os.environ.items() if k not in ("HF_TOKEN", "JWT_SECRET")}
            env.update({"TT_STUDIO_ROOT": studio_root, **env_overrides})
            from unittest.mock import patch
            with patch.dict(os.environ, env, clear=True), \
                 patch.object(self.api, "artifact_path", art), \
                 patch.object(self.api, "_get_hf_token_from_user_config", return_value=None):
                self.api.sync_tokens_from_tt_studio()
            target = Path(art) / ".env"
            return target.exists(), (target.read_text() if target.exists() else "")

    def test_sync_tokens_falls_back_to_process_env_hf_token(self):
        # No repo .env and no Settings token: the HF_TOKEN run.py handed this
        # process (from the user's shell) must still reach the artifact .env that
        # the model container is launched with.
        exists, text = self._sync_tokens_into({"HF_TOKEN": "hf_from_shell"})
        self.assertTrue(exists)
        self.assertIn("HF_TOKEN=hf_from_shell", text)

    def test_sync_tokens_creates_empty_env_when_nothing_to_sync(self):
        # `docker run --env-file <artifact>/.env` fails hard when the file is
        # missing, so an anonymous deploy still needs the file to exist.
        exists, text = self._sync_tokens_into({})
        self.assertTrue(exists)
        self.assertNotIn("HF_TOKEN=", text)

    def test_happy_path_populates_log_and_progress_store(self):
        initial_argv = ["run.py", "--model", "TestModel", "--dev-mode", "--docker-server"]
        env_vars = {"AUTOMATIC_HOST_SETUP": "True"}
        request = SimpleNamespace(skip_system_sw_validation=False)

        return_code, container_info = self.api._run_dev_mode_job(
            self.job_id, initial_argv, self.artifact_dir, env_vars, request, self.run_logger
        )

        self.assertEqual(return_code, 0)
        self.assertIsNone(container_info)
        messages = self._log_messages()
        self.assertTrue(any(": pulling fs layer" in m for m in messages))
        self.assertTrue(any("renamed container" in m for m in messages))
        self.assertTrue(any("diagnostic line on stderr" in m for m in messages))
        self.assertEqual(self.api.progress_store[self.job_id]["status"], "completed")
        self.assertEqual(self.api.progress_store[self.job_id]["progress"], 100)

    def test_subprocess_is_isolated_from_parent_process_state(self):
        initial_argv = ["run.py", "--model", "TestModel", "--dev-mode", "--docker-server"]
        env_vars = {"AUTOMATIC_HOST_SETUP": "True", "FAKE_RUN_DUMP_PATH": str(self.dump_path)}
        request = SimpleNamespace(skip_system_sw_validation=False)

        prev_argv = list(sys.argv)
        prev_cwd = Path.cwd()
        prev_env = dict(os.environ)

        self.api._run_dev_mode_job(
            self.job_id, initial_argv, self.artifact_dir, env_vars, request, self.run_logger
        )

        # Zero shared-state mutation, unlike the in-process path.
        self.assertEqual(sys.argv, prev_argv)
        self.assertEqual(Path.cwd(), prev_cwd)
        self.assertEqual(dict(os.environ), prev_env)
        self.assertNotIn("FAKE_RUN_DUMP_PATH", os.environ)
        self.assertNotIn("AUTOMATIC_HOST_SETUP", os.environ)

        # But the CHILD saw everything it needed.
        dumps = self._dump_lines()
        self.assertEqual(len(dumps), 1)
        self.assertIn("--model", dumps[0]["argv"])
        self.assertIn("--dev-mode", dumps[0]["argv"])
        self.assertEqual(dumps[0]["cwd"], str(self.artifact_dir.resolve()))
        self.assertEqual(dumps[0]["MODEL_SPECS_ENV"], "dev")
        self.assertEqual(dumps[0]["AUTOMATIC_HOST_SETUP"], "True")

    def test_retries_once_then_succeeds(self):
        initial_argv = [
            "run.py", "--model", "TestModel", "--dev-mode", "--docker-server",
            "--host-volume", "/fake/path",
        ]
        env_vars = {
            "AUTOMATIC_HOST_SETUP": "True",
            "FAKE_RUN_DUMP_PATH": str(self.dump_path),
            "FAKE_RUN_FAIL_ON_HOST_VOLUME": "1",
        }
        request = SimpleNamespace(skip_system_sw_validation=False)

        return_code, _ = self.api._run_dev_mode_job(
            self.job_id, initial_argv, self.artifact_dir, env_vars, request, self.run_logger
        )

        self.assertEqual(return_code, 0)
        dumps = self._dump_lines()
        self.assertEqual(len(dumps), 2)
        self.assertIn("--host-volume", dumps[0]["argv"])
        self.assertNotIn("--host-volume", dumps[1]["argv"])

    def test_retries_once_then_still_fails(self):
        initial_argv = ["run.py", "--model", "TestModel", "--dev-mode", "--docker-server"]
        env_vars = {
            "AUTOMATIC_HOST_SETUP": "True",
            "FAKE_RUN_DUMP_PATH": str(self.dump_path),
            "FAKE_RUN_FAIL_ALWAYS": "1",
        }
        request = SimpleNamespace(skip_system_sw_validation=False)

        return_code, _ = self.api._run_dev_mode_job(
            self.job_id, initial_argv, self.artifact_dir, env_vars, request, self.run_logger
        )

        self.assertNotEqual(return_code, 0)
        dumps = self._dump_lines()
        self.assertEqual(len(dumps), 2)  # exactly one retry, not zero, not a loop
