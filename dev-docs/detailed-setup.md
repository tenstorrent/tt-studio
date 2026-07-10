# TT-Studio — Detailed Setup & Usage

The [main README](../README.md) has the quickstart. This guide covers everything else: the full prerequisites, every `run.py` flag, hardware modes, environment variables, the dev workflow, remote access, and troubleshooting.

## Table of Contents

- [Prerequisites](#prerequisites)
- [run.py flags](#runpy-flags)
- [Hardware modes](#hardware-modes)
- [Services](#services)
- [Environment configuration](#environment-configuration)
- [Dev workflow](#dev-workflow)
- [Remote access](#remote-access)
- [Troubleshooting](#troubleshooting)
- [Documentation map](#documentation-map)

---

## Prerequisites

> Before anything else, complete the [Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html) (driver install, firmware, system config). TT-Studio assumes that's done.

Then make sure you have:

- **Python 3.8+** — [download](https://www.python.org/downloads/)
- **Docker** — [install guide](https://docs.docker.com/engine/install/)
- **Your user in the `docker` group** so you don't need `sudo`:

  ```bash
  sudo usermod -aG docker $USER
  # then log out and back in
  groups | grep docker   # should print "docker"
  ```

- **A Hugging Face token** with access to any gated models you want to run (Llama, etc.). Generate one at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).

---

## run.py flags

Plain `python3 run.py` does the full standard setup:

1. Initializes the `tt-inference-server` submodule
2. Creates `.env` at the repo root from `.env.default` (with placeholder secrets)
3. Auto-detects Tenstorrent hardware (`/dev/tenstorrent`) and applies the right Docker compose overlay
4. Starts the `docker-control-service` on the host (port 8002, JWT-secured)
5. Brings up the backend, frontend, agent, and ChromaDB containers

> ⚠️ `.env.default` ships with placeholder secrets, which is fine for local eval only. For anything beyond your own machine, set your own `JWT_SECRET`, `DJANGO_SECRET_KEY`, and `DOCKER_CONTROL_JWT_SECRET`.

| Flag | Purpose |
| --- | --- |
| `--dev` | Dev mode — applies the `docker-compose.dev-mode.yml` overlay, mounts local source, enables hot reload |
| `--cleanup` | Stop and remove containers (keeps your data) |
| `--cleanup-all` | Cleanup **and** wipe the persistent volume and `.env` — a clean slate |
| `--skip-fastapi` | Skip TT Inference Server FastAPI setup (disables LLM deployment) |
| `--skip-docker-control` | Don't start the docker-control-service |
| `--no-sudo` | Skip sudo prompts (some features won't be available) |
| `--help-env` | Print environment-variable help |
| `--help` | Full CLI reference |

For the complete flag and env-var reference, see [run-py-guide.md](run-py-guide.md).

---

## Hardware modes

TT-Studio composes from a base file plus zero or more **overlays**. `run.py` picks them for you, but it helps to know the matrix:

| File | When applied | What it does |
| --- | --- | --- |
| `app/docker-compose.yml` | Always | Base services: backend, frontend, agent, chroma, network |
| `app/docker-compose.dev-mode.yml` | `python3 run.py --dev` | Mounts local source, swaps in `*-dev` images, enables hot reload |
| `app/docker-compose.tt-hardware.yml` | Auto-applied when `/dev/tenstorrent` is present | Mounts the Tenstorrent device into containers |
| `app/docker-compose.prod.yml` | Production deployments | Production-only overrides |

> **⚠️ Bring-down gotcha:** running `docker compose down` from `app/` with only the base file leaves services orphaned. Always pass **every overlay you used to bring the stack up**:
>
> ```bash
> docker compose \
>   -f app/docker-compose.yml \
>   -f app/docker-compose.dev-mode.yml \
>   -f app/docker-compose.tt-hardware.yml \
>   down
> ```
>
> Or just use `python3 run.py --cleanup`, which handles this for you.

### QB2 / Blackhole notes

`.env.default` ships with `TT_INFERENCE_ARTIFACT_BRANCH=tt_qb2_launch_branch` for QB2 hardware. For other targets, override it to a release tag (e.g. `TT_INFERENCE_ARTIFACT_VERSION=v0.10.0`). See [run-py-guide.md](run-py-guide.md#automatic-tenstorrent-hardware-detection).

---

## Services

| Service | Port | Role | Sub-README |
| --- | --- | --- | --- |
| `tt_studio_frontend` | 3000 | React + Vite UI | [app/frontend/README.md](../app/frontend/README.md) |
| `tt_studio_backend` | 8001 (host) / 8000 (in-container) | Django API: deployment, RAG, models metadata | [app/backend/README.md](../app/backend/README.md) |
| `tt_studio_agent` | 8080 | FastAPI agent — chat orchestration, voice, canvas, pipelines, search | [app/agent/README.md](../app/agent/README.md) |
| `tt_studio_chroma` | — | ChromaDB vector store for RAG | (no README) |
| `docker-control-service` | 8002 (host, not containerized) | JWT-secured Docker daemon proxy — the backend talks to **this**, not `docker.sock` | [docker-control-service/README.md](../docker-control-service/README.md) |
| Deployed models | 7000+ | One port per model container (echo, Llama, YOLO, Whisper, Stable Diffusion, etc.) | [models/README.md](../models/README.md) |

The `docker-control-service` is a recent security change — see [DOCKER_SOCKET_MIGRATION.md](DOCKER_SOCKET_MIGRATION.md) for the before/after architecture and rationale.

### Agent features (`tt_studio_agent`)

The agent service powers several features in the UI:

- **Voice Agent** — speech-in / speech-out chat (Whisper STT + TTS)
- **Canvas Agent** — visual reasoning workspace
- **Pipelines Agent** — chained tool execution
- **Search Agent** — web-augmented answers (needs `TAVILY_API_KEY`)
- **RAG** — query your own documents via ChromaDB

See [app/agent/README.md](../app/agent/README.md) for endpoints, env vars, and LLM-polling behavior.

---

## Environment configuration

`run.py` writes `.env` from `.env.default` (both at the repo root). Treat `.env.default` as the source of truth for what's available.

### Required

| Variable | Purpose |
| --- | --- |
| `HF_TOKEN` | Hugging Face token for model downloads |
| `JWT_SECRET` | JWT secret for backend ↔ model auth |
| `DJANGO_SECRET_KEY` | Django cryptographic operations |
| `DOCKER_CONTROL_JWT_SECRET` | JWT secret the backend uses to talk to docker-control-service |
| `TT_INFERENCE_ARTIFACT_BRANCH` *or* `TT_INFERENCE_ARTIFACT_VERSION` | Which tt-inference-server artifact to use |

### Service URLs

| Variable | Default |
| --- | --- |
| `DOCKER_CONTROL_SERVICE_URL` | `http://host.docker.internal:8002` |
| `BACKEND_API_HOSTNAME` | `tt-studio-backend-api` |
| `FRONTEND_HOST` / `FRONTEND_PORT` / `FRONTEND_TIMEOUT` | `localhost` / `3000` / `60` |

### Optional features

| Variable | Effect |
| --- | --- |
| `TAVILY_API_KEY` | Enables the web-search agent |
| `TTS_API_KEY` | Enables the TTS inference server |
| `VITE_ENABLE_DEPLOYED` | Switches the UI to AI Playground mode (cloud-hosted models) |
| `VITE_ENABLE_RAG_ADMIN` | Enables the RAG admin UI |
| `RAG_ADMIN_PASSWORD` | Required when RAG admin is enabled |
| `CLOUD_*_URL` / `CLOUD_*_AUTH_TOKEN` | Cloud endpoints for Chat UI, YOLO, Whisper, Stable Diffusion (Playground mode only) |

For an annotated walk-through, run `python3 run.py --help-env` or see [run-py-guide.md](run-py-guide.md#environment-configuration).

---

## Dev workflow

### Branching (per [CONTRIBUTING.md](../CONTRIBUTING.md))

- `main` — production, tagged releases only
- `dev` — central integration branch; all feature branches merge here
- Feature branches: `dev-<name>/<feature>` or `dev/<github-issue-number>` (e.g. `dev-jashan/canvas-on-dev`, `dev/1234`)
- **Squash merge** into `dev`
- Release: cut `rc-vX.Y.Z` from `main`, cherry-pick validated commits from `dev`

```bash
git checkout dev
git pull --ff-only origin dev
git checkout -b dev-<yourname>/<feature>
# ... work ...
git push -u origin HEAD
# open a PR against dev (NOT main)
```

### Running in dev mode

```bash
python3 run.py --dev
```

This applies `docker-compose.dev-mode.yml`, mounting `./app/backend` and `./app/frontend` into their containers and switching to `-dev` images. Code edits hot-reload — Django auto-restarts, Vite HMRs the frontend.

To do the same manually without `run.py`:

```bash
docker compose \
  -f app/docker-compose.yml \
  -f app/docker-compose.dev-mode.yml \
  up
# add -f app/docker-compose.tt-hardware.yml if running on TT hardware
```

### Linting, pre-commit, tests

Install dev tooling and pre-commit hooks per [development.md](development.md):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r dev-tools/requirements-dev.txt
pre-commit install --config dev-tools/.pre-commit-config.yaml
pre-commit run --all-files --config dev-tools/.pre-commit-config.yaml
```

SPDX headers are enforced via `dev-tools/add_spdx_header.py` — see [dev-tools/README.md](../dev-tools/README.md).

Backend tests (inside the backend container):

```bash
docker compose exec tt_studio_backend pytest --log-cli-level=INFO docker_control/
```

Frontend dev server / build / lint commands: [app/frontend/README.md](../app/frontend/README.md).

---

## Remote access

When TT-Studio runs on a remote machine, forward the relevant ports over SSH:

```bash
ssh -L 3000:localhost:3000 \
    -L 8001:localhost:8001 \
    -L 8002:localhost:8002 \
    -L 7000-7010:localhost:7000-7010 \
    <user>@<remote>
```

Then open [http://localhost:3000](http://localhost:3000) locally.

To connect a local UI to models hosted on a remote Tenstorrent box without forwarding the whole stack, see [remote-endpoint-setup.md](remote-endpoint-setup.md).

---

## Troubleshooting

Start with [troubleshooting.md](troubleshooting.md) and the [FAQ](FAQ.md). A few common gotchas:

- **`run.py` hangs at a "1 or 2" prompt during model setup** — your HF token has partial Llama access (e.g. 3.3 denied, 3.1 allowed). Pick the variant you have access to and continue.
- **`docker compose down` says "no services"** — you didn't pass every overlay you used at `up` time. See [Hardware modes](#hardware-modes) above.
- **`401 Unauthorized` from docker-control-service** — `DOCKER_CONTROL_JWT_SECRET` mismatch between the backend container and the host service. Re-run `python3 run.py` to regenerate consistent values.
- **Backend can't reach docker-control-service** — verify port 8002 is up on the host (`curl http://localhost:8002/api/v1/health`).
- **Permission denied on Docker** — your user isn't in the `docker` group. See [Prerequisites](#prerequisites).

---

## Documentation map

### Top-level docs

| Doc | Purpose |
| --- | --- |
| [README.md](../README.md) | Quickstart and overview |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Branching strategy, PR standards, versioning |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Community guidelines |

### `/docs`

| Doc | Purpose |
| --- | --- |
| [run-py-guide.md](run-py-guide.md) | Complete `run.py` CLI reference + env-var details |
| [development.md](development.md) | Linting, formatting, pre-commit setup |
| [troubleshooting.md](troubleshooting.md) | Common errors and fixes |
| [FAQ.md](FAQ.md) | General questions |
| [model-interface.md](model-interface.md) | Using deployed models from the UI |
| [HowToRun_vLLM_Models.md](HowToRun_vLLM_Models.md) | vLLM-specific model setup |
| [remote-endpoint-setup.md](remote-endpoint-setup.md) | Connecting to remote Tenstorrent endpoints without local hardware |
| [DOCKER_SOCKET_MIGRATION.md](DOCKER_SOCKET_MIGRATION.md) | Why and how the backend stopped mounting `docker.sock` |

### Component READMEs

| README | Covers |
| --- | --- |
| [app/README.md](../app/README.md) | App stack deployment, compose overlays |
| [app/frontend/README.md](../app/frontend/README.md) | React + Vite + Tailwind, dev/build commands |
| [app/backend/README.md](../app/backend/README.md) | Django API endpoints, custom weights, tests |
| [app/agent/README.md](../app/agent/README.md) | Agent service, LLM polling, env vars, endpoints |
| [docker-control-service/README.md](../docker-control-service/README.md) | Secure Docker API: endpoints, JWT, security policies |
| [dev-tools/README.md](../dev-tools/README.md) | SPDX header tool |
| [models/README.md](../models/README.md) | Model directory layout, JWT auth helper |
| [models/dummy_echo_model/README.md](../models/dummy_echo_model/README.md) | Echo model test fixture |
| [models/licenses/README.md](../models/licenses/README.md) | Model license pointers |
| [app/frontend/src/components/README_API_Info.md](../app/frontend/src/components/README_API_Info.md) | API Info UI feature (per-model API browser) |

### Agent / frontend deep-dives

| Doc | Purpose |
| --- | --- |
| [app/agent/CODE_TOOL_SETUP.md](../app/agent/CODE_TOOL_SETUP.md) | Code-execution tool setup |
| [app/agent/IMPROVEMENTS.md](../app/agent/IMPROVEMENTS.md) | Agent improvement notes |
| [app/frontend/HEADER_TESTING.md](../app/frontend/HEADER_TESTING.md) | SPDX header testing for frontend |
| [app/frontend/.vscode/HEADER_SETUP.md](../app/frontend/.vscode/HEADER_SETUP.md) | VS Code SPDX header automation |
