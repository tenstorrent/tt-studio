# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import run


class CleanupAllTests(unittest.TestCase):
    def _patch_cleanup_paths(self, root, sentinel):
        easy_config = root / ".tt_studio_easy_config.json"
        docker_log = root / "docker-control-service.log"
        docker_pid = root / "docker-control-service.pid"
        return (
            patch.object(run, "TT_STUDIO_ROOT", str(root)),
            patch.object(run, "ENV_FILE_PATH", str(root / "app" / ".env")),
            patch.object(run, "STARTUP_LOG_FILE", str(root / "startup.log")),
            patch.object(run, "PREFS_FILE_PATH", str(root / ".tt_studio_preferences.json")),
            patch.object(run, "EASY_CONFIG_FILE_PATH", str(easy_config)),
            patch.object(run, "FASTAPI_LOG_FILE", str(root / "fastapi.log")),
            patch.object(run, "FASTAPI_PID_FILE", str(root / "fastapi.pid")),
            patch.object(run, "DOCKER_CONTROL_LOG_FILE", str(docker_log)),
            patch.object(run, "DOCKER_CONTROL_PID_FILE", str(docker_pid)),
            patch.object(run, "INFERENCE_API_DIR", str(root / "inference-api")),
            patch.object(run, "DOCKER_CONTROL_SERVICE_DIR", str(root / "docker-control-service")),
            patch.object(run, "BROWSER_CLEANUP_SENTINEL", str(sentinel)),
        )

    def test_cleanup_helpers_handle_sizes_and_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            nested = Path(tmp) / "nested"
            nested.mkdir()
            (nested / "a.txt").write_text("abc")
            (nested / "b.txt").write_text("de")

            self.assertEqual(run._format_bytes(0), "0 B")
            self.assertEqual(run._format_bytes(1024), "1.0 KB")
            self.assertEqual(run._path_size(str(nested)), 5)

            self.assertTrue(run._remove_path(str(nested), no_sudo=True))
            self.assertFalse(nested.exists())

    def test_remove_directory_contents_preserves_tracked_bootstrap(self):
        with tempfile.TemporaryDirectory() as tmp:
            workflow_venvs = Path(tmp) / ".workflow_venvs"
            generated = workflow_venvs / "generated_venv"
            generated.mkdir(parents=True)
            (generated / "payload.txt").write_text("generated")
            bootstrap = workflow_venvs / ".venv_bootstrap_uv"
            bootstrap.write_text("tracked")

            self.assertTrue(run._remove_directory_contents(
                str(workflow_venvs),
                preserve_names={".venv_bootstrap_uv"},
                no_sudo=True,
            ))
            self.assertTrue(bootstrap.exists())
            self.assertFalse(generated.exists())

    def test_write_browser_cleanup_sentinel_uses_numeric_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            sentinel = Path(tmp) / "public" / ".cleanup-pending"
            with patch.object(run, "BROWSER_CLEANUP_SENTINEL", str(sentinel)):
                token = run._write_browser_cleanup_sentinel()

            self.assertIsNotNone(token)
            self.assertTrue(token.isdigit())
            self.assertEqual(sentinel.read_text(), token)

    def test_cleanup_all_aborts_before_destructive_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sentinel = root / "app" / "frontend" / "public" / ".cleanup-pending"
            called = {"runtime": False, "images": False, "sentinel": False}
            with contextlib.ExitStack() as stack:
                for patcher in self._patch_cleanup_paths(root, sentinel):
                    stack.enter_context(patcher)
                stack.enter_context(patch.object(run, "check_docker_access", return_value=True))
                stack.enter_context(patch("builtins.input", return_value="n"))
                stack.enter_context(patch.object(
                    run,
                    "_cleanup_runtime",
                    side_effect=lambda *args, **kwargs: called.__setitem__("runtime", True),
                ))
                stack.enter_context(patch.object(
                    run,
                    "_remove_local_tt_studio_images",
                    side_effect=lambda *args, **kwargs: called.__setitem__("images", True),
                ))
                stack.enter_context(patch.object(
                    run,
                    "_write_browser_cleanup_sentinel",
                    side_effect=lambda: called.__setitem__("sentinel", True),
                ))
                args = SimpleNamespace(cleanup_all=True, yes=False, no_sudo=True, dev=False)
                with contextlib.redirect_stdout(io.StringIO()):
                    run.cleanup_resources(args)

            self.assertEqual(called, {"runtime": False, "images": False, "sentinel": False})

    def test_cleanup_all_yes_removes_state_and_arms_browser_wipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            persistent = root / "tt_studio_persistent_volume"
            persistent.mkdir()
            (persistent / "user_config.json").write_text('{"hf_token": "hf_test"}')
            env_file = root / "app" / ".env"
            env_file.parent.mkdir()
            env_file.write_text("HF_TOKEN=hf_test\n")
            startup_log = root / "startup.log"
            startup_log.write_text("log")
            prefs = root / ".tt_studio_preferences.json"
            prefs.write_text("{}")
            workflow_venvs = root / ".workflow_venvs"
            workflow_generated = workflow_venvs / "generated_venv"
            workflow_generated.mkdir(parents=True)
            (workflow_generated / "payload.txt").write_text("generated")
            workflow_bootstrap = workflow_venvs / ".venv_bootstrap_uv"
            workflow_bootstrap.write_text("tracked")
            sentinel = root / "app" / "frontend" / "public" / ".cleanup-pending"

            with contextlib.ExitStack() as stack:
                for patcher in self._patch_cleanup_paths(root, sentinel):
                    stack.enter_context(patcher)
                stack.enter_context(patch.object(
                    run,
                    "get_env_var",
                    side_effect=lambda name, default="": default,
                ))
                stack.enter_context(patch.object(run, "check_docker_access", return_value=True))
                stack.enter_context(patch.object(run, "_cleanup_runtime"))
                stack.enter_context(patch.object(run, "_remove_local_tt_studio_images", return_value=0))
                args = SimpleNamespace(cleanup_all=True, yes=True, no_sudo=True, dev=False)
                with contextlib.redirect_stdout(io.StringIO()):
                    run.cleanup_resources(args)

            self.assertFalse(persistent.exists())
            self.assertFalse(env_file.exists())
            self.assertFalse(startup_log.exists())
            self.assertFalse(prefs.exists())
            self.assertTrue(workflow_bootstrap.exists())
            self.assertFalse(workflow_generated.exists())
            self.assertTrue(sentinel.exists())
            self.assertTrue(sentinel.read_text().isdigit())


if __name__ == "__main__":
    unittest.main()
