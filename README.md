[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tenstorrent/tt-studio)

<p align="center">
  <img src="https://raw.githubusercontent.com/tenstorrent/tt-metal/main/docs/source/common/images/favicon.png" width="120" height="120" />
</p>

<h1 align="center">TT-Studio</h1>

> Web UI for deploying and interacting with AI models on Tenstorrent hardware. Combines [TT Inference Server](https://github.com/tenstorrent/tt-inference-server) packaging with [TT-Metal](https://github.com/tenstorrent-metal/tt-metal) execution, fronted by a Django + React + agent stack.
>
> **No hardware?** Connect to [remote endpoints](docs/remote-endpoint-setup.md) running models on Tenstorrent cards elsewhere.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Hardware Modes](#hardware-modes)
- [Services](#services)
- [Environment Configuration](#environment-configuration)
- [Dev Workflow](#dev-workflow)
- [Remote Access](#remote-access)
- [Troubleshooting](#troubleshooting)
- [Documentation Map](#documentation-map)
- [Community & License](#community--license)

---

## Prerequisites

> **Before anything else**, complete the [Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html) (driver install, firmware, system config). TT-Studio assumes that's done.

Then ensure you have:

- **Python 3.8+** — [download](https://www.python.org/downloads/)
- **Docker** — [install guide](https://docs.docker.com/engine/install/)
- **Your user in the `docker` group** so you don't need `sudo`:

  ```bash
  sudo usermod -aG docker $USER
  # then log out and back in
  groups | grep docker   # should print "docker"
  ```

- **A Hugging Face token** with access to any gated models you want to run (Llama, etc.). Generate at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).

---

## Quickstart

The fastest path is **Easy Mode** — one prompt (your HF token), defaults for everything else:

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py --easy
```

This will:

1. Initialize the `tt-inference-server` submodule
2. Create `app/.env` from `app/.env.default` (with default placeholder secrets)
3. Auto-detect Tenstorrent hardware (`/dev/tenstorrent`) and apply the right Docker compose overlay
4. Start the `docker-control-service` on host (port 8002, JWT-secured)
5. Bring up the backend, frontend, agent, and ChromaDB containers

Once it's up:

| Service           | URL                                            |
| ----------------- | ---------------------------------------------- |
| TT-Studio UI      | [http://localhost:3000](http://localhost:3000) |
| Django backend    | [http://localhost:8001](http://localhost:8001) |
| Docker control    | [http://localhost:8002](http://localhost:8002) |
| Deployed models   | `localhost:7000+` (one port per model)         |

To stop everything:

```bash
python3 run.py --cleanup        # stop and remove containers (preserves data)
python3 run.py --cleanup-all    # also wipe persistent volume and .env
```

> ⚠️ **Easy Mode is not secure** — it uses default secrets and is intended for local dev / quick eval only. For production use the standard flow (`python3 run.py` without `--easy`) and provide your own `JWT_SECRET`, `DJANGO_SECRET_KEY`, and `DOCKER_CONTROL_JWT_SECRET`. Full reference: [docs/run-py-guide.md](docs/run-py-guide.md).

### `run.py` flags at a glance

| Flag | Purpose |
| --- | --- |
| `--easy` | One-prompt setup (HF token only), all other values defaulted |
| `--dev` | Dev mode — applies `docker-compose.dev-mode.yml` overlay, hot reload, suggested defaults |
| `--cleanup` | Stop and remove containers |
| `--cleanup-all` | Cleanup + remove persistent volume and `.env` |
| `--skip-fastapi` | Skip TT Inference Server FastAPI setup (disables LLM deployment) |
| `--skip-docker-control` | Don't start the docker-control-service |
| `--no-sudo` | Skip sudo prompts (some features will be unavailable) |
| `--help-env` | Print environment variable help |
| `--help` | Full CLI reference |

---

## Hardware Modes

TT-Studio composes from a base file plus zero or more **overlays**. `run.py` picks them for you, but it's worth knowing the matrix:

| File | When applied | What it does |
| --- | --- | --- |
| `app/docker-compose.yml` | Always | Base services: backend, frontend, agent, chroma, network |
| `app/docker-compose.dev-mode.yml` | `python3 run.py --dev` | Mounts local source, swaps in `*-dev` images, enables hot reload |
| `app/docker-compose.tt-hardware.yml` | Auto-applied when `/dev/tenstorrent` is present | Mounts the Tenstorrent device into containers (also enable manually via `--tt-hardware`) |
| `app/docker-compose.prod.yml` | Production deployments | Production-only overrides |

> **⚠️ Bring-down gotcha:** running `docker compose down` from `app/` with only the base file will leave services orphaned. Always pass **every overlay that was used to bring the stack up**, e.g.:
>
> ```bash
> docker compose \
>   -f app/docker-compose.yml \
>   -f app/docker-compose.dev-mode.yml \
>   -f app/docker-compose.tt-hardware.yml \
>   down
> ```
>
> Or just use `python3 run.py --cleanup`, which handles this correctly.

### QB2 / Blackhole notes

`app/.env.default` ships with `TT_INFERENCE_ARTIFACT_BRANCH=tt_qb2_launch_branch` for QB2 hardware. For other targets, override it to a release tag (e.g. `TT_INFERENCE_ARTIFACT_VERSION=v0.10.0`). See [docs/run-py-guide.md](docs/run-py-guide.md#automatic-tenstorrent-hardware-detection).

---

## Services

| Service | Port | Role | Sub-README |
| --- | --- | --- | --- |
| `tt_studio_frontend` | 3000 | React + Vite UI | [app/frontend/README.md](app/frontend/README.md) |
| `tt_studio_backend` | 8001 (host) / 8000 (in-container) | Django API: deployment, RAG, models metadata | [app/backend/README.md](app/backend/README.md) |
| `tt_studio_agent` | 8080 | FastAPI agent — chat orchestration, voice, canvas, pipelines, search | [app/agent/README.md](app/agent/README.md) |
| `tt_studio_chroma` | — | ChromaDB vector store for RAG | (no README) |
| `docker-control-service` | 8002 (host, not containerized) | JWT-secured Docker daemon proxy — backend talks to **this**, not `docker.sock` | [docker-control-service/README.md](docker-control-service/README.md) |
| Deployed models | 7000+ | One port per model container (echo, Llama, YOLO, Whisper, Stable Diffusion, etc.) | [models/README.md](models/README.md) |

The `docker-control-service` is a recent security change — see [docs/DOCKER_SOCKET_MIGRATION.md](docs/DOCKER_SOCKET_MIGRATION.md) for the before/after architecture and rationale.

### Agent features (`tt_studio_agent`)

The agent service exposes several feature surfaces in the UI:

- **Voice Agent** — speech-in / speech-out chat (Whisper STT + TTS)
- **Canvas Agent** — visual reasoning workspace
- **Pipelines Agent** — chained tool execution
- **Search Agent** — web-augmented answers (requires `TAVILY_API_KEY`)
- **RAG** — query your documents via ChromaDB

See [app/agent/README.md](app/agent/README.md) for endpoints, env vars, and the LLM-polling behavior.

---

## Environment Configuration

`run.py` writes `app/.env` from `app/.env.default`. Treat `.env.default` as the source of truth for available variables.

### Required

| Variable | Purpose |
| --- | --- |
| `HF_TOKEN` | Hugging Face token for model downloads |
| `JWT_SECRET` | JWT secret for backend ↔ model auth |
| `DJANGO_SECRET_KEY` | Django cryptographic operations |
| `DOCKER_CONTROL_JWT_SECRET` | JWT secret backend uses to talk to docker-control-service |
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
| `TAVILY_API_KEY` | Enables web-search agent |
| `TTS_API_KEY` | Enables the TTS inference server |
| `VITE_ENABLE_DEPLOYED` | Switches UI to AI Playground mode (cloud-hosted models) |
| `VITE_ENABLE_RAG_ADMIN` | Enables the RAG admin UI |
| `RAG_ADMIN_PASSWORD` | Required when RAG admin is enabled |
| `CLOUD_*_URL` / `CLOUD_*_AUTH_TOKEN` | Cloud endpoints for Chat UI, YOLO, Whisper, Stable Diffusion (Playground mode only) |

For an annotated walk-through, run `python3 run.py --help-env` or see [docs/run-py-guide.md#environment-configuration](docs/run-py-guide.md#environment-configuration).

---

## Dev Workflow

### Branching (per [CONTRIBUTING.md](CONTRIBUTING.md))

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
# open PR against dev (NOT main)
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

Install dev tooling and pre-commit hooks per [docs/development.md](docs/development.md):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r dev-tools/requirements-dev.txt
pre-commit install --config dev-tools/.pre-commit-config.yaml
pre-commit run --all-files --config dev-tools/.pre-commit-config.yaml
```

SPDX headers are enforced via `dev-tools/add_spdx_header.py` — see [dev-tools/README.md](dev-tools/README.md).

Backend tests (inside the backend container):

```bash
docker compose exec tt_studio_backend pytest --log-cli-level=INFO docker_control/
```

Frontend dev server / build / lint commands: [app/frontend/README.md](app/frontend/README.md).

---

## Remote Access

When TT-Studio runs on a remote machine, forward the relevant ports over SSH:

```bash
ssh -L 3000:localhost:3000 \
    -L 8001:localhost:8001 \
    -L 8002:localhost:8002 \
    -L 7000-7010:localhost:7000-7010 \
    <user>@<remote>
```

Then open [http://localhost:3000](http://localhost:3000) locally.

For connecting a local UI to models hosted on a remote Tenstorrent box without forwarding the whole stack, see [docs/remote-endpoint-setup.md](docs/remote-endpoint-setup.md).

---

## Troubleshooting

Start with [docs/troubleshooting.md](docs/troubleshooting.md) and the [FAQ](docs/FAQ.md). A few common gotchas:

- **`run.py` hangs at a "1 or 2" prompt during model setup** — your HF token has partial Llama access (e.g. 3.3 denied, 3.1 allowed). Pick the variant you have access to and continue.
- **`docker compose down` says "no services"** — you didn't pass every overlay you used at `up` time. See [Hardware Modes](#hardware-modes) above.
- **`401 Unauthorized` from docker-control-service** — `DOCKER_CONTROL_JWT_SECRET` mismatch between backend container and the host service. Re-run `python3 run.py` to regenerate consistent values.
- **Backend can't reach docker-control-service** — verify port 8002 is up on the host (`curl http://localhost:8002/api/v1/health`).
- **Permission denied on Docker** — your user isn't in the `docker` group. See [Prerequisites](#prerequisites).

---

## Documentation Map

### Top-level docs

| Doc | Purpose |
| --- | --- |
| [README.md](README.md) | This file |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branching strategy, PR standards, versioning |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community guidelines |

### `/docs`

| Doc | Purpose |
| --- | --- |
| [docs/run-py-guide.md](docs/run-py-guide.md) | Complete `run.py` CLI reference + env-var details |
| [docs/development.md](docs/development.md) | Linting, formatting, pre-commit setup |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common errors and fixes |
| [docs/FAQ.md](docs/FAQ.md) | General questions |
| [docs/model-interface.md](docs/model-interface.md) | Using deployed models from the UI |
| [docs/HowToRun_vLLM_Models.md](docs/HowToRun_vLLM_Models.md) | vLLM-specific model setup |
| [docs/remote-endpoint-setup.md](docs/remote-endpoint-setup.md) | Connecting to remote Tenstorrent endpoints without local hardware |
| [docs/DOCKER_SOCKET_MIGRATION.md](docs/DOCKER_SOCKET_MIGRATION.md) | Why and how the backend stopped mounting `docker.sock` |

### Component READMEs

| README | Covers |
| --- | --- |
| [app/README.md](app/README.md) | App stack deployment, compose overlays |
| [app/frontend/README.md](app/frontend/README.md) | React + Vite + Tailwind, dev/build commands |
| [app/backend/README.md](app/backend/README.md) | Django API endpoints, custom weights, tests |
| [app/agent/README.md](app/agent/README.md) | Agent service, LLM polling, env vars, endpoints |
| [docker-control-service/README.md](docker-control-service/README.md) | Secure Docker API: endpoints, JWT, security policies |
| [dev-tools/README.md](dev-tools/README.md) | SPDX header tool and `run.py --easy` pointer |
| [models/README.md](models/README.md) | Model directory layout, JWT auth helper |
| [models/dummy_echo_model/README.md](models/dummy_echo_model/README.md) | Echo model test fixture |
| [models/licenses/README.md](models/licenses/README.md) | Model license pointers |
| [app/frontend/src/components/README_API_Info.md](app/frontend/src/components/README_API_Info.md) | API Info UI feature (per-model API browser) |

### Agent / frontend deep-dives

| Doc | Purpose |
| --- | --- |
| [app/agent/CODE_TOOL_SETUP.md](app/agent/CODE_TOOL_SETUP.md) | Code-execution tool setup |
| [app/agent/IMPROVEMENTS.md](app/agent/IMPROVEMENTS.md) | Agent improvement notes |
| [app/frontend/HEADER_TESTING.md](app/frontend/HEADER_TESTING.md) | SPDX header testing for frontend |
| [app/frontend/.vscode/HEADER_SETUP.md](app/frontend/.vscode/HEADER_SETUP.md) | VS Code SPDX header automation |

---

## Community & License

- **Issues / feature requests** — [GitHub Issues](https://github.com/tenstorrent/tt-studio/issues)
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md)
- **License** — Apache-2.0 (© Tenstorrent AI ULC)
