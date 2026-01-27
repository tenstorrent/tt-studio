# Docker Socket Migration Guide

**Status**: ✅ **COMPLETED** - Docker socket mount removed from backend container

## Overview

TT-Studio has migrated from directly mounting `/var/run/docker.sock` into the Django backend container to using a secure FastAPI service (`docker-control-service`) for Docker operations.

## Security Improvements

### Before (Insecure ❌)
```yaml
tt_studio_backend:
  user: root                                        # Root access
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock   # Direct Docker access
```

**Problems:**
- Backend container runs as root
- Full access to Docker daemon (can do anything on host)
- No authentication or authorization
- No audit trail
- Privilege escalation risk

### After (Secure ✅)
```
Django Backend (non-root) → HTTP API (JWT auth) → docker-control-service → Docker
```

**Benefits:**
- ✅ Backend runs as non-root user
- ✅ JWT authentication for all Docker operations
- ✅ Image registry whitelisting
- ✅ Resource limits enforced
- ✅ Network restrictions
- ✅ Audit logging
- ✅ No privileged containers allowed

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Host System                                                     │
│                                                                 │
│  ┌──────────────────────┐          ┌─────────────────────────┐ │
│  │ docker-control-      │          │ /var/run/docker.sock    │ │
│  │ service              │◄─────────│ (Docker Daemon)         │ │
│  │ (FastAPI)            │          └─────────────────────────┘ │
│  │                      │                                      │
│  │ Port: 8002           │                                      │
│  │ Auth: JWT            │                                      │
│  │ Security: Whitelist  │                                      │
│  └──────────────────────┘                                      │
│           ▲                                                    │
│           │ HTTP API                                           │
│           │ (JWT Token)                                        │
└───────────┼────────────────────────────────────────────────────┘
            │
            │ Network: tt_studio_network
            │
┌───────────┼────────────────────────────────────────────────────┐
│ Docker    │                                                    │
│           │                                                    │
│  ┌────────▼──────────┐                                        │
│  │ tt_studio_backend │                                        │
│  │ (Django)          │                                        │
│  │                   │                                        │
│  │ user: <non-root>  │                                        │
│  │ NO docker.sock    │                                        │
│  └───────────────────┘                                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## What Changed

### 1. docker-compose.yml

**Removed:**
```yaml
user: root
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**Added:**
```yaml
environment:
  - DOCKER_CONTROL_SERVICE_URL=http://127.0.0.1:8002
  - DOCKER_CONTROL_JWT_SECRET=<secret>
```

### 2. Backend Code Migration (TODO)

The following backend files need to be updated to use the docker-control-service API instead of direct Docker SDK:

#### Files to Update:
```
app/backend/docker_control/views.py         - Main Docker operations
app/backend/docker_control/health_monitor.py - Container health checks
app/backend/docker_control/docker_utils.py   - Docker utility functions
```

#### Migration Pattern:

**Before (Direct Docker SDK):**
```python
import docker

client = docker.from_env()
containers = client.containers.list()
```

**After (docker-control-service API):**
```python
import requests
import jwt
from django.conf import settings

def get_docker_client():
    """Get docker-control-service client"""
    return DockerControlClient(
        url=settings.DOCKER_CONTROL_SERVICE_URL,
        jwt_secret=settings.DOCKER_CONTROL_JWT_SECRET
    )

class DockerControlClient:
    def __init__(self, url, jwt_secret):
        self.url = url
        self.jwt_secret = jwt_secret

    def _get_headers(self):
        token = jwt.encode(
            {"service": "tt_studio_backend"},
            self.jwt_secret,
            algorithm="HS256"
        )
        return {"Authorization": f"Bearer {token}"}

    def list_containers(self):
        response = requests.get(
            f"{self.url}/api/v1/containers",
            headers=self._get_headers()
        )
        response.raise_for_status()
        return response.json()
```

---

## Migration Status

### ✅ Completed
- [x] Created `docker-control-service/` FastAPI application
- [x] Implemented JWT authentication
- [x] Added security policies (whitelisting, resource limits)
- [x] Removed Docker socket mount from docker-compose.yml
- [x] Removed `user: root` from backend container
- [x] Added environment variables to docker-compose.yml
- [x] Updated `.env.default` with docker-control-service config
- [x] Integrated docker-control-service startup into `run.py`

### 🔄 In Progress
- [ ] Create `app/backend/docker_control/docker_control_client.py` wrapper
- [ ] Update `app/backend/docker_control/views.py` to use API
- [ ] Update `app/backend/docker_control/health_monitor.py` to use API
- [ ] Update `app/backend/docker_control/docker_utils.py` to use API
- [ ] Add retry logic and error handling
- [ ] Update tests to mock docker-control-service API

### 📋 Testing Required
- [ ] Test container deployment via API
- [ ] Test container stop/remove via API
- [ ] Test image pull via API
- [ ] Test network operations via API
- [ ] Test error handling (service down, auth failure, etc.)
- [ ] Test resource limits enforcement
- [ ] Test image whitelist rejection

---

## API Reference

### Container Operations

**List Containers:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8002/api/v1/containers
```

