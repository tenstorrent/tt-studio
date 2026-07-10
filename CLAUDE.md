# TT-Studio

Web interface for running AI models on Tenstorrent hardware. It wraps TT
Inference Server's packaging, containerization, and deployment automation around
TT-Metal model execution. Full deployment needs a Tenstorrent accelerator
(`/dev/tenstorrent`), but the frontend can also run against remote/cloud
inference endpoints with no local hardware.

> Use `python run.py` for everything — `startup.sh` is deprecated. There are no
> git submodules; `run.py` fetches the tt-inference-server artifact.

## Architecture & ports

| Service | Port | Runtime | What it is |
|---|---|---|---|
| Frontend | 3000 | Docker (Nginx in prod) | React 18 + TypeScript + Vite + Tailwind |
| Backend | 8000 | Docker | Django REST API via uvicorn (ASGI + Channels/WebSocket) |
| Inference server | 8001 | Host | FastAPI wrapper over tt-inference-server (`inference-api/`) |
| Agent | 8080 | Docker | LLM agent service (`app/agent/`) |
| ChromaDB | 8111 | Docker | Vector DB for RAG |
| Docker control | 8002 | Host | JWT-secured Docker API wrapper (`docker-control-service/`) |

Containers share the `tt_studio_network` bridge; the backend reaches host
services via `host.docker.internal`. Health checks: backend `GET /up/` and
`GET /models/health/`, inference server `GET /health`, frontend `GET /`.

## Repo layout

- `app/backend/` — Django project. Apps: `api` (settings, ASGI/WSGI, URL routing),
  `docker_control` (image pulls, container deploy, model execution),
  `model_control` (model registry, inference, TTS), `board_control` (hardware
  detection / telemetry), `vector_db_control` (Chroma RAG), `logs_control`,
  `wakeword_control` (voice activation, WebSocket consumers), `shared_config`
  (model/device config, model sync). Routes in `app/backend/api/urls.py`.
- `app/frontend/` — React/TS/Vite app. Source under `src/`:
  `components/`, `pages/`, `providers/`, `contexts/`, `hooks/`, `routes/`,
  `api/`, `lib/`, `types/`. Backend proxy config in `vite.config.ts`.
- `app/agent/` — agent service. `inference-api/` — FastAPI inference server.
- `docker-control-service/` — standalone Docker control service.
- `models/` — model definitions/config. `dev-tools/` — license/header tooling.
- `dev-docs/` — developer docs. `.cursor/rules/` — editor rules.
  `.claude/skills/` — assistant skills.

## Common commands

```bash
python run.py                 # full setup + start (venv, .env, artifact, Docker)
python run.py --dev           # dev mode: hot-reload frontend & backend, mount source
python run.py --cleanup       # stop containers, keep the persistent volume
python run.py --cleanup-all   # wipe containers, volumes, and .env
python run.py --check-headers # report files missing SPDX headers
```

Frontend (in `app/frontend/`): `npm run dev`, `npm run build`,
`npm run lint` / `lint:fix`, `npm run type-check`.
Backend (in `app/backend/`): `./manage.py runserver 0.0.0.0:8000`, and tests via
`pytest` (e.g. `pytest model_control/test_model_api.py -v`).

## Conventions

- **SPDX headers are mandatory on every new code file** (`.py`/`.ts`/`.tsx`/`.js`):
  ```
  # SPDX-License-Identifier: Apache-2.0
  # SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
  ```
  Use `python run.py --add-headers` or `npm run header:fix` to apply.
- **Pre-commit**: ruff lint + format (config in `dev-tools/`). Frontend also
  enforces ESLint + header checks.
- **Git workflow**: branch off `dev` as `<username>/<feature>`; PRs target `dev`
  (squash-merge); `main` is tagged production only. Follow the `feature-branch-pr`
  skill for the full flow.

## Environment

`.env` lives at the repo root, auto-created from `.env.default`. Key vars:
`HF_TOKEN` (gated model downloads), `JWT_SECRET`, `DJANGO_SECRET_KEY`,
`TAVILY_API_KEY` (agent search), `TT_INFERENCE_ARTIFACT_VERSION`, and the
`CLOUD_*` endpoint/token vars used for deployed/remote-endpoint mode
(`VITE_ENABLE_DEPLOYED=true`).

## Docs & assistant config

- Developer guides: [Setup](dev-docs/detailed-setup.md),
  [run.py guide](dev-docs/run-py-guide.md), [FAQ](dev-docs/FAQ.md),
  [Troubleshooting](dev-docs/troubleshooting.md),
  [Model interface](dev-docs/model-interface.md),
  [vLLM models](dev-docs/HowToRun_vLLM_Models.md). Also [README](README.md),
  [Contributing](CONTRIBUTING.md), [Agent](app/agent/README.md).
- `.cursor/rules/` — Cursor rules: `general`, `backend`, `frontend`,
  `docker-deployment`, `ai-models`, `project-overview`.
- `.claude/skills/` — skills: `tt-studio-overview` (project map),
  `feature-branch-pr` (branch/PR workflow), `tt-studio-debug-bundle` (log triage).
