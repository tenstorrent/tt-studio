# Docker Control Service

Secure Docker operations API for TT-Studio.

## Overview

The Docker Control Service is a FastAPI application that provides controlled access to Docker operations. It runs on the host (not containerized) and replaces the insecure pattern of mounting `/var/run/docker.sock` directly into the backend container.

## Architecture

- **Port**: 8002
- **Authentication**: JWT tokens
- **Location**: Runs on host system
- **Purpose**: Secure Docker operations for TT-Studio backend

## Security Features

1. **JWT Authentication**: All endpoints (except health check) require valid JWT tokens
2. **Image Registry Whitelisting**: Only approved image registries are allowed
3. **Network Restrictions**: Only specific networks can be used
4. **Privileged Mode Blocked**: Privileged containers are never allowed
5. **Resource Limits**: Maximum memory and CPU limits enforced

## API Endpoints

### Health Check (No Auth Required)
- `GET /api/v1/health` - Service health check

### Container Management
- `POST /api/v1/containers/run` - Run a new container
- `POST /api/v1/containers/{id}/stop` - Stop a container
- `POST /api/v1/containers/{id}/remove` - Remove a container
- `GET /api/v1/containers` - List containers
- `GET /api/v1/containers/{id}` - Get container details

### Image Management
- `POST /api/v1/images/pull` - Pull an image
- `DELETE /api/v1/images/{name}:{tag}` - Remove an image
- `GET /api/v1/images` - List images
- `GET /api/v1/images/{name}:{tag}/exists` - Check if image exists

### Network Management
- `POST /api/v1/networks/create` - Create a network
- `DELETE /api/v1/networks/{name}` - Remove a network
- `GET /api/v1/networks` - List networks
- `POST /api/v1/networks/{name}/connect` - Connect container to network
- `POST /api/v1/networks/{name}/disconnect` - Disconnect container from network

## Configuration

### Environment Variables

- `DOCKER_CONTROL_JWT_SECRET` - JWT secret for authentication (required)
- `DEV_MODE` - Enable development mode with hot reload (optional)

### Security Policies (config.py)

```python
ALLOWED_IMAGES = [
    "ghcr.io/tenstorrent/",
    "tenstorrent/",
    "alpine:",
    "ubuntu:",
    "python:",
]

ALLOWED_NETWORKS = [
    "tt_studio_network",
    "bridge",
    "host",
]

MAX_MEMORY = "16g"
MAX_CPUS = 8
```

## Installation

The service is automatically managed by `run.py`. Manual setup:

```bash
cd docker-control-service

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements-api.txt

# Set JWT secret
export DOCKER_CONTROL_JWT_SECRET="your-secret-here"

# Run the service
python api.py
```

## Development

### Running in Development Mode

```bash
export DEV_MODE=true
python api.py
```

This enables:
- Hot reload on code changes
- Detailed logging
- API documentation at http://localhost:8002/api/v1/docs

### API Documentation

Interactive API documentation is available at:
- Swagger UI: http://localhost:8002/api/v1/docs
- ReDoc: http://localhost:8002/api/v1/redoc

## Testing

### Health Check

```bash
curl http://localhost:8002/api/v1/health
```

### Authenticated Request

```python
import jwt
import requests

# Generate token
token = jwt.encode(
    {"service": "tt_studio_backend"},
    "your-secret-here",
    algorithm="HS256"
)

# Make request
headers = {"Authorization": f"Bearer {token}"}
response = requests.get(
    "http://localhost:8002/api/v1/containers",
    headers=headers
)
```

## Logging

Logs are written to `fastapi.log` in the project root when managed by `run.py`.

Log format:
```
%(asctime)s - %(name)s - %(levelname)s - %(message)s
```

## Error Handling

The service returns standard HTTP status codes:
- `200` - Success
- `400` - Bad request (validation error)
- `401` - Unauthorized (missing/invalid JWT)
- `404` - Not found (container/image/network)
- `409` - Conflict (resource already exists)
- `500` - Internal server error

## Security Considerations

1. **JWT Secret**: Use a strong, randomly generated secret in production
2. **Network Isolation**: Service binds to 0.0.0.0 but should only be accessible from localhost/containers
3. **Firewall**: Ensure port 8002 is not exposed externally
4. **Audit Logging**: All operations are logged with timestamps and source information
5. **Resource Limits**: Enforce limits to prevent resource exhaustion

## Integration with TT-Studio

The service is automatically started and managed by `run.py`:

```bash
# Start TT-Studio (includes Docker Control Service)
python3 run.py

# Start without Docker Control Service
python3 run.py --skip-docker-control

# Cleanup (stops service)
python3 run.py --cleanup
```

## Troubleshooting

### Service Won't Start

1. Check if port 8002 is available:
   ```bash
   lsof -i :8002
   ```

2. Check logs:
   ```bash
   tail -f docker-control-service.log
   ```

3. Verify Docker daemon is running:
   ```bash
   docker ps
   ```

### Authentication Errors

1. Verify JWT_SECRET matches between backend and service
2. Check token expiration
3. Verify token format: `Bearer <token>`

### Permission Errors

The service requires access to `/var/run/docker.sock`. Ensure the user running the service has Docker permissions:

```bash
sudo usermod -aG docker $USER
```

## License

Apache-2.0

## Copyright

© 2025 Tenstorrent AI ULC
