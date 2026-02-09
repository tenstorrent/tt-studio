# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Tests for Docker build failure detection.

These tests inject fake build failures into Dockerfiles to verify that the
build system correctly identifies which container failed.
"""

import shutil
from pathlib import Path

import pytest
import yaml

from tests.conftest import run_docker_build


pytestmark = pytest.mark.docker


@pytest.fixture
def inject_backend_bug(repo_root, temp_dockerfile):
    """
    Create a modified backend Dockerfile with a fake bug injected.
    Returns tuple: (modified_dockerfile_path, build_context_dir)
    """
    backend_dir = repo_root / "app" / "backend"
    original_dockerfile = backend_dir / "Dockerfile"

    # Copy the original Dockerfile to temp location
    temp_dockerfile_path = temp_dockerfile / "Dockerfile.backend.test"
    shutil.copy(original_dockerfile, temp_dockerfile_path)

    # Read and modify the Dockerfile to inject fake bug
    content = temp_dockerfile_path.read_text()

    # Inject fake bug after pip install line
    injection_point = "pip3 install -r requirements.txt --no-cache-dir"
    fake_bug = "\n\n# FAKE BUG FOR TESTING: This will cause build to fail\nRUN pip3 install non-existent-package-that-will-fail-12345 || exit 1\n"

    if injection_point in content:
        content = content.replace(injection_point, injection_point + fake_bug)
        temp_dockerfile_path.write_text(content)
    else:
        pytest.skip("Could not find injection point in backend Dockerfile")

    return temp_dockerfile_path, backend_dir


@pytest.fixture
def inject_frontend_bug(repo_root, temp_dockerfile):
    """
    Create a modified frontend Dockerfile.dev with a fake bug injected.
    Returns tuple: (modified_dockerfile_path, build_context_dir)
    """
    frontend_dir = repo_root / "app" / "frontend"
    original_dockerfile = frontend_dir / "Dockerfile.dev"

    # Copy the original Dockerfile to temp location
    temp_dockerfile_path = temp_dockerfile / "Dockerfile.frontend.test"
    shutil.copy(original_dockerfile, temp_dockerfile_path)

    # Read and modify the Dockerfile to inject fake bug
    content = temp_dockerfile_path.read_text()

    # Inject fake bug after npm install line
    injection_point = "RUN npm install"
    fake_bug = "\n\n# FAKE BUG FOR TESTING: This will cause build to fail\nRUN npm install non-existent-package-that-will-fail-12345 || exit 1\n"

    if injection_point in content:
        content = content.replace(injection_point, injection_point + fake_bug)
        temp_dockerfile_path.write_text(content)
    else:
        pytest.skip("Could not find injection point in frontend Dockerfile")

    return temp_dockerfile_path, frontend_dir


@pytest.fixture
def inject_agent_bug(repo_root, temp_dockerfile):
    """
    Create a modified agent Dockerfile with a fake bug injected.
    Returns tuple: (modified_dockerfile_path, build_context_dir)
    """
    agent_dir = repo_root / "app" / "agent"
    original_dockerfile = agent_dir / "Dockerfile"

    # Copy the original Dockerfile to temp location
    temp_dockerfile_path = temp_dockerfile / "Dockerfile.agent.test"
    shutil.copy(original_dockerfile, temp_dockerfile_path)

    # Read and modify the Dockerfile to inject fake bug
    content = temp_dockerfile_path.read_text()

    # Inject fake bug after pip install line
    injection_point = "pip install -r requirements.txt --no-cache-dir"
    fake_bug = "\n\n# FAKE BUG FOR TESTING: This will cause build to fail\nRUN pip install non-existent-package-that-will-fail-12345 || exit 1\n"

    if injection_point in content:
        content = content.replace(injection_point, injection_point + fake_bug)
        temp_dockerfile_path.write_text(content)
    else:
        pytest.skip("Could not find injection point in agent Dockerfile")

    return temp_dockerfile_path, agent_dir


@pytest.mark.timeout(600)
def test_backend_build_fails_with_fake_bug(inject_backend_bug):
    """Test that backend build fails when fake bug is injected."""
    dockerfile_path, context_dir = inject_backend_bug

    exit_code, stdout, stderr = run_docker_build(
        context_dir=context_dir,
        dockerfile_path=dockerfile_path,
        tag="tt_studio_backend:test-fail",
        timeout=300
    )

    # Assert build failed
    assert exit_code != 0, "Backend build should fail with fake bug"

    # Check that error mentions the fake package
    combined_output = stdout + stderr
    assert "non-existent-package-that-will-fail-12345" in combined_output, \
        "Build output should mention the fake package"


@pytest.mark.timeout(600)
def test_frontend_build_fails_with_fake_bug(inject_frontend_bug):
    """Test that frontend build fails when fake bug is injected."""
    dockerfile_path, context_dir = inject_frontend_bug

    exit_code, stdout, stderr = run_docker_build(
        context_dir=context_dir,
        dockerfile_path=dockerfile_path,
        tag="tt_studio_frontend:test-fail",
        timeout=300
    )

    # Assert build failed
    assert exit_code != 0, "Frontend build should fail with fake bug"

    # Check that error mentions the fake package
    combined_output = stdout + stderr
    assert "non-existent-package-that-will-fail-12345" in combined_output, \
        "Build output should mention the fake package"


@pytest.mark.timeout(600)
def test_agent_build_fails_with_fake_bug(inject_agent_bug):
    """Test that agent build fails when fake bug is injected."""
    dockerfile_path, context_dir = inject_agent_bug

    exit_code, stdout, stderr = run_docker_build(
        context_dir=context_dir,
        dockerfile_path=dockerfile_path,
        tag="tt_studio_agent:test-fail",
        timeout=300
    )

    # Assert build failed
    assert exit_code != 0, "Agent build should fail with fake bug"

    # Check that error mentions the fake package
    combined_output = stdout + stderr
    assert "non-existent-package-that-will-fail-12345" in combined_output, \
        "Build output should mention the fake package"


def test_chroma_service_config_valid(app_dir):
    """
    Test that Chroma service is properly configured in docker-compose.yml.

    Chroma uses a pre-built image (chromadb/chroma:0.5.3) so there's no Dockerfile to test.
    This test validates the compose configuration instead.
    """
    compose_file = app_dir / "docker-compose.yml"
    assert compose_file.exists(), "docker-compose.yml should exist"

    with open(compose_file) as f:
        compose_config = yaml.safe_load(f)

    # Validate Chroma service exists
    assert "services" in compose_config, "Compose file should have services section"
    assert "tt_studio_chroma" in compose_config["services"], \
        "Chroma service should be defined in docker-compose.yml"

    chroma_service = compose_config["services"]["tt_studio_chroma"]

    # Validate image is set correctly
    assert "image" in chroma_service, "Chroma service should specify an image"
    assert chroma_service["image"] == "chromadb/chroma:0.5.3", \
        "Chroma service should use chromadb/chroma:0.5.3 image"

    # Validate service has required configuration
    assert "container_name" in chroma_service, "Chroma service should have container_name"
    assert chroma_service["container_name"] == "tt_studio_chroma", \
        "Chroma container should be named tt_studio_chroma"


@pytest.mark.timeout(600)
def test_backend_build_succeeds_without_bug(repo_root):
    """Test that backend builds successfully without fake bug."""
    backend_dir = repo_root / "app" / "backend"
    dockerfile_path = backend_dir / "Dockerfile"

    exit_code, stdout, stderr = run_docker_build(
        context_dir=backend_dir,
        dockerfile_path=dockerfile_path,
        tag="tt_studio_backend:test-success",
        timeout=300
    )

    # Assert build succeeded
    assert exit_code == 0, f"Backend build should succeed without fake bug.\nStdout: {stdout}\nStderr: {stderr}"


@pytest.mark.timeout(600)
def test_frontend_build_succeeds_without_bug(repo_root):
    """Test that frontend builds successfully without fake bug."""
    frontend_dir = repo_root / "app" / "frontend"
    dockerfile_path = frontend_dir / "Dockerfile.dev"

    exit_code, stdout, stderr = run_docker_build(
        context_dir=frontend_dir,
        dockerfile_path=dockerfile_path,
        tag="tt_studio_frontend:test-success",
        timeout=300
    )

    # Assert build succeeded
    assert exit_code == 0, f"Frontend build should succeed without fake bug.\nStdout: {stdout}\nStderr: {stderr}"


@pytest.mark.timeout(600)
def test_agent_build_succeeds_without_bug(repo_root):
    """Test that agent builds successfully without fake bug."""
    agent_dir = repo_root / "app" / "agent"
    dockerfile_path = agent_dir / "Dockerfile"

    exit_code, stdout, stderr = run_docker_build(
        context_dir=agent_dir,
        dockerfile_path=dockerfile_path,
        tag="tt_studio_agent:test-success",
        timeout=300
    )

    # Assert build succeeded
    assert exit_code == 0, f"Agent build should succeed without fake bug.\nStdout: {stdout}\nStderr: {stderr}"
