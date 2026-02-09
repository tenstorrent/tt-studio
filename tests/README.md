# TT Studio Test Suite

This directory contains the test suite for TT Studio, focusing on Docker build validation and failure detection.

## Running Tests

### Simple Method (Recommended)

```bash
# Run Docker build tests (auto-installs dependencies in venv)
python run.py tests build

# See available test suites
python run.py tests
```

### Advanced Method (Direct pytest)

```bash
# Run all tests
pytest

### Run specific test files

```bash
pytest tests/test_docker_builds.py
```

### Run specific tests

```bash
pytest tests/test_docker_builds.py::test_backend_build_fails_with_fake_bug
```

### Skip Docker tests

If you don't have Docker installed or want to skip Docker-dependent tests:

```bash
pytest -m "not docker"
```

### Run only Docker tests

```bash
pytest -m docker
```

## Test Structure

### `test_docker_builds.py`

Tests Docker build processes for all TT Studio containers:

- **Backend**: Tests build failure detection with injected bugs
- **Frontend**: Tests build failure detection with injected bugs
- **Agent**: Tests build failure detection with injected bugs
- **Chroma**: Validates compose configuration (uses pre-built image)

Each container has two types of tests:

1. **Failure tests**: Inject a fake bug (non-existent package) and verify the build fails
2. **Success tests**: Verify the container builds successfully without bugs

### How the Tests Work

The tests use temporary Dockerfiles with injected fake bugs:

1. Copy the original Dockerfile to a temp location
2. Inject a fake bug: `RUN pip/npm install non-existent-package-that-will-fail-12345 || exit 1`
3. Run docker build with the modified Dockerfile
4. Assert that the build fails and mentions the fake package
5. Clean up temp files automatically

This approach ensures:
- Production Dockerfiles remain clean (no fake bugs)
- Build failure detection is properly tested
- Tests are isolated and don't affect the repo

## Test Markers

- `@pytest.mark.docker`: Requires Docker daemon
- `@pytest.mark.timeout(N)`: Sets test timeout in seconds

## Configuration

See `pytest.ini` at the repository root for pytest configuration:
- Test discovery paths
- Default markers
- Output formatting
- Timeout settings

## CI/CD Integration

To run tests in CI:

```yaml
- name: Install test dependencies
  run: pip install -r dev-tools/requirements-dev.txt

- name: Run tests
  run: pytest -v
```

For environments without Docker:

```yaml
- name: Run tests (skip Docker)
  run: pytest -v -m "not docker"
```
