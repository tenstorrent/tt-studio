# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for the internal Docker Control Compose boundary."""

import importlib.util
import json
import os
import shutil
import subprocess
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


if __name__ == "__main__":
    unittest.main()
