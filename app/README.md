# TT-Studio Application

The `app/` directory holds the user-facing stack: Django backend, React frontend, agent service, ChromaDB, and the docker-compose files that wire them together.

> For one-command setup, use **`python3 run.py`** from the repo root — it handles env, overlays, hardware detection, and the host-side `docker-control-service`. The instructions below are for running the compose stack directly when you need finer control.
>
> Full `run.py` reference: [docs/run-py-guide.md](../docs/run-py-guide.md)

## Services (from `docker-compose.yml`)

| Service | Purpose | README |
| --- | --- | --- |
| `tt_studio_backend` | Django API (port 8001 on host) | [backend/README.md](backend/README.md) |
| `tt_studio_frontend` | React + Vite UI (port 3000) | [frontend/README.md](frontend/README.md) |
| `tt_studio_agent` | FastAPI agent — voice / canvas / pipelines / search | [agent/README.md](agent/README.md) |
| `tt_studio_chroma` | ChromaDB vector store for RAG | — |

The **`docker-control-service`** ([root-level README](../docker-control-service/README.md)) runs on the **host** (not in compose) on port 8002. The backend talks to it for all Docker operations — see [docs/DOCKER_SOCKET_MIGRATION.md](../docs/DOCKER_SOCKET_MIGRATION.md).

## Compose overlays

TT-Studio composes from a base file plus optional overlays:

| File | When | Effect |
| --- | --- | --- |
| `docker-compose.yml` | Always | Base services |
| `docker-compose.dev-mode.yml` | Dev | Mounts source, swaps to `*-dev` images, hot reload |
| `docker-compose.tt-hardware.yml` | TT hardware present | Mounts `/dev/tenstorrent` into containers |
| `docker-compose.prod.yml` | Production | Production overrides |

### Standard bring-up

```bash
cd app
cp .env.default .env       # then edit JWT_SECRET, HF_TOKEN, DOCKER_CONTROL_JWT_SECRET, etc.
docker compose up
```

### Dev mode (hot reload)

```bash
docker compose \
  -f app/docker-compose.yml \
  -f app/docker-compose.dev-mode.yml \
  up
```

### Dev mode on TT hardware

```bash
docker compose \
  -f app/docker-compose.yml \
  -f app/docker-compose.dev-mode.yml \
  -f app/docker-compose.tt-hardware.yml \
  up
```

Force a rebuild by adding `--build` to any of the above.

### Bring-down

> **You must pass every overlay you used at `up` time** — otherwise `docker compose down` will leave services orphaned.

```bash
docker compose \
  -f app/docker-compose.yml \
  -f app/docker-compose.dev-mode.yml \
  -f app/docker-compose.tt-hardware.yml \
  down
```

Or just use `python3 run.py --cleanup` from the repo root.

## Environment variables

Defined in `app/.env`; template is `app/.env.default`. Run `python3 run.py --help-env` for descriptions, or see the [env-var section in the top-level README](../README.md#environment-configuration).

```bash
cp .env.default .env
# edit JWT_SECRET, HF_TOKEN, DJANGO_SECRET_KEY, DOCKER_CONTROL_JWT_SECRET, ...
```

> The backend runs inside a container and cannot resolve host-relative paths — paths in `.env` must be absolute or use the `TT_STUDIO_ROOT` variable that `run.py` sets.

## Development notes

Local files in `./backend` and `./frontend` are mounted into their containers when the dev overlay is applied, so edits hot-reload (Django auto-restart, Vite HMR). Inside the backend container, you can run the dev server manually for PDB debugging:

```bash
docker compose exec tt_studio_backend ./manage.py runserver 0.0.0.0:8000
```

## Models

For Llama and other model-specific setup, see [docs/HowToRun_vLLM_Models.md](../docs/HowToRun_vLLM_Models.md).
