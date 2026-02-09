# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Pytest configuration and fixtures for Docker build tests."""

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def repo_root():
    """Return the repository root directory."""
    return Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def app_dir(repo_root):
    """Return the app directory containing docker-compose.yml."""
    return repo_root / "app"


@pytest.fixture
def temp_dockerfile():
    """
    Create a temporary directory for modified Dockerfiles.
    Yields the temp directory path and cleans up after the test.
    """
    temp_dir = tempfile.mkdtemp(prefix="tt_studio_test_")
    yield Path(temp_dir)
    shutil.rmtree(temp_dir, ignore_errors=True)


def run_docker_build(context_dir: Path, dockerfile_path: Path, tag: str, timeout: int = 300):
    """
    Run docker build and return exit code, stdout, and stderr.

    Args:
        context_dir: Build context directory
        dockerfile_path: Path to Dockerfile
        tag: Image tag
        timeout: Build timeout in seconds

    Returns:
        tuple: (exit_code, stdout, stderr)
    """
    cmd = [
        "docker", "build",
        "-f", str(dockerfile_path),
        "-t", tag,
        str(context_dir)
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=context_dir
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired as e:
        return -1, str(e.stdout) if e.stdout else "", str(e.stderr) if e.stderr else "Build timeout"


def run_docker_compose_build(app_dir: Path, service: str, compose_files: list[str] = None, timeout: int = 300):
    """
    Run docker compose build for a specific service.

    Args:
        app_dir: Directory containing docker-compose.yml
        service: Service name to build
        compose_files: List of compose file names (relative to app_dir)
        timeout: Build timeout in seconds

    Returns:
        tuple: (exit_code, stdout, stderr)
    """
    if compose_files is None:
        compose_files = ["docker-compose.yml"]

    cmd = ["docker", "compose"]
    for compose_file in compose_files:
        cmd.extend(["-f", compose_file])
    cmd.extend(["build", service])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=app_dir
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired as e:
        return -1, str(e.stdout) if e.stdout else "", str(e.stderr) if e.stderr else "Build timeout"