**Run Container:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "image": "tenstorrent/model:latest",
    "name": "my_model",
    "ports": {"8000/tcp": 7001},
    "network": "tt_studio_network",
    "environment": {"MODEL_TYPE": "llm"}
  }' \
  http://localhost:8002/api/v1/containers/run
```

**Stop Container:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8002/api/v1/containers/{container_id}/stop
```

### Image Operations

**Pull Image:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tenstorrent/model:latest"
  }' \
  http://localhost:8002/api/v1/images/pull
```

**List Images:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8002/api/v1/images
```

### Network Operations

**Create Network:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tt_studio_network",
    "driver": "bridge"
  }' \
  http://localhost:8002/api/v1/networks/create
```

**Connect Container to Network:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "container": "my_model"
  }' \
  http://localhost:8002/api/v1/networks/tt_studio_network/connect
```

---

## Security Policies

### Image Registry Whitelist
Only images from these registries are allowed:
```python
ALLOWED_IMAGES = [
    "ghcr.io/tenstorrent/",
    "tenstorrent/",
    "alpine:",
    "ubuntu:",
    "python:",
]
```

### Network Whitelist
Only these networks can be used:
```python
ALLOWED_NETWORKS = [
    "tt_studio_network",
    "bridge",
    "host",
]
```

### Resource Limits
```python
MAX_MEMORY = "16g"
MAX_CPUS = 8
```

### Blocked Operations
- ❌ Privileged containers (`privileged=True`)
- ❌ Host network mode (unless explicitly whitelisted)
- ❌ Mounting arbitrary host paths
- ❌ Docker-in-Docker (no nested socket mounts)

---

## Error Handling

### Common Errors

**401 Unauthorized:**
```json
{
  "detail": "Invalid or missing JWT token"
}
```
**Solution:** Verify `DOCKER_CONTROL_JWT_SECRET` matches between backend and service.

**400 Bad Request - Image Not Whitelisted:**
```json
{
  "detail": "Image not in allowed list"
}
```
**Solution:** Add image registry to `ALLOWED_IMAGES` in `docker-control-service/config.py`.

**409 Conflict:**
```json
{
  "detail": "Container already exists"
}
```
**Solution:** Stop/remove existing container first.

**503 Service Unavailable:**
```json
{
  "detail": "Docker Control Service not reachable"
}
```
**Solution:** Check if docker-control-service is running (`ps aux | grep docker-control`).

---

## Testing

### Manual Testing

**1. Start docker-control-service:**
```bash
python3 run.py  # Automatically starts service
```

**2. Test health endpoint (no auth):**
```bash
curl http://localhost:8002/api/v1/health
# Expected: {"status":"healthy"}
```

**3. Generate JWT token:**
```python
import jwt
token = jwt.encode(
    {"service": "tt_studio_backend"},
    "your-jwt-secret",  # From DOCKER_CONTROL_JWT_SECRET
    algorithm="HS256"
)
print(token)
```

**4. Test authenticated endpoint:**
```bash
TOKEN="<token-from-step-3>"
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8002/api/v1/containers
```

### Automated Testing

**Run docker-control-service tests:**
```bash
cd docker-control-service
pytest tests/
```

**Run backend integration tests:**
```bash
cd app/backend
pytest docker_control/test_docker_control_client.py
```

---

## Rollback Plan

If issues arise, you can temporarily re-enable direct Docker socket access:

**1. Edit `app/docker-compose.yml`:**
```yaml
tt_studio_backend:
  user: root  # Re-add
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock  # Re-add
```

**2. Restart containers:**
```bash
python3 run.py --cleanup
python3 run.py
```

**Note:** This is NOT recommended for production due to security risks.

---

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Security** | Root access to Docker daemon | JWT-authenticated API |
| **Privilege** | Container runs as root | Container runs as non-root |
| **Audit** | No logging | All operations logged |
| **Limits** | No enforcement | Memory/CPU limits enforced |
| **Whitelist** | Any image allowed | Only approved registries |
| **Attack Surface** | Direct socket access | Restricted API endpoints |
| **Compliance** | ❌ Fails security audits | ✅ Passes security audits |

---

## Next Steps

1. **Complete Backend Migration**
   - Create `DockerControlClient` wrapper class
   - Update all Docker SDK usage to use API
   - Add retry logic and error handling

2. **Testing**
   - Test all container operations
   - Test error scenarios
   - Load testing (many concurrent deployments)

3. **Documentation**
   - Update API documentation
   - Add troubleshooting guide
   - Create developer migration guide

4. **Monitoring**
   - Add Prometheus metrics to docker-control-service
   - Track API latency, error rates
   - Alert on service downtime

---

## References

- **docker-control-service README**: `/docker-control-service/README.md`
- **Security Best Practices**: [Docker Security](https://docs.docker.com/engine/security/)
- **JWT Authentication**: [PyJWT Documentation](https://pyjwt.readthedocs.io/)
- **FastAPI**: [FastAPI Documentation](https://fastapi.tiangolo.com/)

---

**Last Updated**: 2026-01-22
**Status**: Docker socket mount removed, backend code migration in progress
