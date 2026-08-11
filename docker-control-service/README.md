# Docker Control Service

Secure FastAPI proxy for the Docker operations used by TT-Studio.

## Architecture

Docker Control runs as the `tt_studio_docker_control` service in Compose. It is
attached to `tt_studio_network`, listens on port `8002` inside that bridge, and
has the only `/var/run/docker.sock` mount. The backend reaches it at
`http://docker-control:8002` using JWT authentication.

The service has no host `ports:` mapping. Nothing from this API should be
available at `localhost:8002` or on the host LAN.

## Security features

- JWT authentication is required for all endpoints except health.
- Image registries and Docker networks are allow-listed.
- Privileged containers are rejected.
- Memory and CPU limits are enforced.
- Docker operations are logged.

## API endpoints

### Health

- `GET /api/v1/health` — unauthenticated Docker/ disk health check.

### Containers

- `POST /api/v1/containers/run`
- `POST /api/v1/containers/{id}/stop`
- `POST /api/v1/containers/{id}/remove`
- `GET /api/v1/containers`
- `GET /api/v1/containers/{id}`
- `GET /api/v1/containers/{id}/logs`

### Images

- `POST /api/v1/images/pull`
- `GET /api/v1/images`
- `DELETE /api/v1/images/{name}:{tag}`

### Networks

- `POST /api/v1/networks/create`
- `DELETE /api/v1/networks/{name}`
- `GET /api/v1/networks`
- `POST /api/v1/networks/{name}/connect`
- `POST /api/v1/networks/{name}/disconnect`

## Configuration

- `DOCKER_CONTROL_JWT_SECRET` — shared secret used by backend and service.
- `DOCKER_CONTROL_HOST` — bind address; defaults to `127.0.0.1` for manual
  host-mode runs and is set to `0.0.0.0` only inside the unexposed Compose
  container.
- `DOCKER_CONTROL_PORT` — API port, default `8002`.
- `DOCKER_CONTROL_LOG_FILE`, `STARTUP_LOG_FILE`, and `MODEL_RUN_LOG_FILE` —
  mounted log paths used by the log endpoints.

## Running TT-Studio

The launcher builds and starts this service automatically:

```bash
python3 run.py
python3 run.py --dev
python3 run.py --stop
python3 run.py --skip-docker-control
```

To inspect the service:

```bash
docker compose \
  --env-file .env \
  -f app/docker-compose.yml \
  -f app/docker-compose.prod.yml \
  --profile docker-control ps tt_studio_docker_control

docker compose \
  --env-file .env \
  -f app/docker-compose.yml \
  -f app/docker-compose.prod.yml \
  --profile docker-control logs -f tt_studio_docker_control
```

There is intentionally no `curl localhost:8002` check. Use the Compose health
status or test from the backend network:

```bash
docker compose \
  --env-file .env \
  -f app/docker-compose.yml \
  -f app/docker-compose.prod.yml \
  --profile docker-control exec tt_studio_backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://docker-control:8002/api/v1/health').read().decode())"
```

## Manual development outside Compose

For a host-side manual run, install the requirements and leave the default
bind address on loopback:

```bash
cd docker-control-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-api.txt
export DOCKER_CONTROL_JWT_SECRET="your-secret-here"
python api.py
```

This compatibility path is not used by `run.py` and does not change the
Compose architecture.

## License

Apache-2.0. Copyright © 2026 Tenstorrent AI ULC.
