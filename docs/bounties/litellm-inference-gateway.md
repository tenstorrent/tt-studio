# Bounty: LiteLLM Inference Gateway for TT Studio

## Background

TT Studio currently routes inference requests directly from the Django backend to individual vLLM containers on the `tt_studio_network`. Each deployed model gets its own container URL (e.g. `http://container:7000/v1/chat/completions`), and the backend tracks these in an in-memory deploy cache (`model_control/model_utils.py:get_deploy_cache()`).

This works, but creates problems as deployments scale:

- **No stable front-door URL** — every model gets a different `internal_url`, so the backend must resolve and route per-request.
- **No endpoint registry** — model URLs live only in the deploy cache; there's no persistent, queryable store of "what LLM endpoints are available."
- **No unified logging/spend tracking** — each vLLM container is an island with no shared request history.
- **Fragile across restarts** — if a container restarts with a different hostname/port, the deploy cache goes stale until the next health check cycle.

LiteLLM Proxy solves all of these by providing a single OpenAI-compatible gateway that routes to multiple backends, persists endpoint configs in Postgres, and logs every request.

## What Success Looks Like
!# TODO Write more clear sucess criteria 

### Stage 1 — Compose Stack Bring-Up

**Add a `docker-compose.gateway.yml` override** (in `app/`) that layers these services onto the existing `tt_studio_network`:

```yaml
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4000:4000"
    networks:
      - tt_studio_network

  gateway_postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    networks:
      - tt_studio_network
```

Acceptance criteria:

- [ ] `docker compose -f docker-compose.yml -f docker-compose.gateway.yml up` starts LiteLLM + Postgres on the shared `tt_studio_network` (external, already created by TT Studio).
- [ ] LiteLLM healthcheck passes: `curl http://localhost:4000/health` returns 200.
- [ ] Postgres data persists across `docker compose down && docker compose up` via a named volume.
- [ ] LiteLLM connects to Postgres for request logging and model config storage (via `DATABASE_URL` env var).
- [ ] LiteLLM reads its model list from a mounted config file (`app/gateway/litellm_config.yaml`), not baked into the image.
- [ ] Config file and env vars are committed to the repo (secrets via `.env`, not hardcoded).

### Stage 2 — Backend Integration

**Wire the TT Studio backend to call LiteLLM instead of individual vLLM containers.**

The current flow (`model_control/views.py:InferenceView.post`):
```
Frontend → Backend → http://{container}:{port}/v1/chat/completions
```

The new flow:
```
Frontend → Backend → http://litellm:4000/v1/chat/completions
```

Acceptance criteria:

- [ ] `InferenceView` and `InferenceCloudView` route through `http://litellm:4000/v1/...` when the gateway is enabled.
- [ ] Gateway is **opt-in** via an env var (e.g. `USE_LITELLM_GATEWAY=true` in `.env`). When disabled, existing direct-to-container routing works unchanged.
- [ ] Streaming (`StreamingHttpResponse`) works end-to-end through LiteLLM — no regressions in the chat UI.
- [ ] Model name resolution still works: the `model` field sent to LiteLLM matches a model alias defined in `litellm_config.yaml`.
- [ ] Add `LITELLM_API_BASE` and `LITELLM_API_KEY` to `.env.default` and the backend service's `environment` list in `docker-compose.yml`.
- [ ] Health check in `model_utils.py:health_check()` can target the LiteLLM `/health` endpoint when gateway mode is on.

### Stage 3 — Endpoint Management API

**Provide an easy way to add, list, and remove LLM endpoints at runtime** without editing config files or restarting containers.

Acceptance criteria:

