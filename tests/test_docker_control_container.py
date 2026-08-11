# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for the internal Docker Control Compose boundary."""

import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def _load_config():
    spec = importlib.util.spec_from_file_location(
        "docker_control_config_test", ROOT / "docker-control-service" / "config.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_entrypoint():
    spec = importlib.util.spec_from_file_location(
        "docker_control_entrypoint_test", ROOT / "docker-control-service" / "entrypoint.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DockerControlConfigTests(unittest.TestCase):
    def test_manual_default_is_loopback(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DOCKER_CONTROL_HOST", None)
            config = _load_config()
        self.assertEqual(config.Settings.HOST, "127.0.0.1")

    def test_compose_can_override_internal_bind(self):
        with patch.dict(os.environ, {"DOCKER_CONTROL_HOST": "0.0.0.0"}):
            config = _load_config()
        self.assertEqual(config.Settings.HOST, "0.0.0.0")


class DockerControlComposeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("docker"), "Docker CLI is required")
    def test_compose_renders_internal_service_boundary(self):
        environment = os.environ.copy()
        environment["TT_STUDIO_ROOT"] = str(ROOT)
        environment.setdefault("DOCKER_CONTROL_JWT_SECRET", "test-secret")
        command = [
            "docker", "compose",
            "-f", "app/docker-compose.yml",
            "-f", "app/docker-compose.prod.yml",
            "--profile", "docker-control",
            "config", "--format", "json",
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

        config = json.loads(result.stdout)
        docker_control = config["services"]["tt_studio_docker_control"]
        backend = config["services"]["tt_studio_backend"]
        mounts = {
            (mount["source"], mount["target"])
            for mount in docker_control["volumes"]
        }

        self.assertEqual(docker_control["profiles"], ["docker-control"])
        self.assertIsNone(docker_control.get("ports"))
        self.assertEqual(
            docker_control["command"],
            ["python", "entrypoint.py", "--host", "0.0.0.0", "--port", "8002"],
        )
        self.assertIn(("/var/run/docker.sock", "/var/run/docker.sock"), mounts)
        self.assertIn("docker-control", docker_control["networks"]["tt_studio_network"]["aliases"])
        healthcheck = docker_control["healthcheck"]["test"]
        self.assertIn("json.load", healthcheck[-1])
        self.assertIn("get('docker') == 'healthy'", healthcheck[-1])
        self.assertEqual(
            backend["depends_on"]["tt_studio_docker_control"]["condition"],
            "service_healthy",
        )
        self.assertTrue(
            backend["depends_on"]["tt_studio_docker_control"]["required"],
        )
        self.assertEqual(
            backend["environment"]["DOCKER_CONTROL_SERVICE_URL"],
            "http://docker-control:8002",
        )

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI is required")
    def test_dev_compose_uses_entrypoint_with_reload(self):
        environment = os.environ.copy()
        environment["TT_STUDIO_ROOT"] = str(ROOT)
        command = [
            "docker", "compose",
            "-f", "app/docker-compose.yml",
            "-f", "app/docker-compose.dev-mode.yml",
            "--profile", "docker-control",
            "config", "--format", "json",
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        docker_control = json.loads(result.stdout)["services"]["tt_studio_docker_control"]
        self.assertEqual(
            docker_control["command"],
            ["python", "entrypoint.py", "--host", "0.0.0.0", "--port", "8002", "--reload"],
        )

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI is required")
    def test_explicit_skip_override_allows_a_degraded_stack(self):
        environment = os.environ.copy()
        environment["TT_STUDIO_ROOT"] = str(ROOT)
        command = [
            "docker", "compose",
            "-f", "app/docker-compose.yml",
            "-f", "app/docker-compose.prod.yml",
            "-f", "app/docker-compose.skip-docker-control.yml",
            "config", "--format", "json",
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

        config = json.loads(result.stdout)
        dependency = config["services"]["tt_studio_backend"]["depends_on"]["tt_studio_docker_control"]
        self.assertFalse(dependency["required"])


class DockerControlEntrypointTests(unittest.TestCase):
    class _Process:
        def __init__(self, lines=(), returncode=0):
            self.pid = 4242
            self.stdout = iter(lines)
            self.returncode = returncode

        def poll(self):
            return None

        def wait(self):
            return self.returncode

        def send_signal(self, _signum):
            pass

    def test_returns_uvicorn_failure_and_mirrors_its_output(self):
        entrypoint = _load_entrypoint()
        process = self._Process(lines=("uvicorn failed\n",), returncode=17)

        with tempfile.TemporaryDirectory() as directory:
            log_file = Path(directory) / "docker-control.log"
            with patch.object(entrypoint.subprocess, "Popen", return_value=process) as popen, \
                 patch("sys.stdout", new_callable=io.StringIO) as stdout:
                returncode = entrypoint.run_server(["uvicorn", "api:app"], str(log_file))
            log_contents = log_file.read_text()

        self.assertEqual(returncode, 17)
        self.assertEqual(stdout.getvalue(), "uvicorn failed\n")
        self.assertEqual(log_contents, "uvicorn failed\n")
        self.assertEqual(popen.call_args.args[0], ["uvicorn", "api:app"])
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_forwards_stop_signal_to_uvicorn_process_group(self):
        entrypoint = _load_entrypoint()
        process = self._Process()

        with patch.object(entrypoint.os, "killpg") as killpg:
            entrypoint._forward_signal(process, entrypoint.signal.SIGTERM, None)

        killpg.assert_called_once_with(process.pid, entrypoint.signal.SIGTERM)

    def test_converts_child_signal_to_standard_container_exit_status(self):
        entrypoint = _load_entrypoint()
        process = self._Process(returncode=-entrypoint.signal.SIGTERM)

        with patch.object(entrypoint.subprocess, "Popen", return_value=process), \
             patch("sys.stdout", new_callable=io.StringIO):
            returncode = entrypoint.run_server(["uvicorn", "api:app"], "")

        self.assertEqual(returncode, 128 + entrypoint.signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