- [ ] Expose Django REST views (or a lightweight FastAPI sidecar) with these operations:
  - `GET /gateway/endpoints/` — list all registered model endpoints (reads from LiteLLM's `/model/info` or Postgres).
  - `POST /gateway/endpoints/` — register a new model endpoint (calls LiteLLM's `/model/new` API).
  - `DELETE /gateway/endpoints/{model_id}/` — remove a model endpoint (calls LiteLLM's `/model/delete` API).
- [ ] Endpoints persist in Postgres — survive full stack restarts.
- [ ] The frontend model selector reflects dynamically-added endpoints (at minimum, new endpoints appear after a page refresh).
- [ ] When a new vLLM container is deployed via TT Studio's existing `DeployView`, automatically register it with LiteLLM as a new endpoint.
- [ ] Provide a simple seed script or management command (`python manage.py seed_gateway`) that populates LiteLLM with entries from `models_from_inference_server.json` for any currently-deployed models.

## Guidance & Starting Points

### Key Files to Modify

| File | What to do |
|------|-----------|
| `app/docker-compose.gateway.yml` | **Create.** LiteLLM + Postgres service definitions. |
| `app/gateway/litellm_config.yaml` | **Create.** Initial model routing config. |
| `app/.env.default` | **Edit.** Add `USE_LITELLM_GATEWAY`, `LITELLM_API_KEY`, `LITELLM_API_BASE`, `GATEWAY_POSTGRES_PASSWORD`. |
| `app/docker-compose.yml` | **Edit.** Add new env vars to `tt_studio_backend` environment list. |
| `app/backend/model_control/views.py` | **Edit.** Add gateway routing branch to `InferenceView` and `InferenceCloudView`. |
| `app/backend/model_control/model_utils.py` | **Edit.** Add `stream_response_via_gateway()` helper alongside existing `stream_response_from_external_api()`. |
| `app/backend/docker_control/views.py` | **Edit.** After `DeployView` starts a container, register the endpoint with LiteLLM. |
| `run.py` | **Edit.** Add `--gateway` flag to optionally include `docker-compose.gateway.yml` in the compose command. |

### LiteLLM Config Skeleton

```yaml
# app/gateway/litellm_config.yaml
model_list:
  - model_name: "llama-3.3-70b"
    litellm_params:
      model: "openai/meta-llama/Llama-3.3-70B-Instruct"
      api_base: "http://vllm-container:7000/v1"
      api_key: "os.environ/JWT_SECRET"

general_settings:
  database_url: "os.environ/DATABASE_URL"
  master_key: "os.environ/LITELLM_API_KEY"
```

### Compose Override Skeleton

```yaml
# app/docker-compose.gateway.yml
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    hostname: litellm
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://litellm:${GATEWAY_POSTGRES_PASSWORD}@gateway_postgres:5432/litellm
      - LITELLM_MASTER_KEY=${LITELLM_API_KEY}
    volumes:
      - ./gateway/litellm_config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    depends_on:
      gateway_postgres:
        condition: service_healthy
    networks:
      - tt_studio_network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  gateway_postgres:
    image: postgres:16-alpine
    hostname: gateway-postgres
    environment:
      - POSTGRES_USER=litellm
      - POSTGRES_PASSWORD=${GATEWAY_POSTGRES_PASSWORD}
      - POSTGRES_DB=litellm
    volumes:
      - gateway_pg_data:/var/lib/postgresql/data
    networks:
      - tt_studio_network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U litellm"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  gateway_pg_data:

networks:
  tt_studio_network:
    external: true
    name: tt_studio_network
```

### Existing Patterns to Follow

- **Network**: Everything joins `tt_studio_network` (external, pre-created). See `app/docker-compose.yml:147-153`.
- **Env vars**: Defined in `app/.env`, defaults in `app/.env.default`. Backend reads them from `docker-compose.yml` environment list.
- **Streaming**: `model_utils.py:stream_response_from_external_api()` uses `requests.post(..., stream=True)` with `iter_content(chunk_size=None)`. The gateway helper should follow the same pattern.
- **Healthchecks**: Every service has a compose-level healthcheck. Follow the `tt_studio_chroma` pattern.
- **Feature flags**: Use env var toggles (like `VITE_ENABLE_DEPLOYED`) — don't break existing non-gateway setups.

### LiteLLM API Endpoints You'll Need

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/chat/completions` | Forward inference requests (OpenAI-compatible) |
| `GET /health` | Healthcheck |
| `GET /model/info` | List all registered models |
| `POST /model/new` | Register a new model endpoint at runtime |
| `POST /model/delete` | Remove a model endpoint |
| `GET /spend/logs` | Query request history (bonus) |

Docs: https://docs.litellm.ai/docs/proxy/configs

## Validation Plan

### Stage 1 — Stack Comes Up Clean

```bash
# From repo root
cd app
docker compose -f docker-compose.yml -f docker-compose.gateway.yml up -d

# Verify
curl http://localhost:4000/health          # → {"status":"healthy"}
docker compose exec gateway_postgres pg_isready -U litellm  # → accepting connections

# Restart persistence test
docker compose down
docker compose -f docker-compose.yml -f docker-compose.gateway.yml up -d
# Postgres data should survive (check litellm tables exist)
```

### Stage 2 — Inference Routes Through Gateway

```bash
# With USE_LITELLM_GATEWAY=true in .env and a model deployed:
curl -X POST http://localhost:8000/models-api/inference/ \
  -H "Content-Type: application/json" \
  -d '{"deploy_id":"<id>","messages":[{"role":"user","content":"Hello"}],"stream":true}'
# → Streaming response, same as before but routed via LiteLLM

# Verify in LiteLLM logs:
docker compose logs litellm | grep "chat/completions"
```

### Stage 3 — Endpoints Manageable at Runtime

```bash
# List endpoints
curl http://localhost:8000/gateway/endpoints/

# Add a new endpoint
curl -X POST http://localhost:8000/gateway/endpoints/ \
  -H "Content-Type: application/json" \
  -d '{"model_name":"my-llama","api_base":"http://some-vllm:7000/v1"}'

# Verify it appears
curl http://localhost:8000/gateway/endpoints/
# → includes "my-llama"

# Survives restart
docker compose down && docker compose up -d
curl http://localhost:8000/gateway/endpoints/
# → still includes "my-llama"
```

## Out of Scope

- Changes to vLLM container images or model weights.
- Kernel-level or TT-Metal changes.
- Full observability stack (Grafana, Prometheus) — LiteLLM's built-in Postgres logging is sufficient.
- Authentication/RBAC beyond LiteLLM's master key.
- Frontend UI for endpoint management (API-only is fine; frontend integration of the model list is in-scope).

## Resources

- [LiteLLM Proxy Docs](https://docs.litellm.ai/docs/proxy/configs)
- [LiteLLM Docker Quickstart](https://docs.litellm.ai/docs/proxy/deploy)
- [LiteLLM Model Management API](https://docs.litellm.ai/docs/proxy/model_management)
- [TT Studio `docker-compose.yml`](../docker-compose.yml)
- [TT Studio `.env.default`](../.env.default)
