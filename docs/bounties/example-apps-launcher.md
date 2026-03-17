# Plan: TT Example Apps Launcher

## Background

[`tt-example-apps`](https://github.com/tenstorrent/tt-example-apps) is a public repo of 14 plug-and-play Python apps (chatbots, agents, RAG) built on top of TT inference. They already use the same `OpenAI(base_url=.../v1)` connection pattern as TT-Studio.

Currently a user must manually find a deployed model's port, export `TT_BASE_URL`, and launch each app from their terminal. This plan replaces all of that with a single-click launcher inside the TT-Studio UI.

---

## Goal

From the deployed models table, click **"Example Apps"** on any running LLM → a dialog shows all 14 compatible apps → click **"Launch"** → the app starts as a local Python subprocess with `TT_BASE_URL` auto-injected → a link appears to open it in the browser.

---

## App Registry (all 14 apps)

| App ID | Path in repo | Type | Has UI | Default Port | Frameworks |
|--------|-------------|------|--------|-------------|------------|
| `chat_memory` | `basic_chat_apps/chat_memory/` | basic | ✅ Streamlit | 8501 | OpenAI SDK, Streamlit |
| `basic_scripts` | `basic_chat_apps/basic_scripts/` | basic | ❌ | — | OpenAI SDK |
| `langchain_search_agent` | `agent_apps/langchain_search_agent/` | agent | ❌ | — | LangChain |
| `langchain_math_agent` | `agent_apps/langchain_math_agent/` | agent | ❌ | — | LangChain |
| `agno_web_search` | `agent_apps/agno_web_search/` | agent | ❌ | — | Agno |
| `investment_agent` | `agent_apps/investment_agent/` | agent | ❌ | — | Agno |
| `aws_strands_agent` | `agent_apps/aws_strands_agent/` | agent | ❌ | — | AWS Strands |
| `google_adk_agent` | `agent_apps/google_adk_agent/` | agent | ❌ | — | Google ADK |
| `openai_exchange_rate_agent` | `agent_apps/openai_exchange_rate_agent/` | agent | ❌ | — | OpenAI SDK |
| `openai_filesystem_mcp` | `agent_apps/openai_filesystem_mcp/` | agent | ❌ | — | OpenAI SDK + MCP |
| `travel_guide` | `agent_apps/travel_guide/` | agent | ❌ | — | OpenAI SDK |
| `weather_agent` | `agent_apps/weather_agent/` | agent | ❌ | — | OpenAI SDK |
| `pdf_rag` | `rag_apps/pdf_rag/` | rag | ❌ | — | LangChain, ChromaDB |
| `webpage_rag` | `rag_apps/webpage_rag/` | rag | ❌ | — | LangChain, ChromaDB |

Only `chat_memory` has a browser UI. All others are script/agent apps whose output is streamed as logs.

---

## Architecture

```
TT-Studio UI
  └── "Example Apps" button (on deployed model row)
        └── ExampleAppsDialog
              └── AppCard × 14
                    └── "Launch" → POST /app-api/launch/
                                      └── ProcessManager.launch(app_id, model_url)
                                            ├── RepoManager.ensure_repo()   # git clone/pull
                                            ├── RepoManager.ensure_venv()   # pip install -r requirements.txt
                                            └── subprocess.Popen([...], env={TT_BASE_URL: ...})
                    └── "Open"  → opens http://localhost:<port> in new tab (UI apps only)
                    └── "Logs"  → GET /app-api/logs/<app_id>/ (SSE stream)
                    └── "Stop"  → POST /app-api/stop/
```

### State machine for each app process

```
idle → launching → installing_deps → ready (UI apps) | running (script apps) → stopped / crashed
```

---

## Backend

### New Django app: `app/backend/app_launcher/`

**`registry.py`** — static config for all 14 apps (dataclass, no DB):
```python
@dataclass
class AppConfig:
    app_id: str
    display_name: str
    description: str
    path: str          # relative path inside cloned repo
    entrypoint: str    # e.g. "chat_memory.py" or "agent.py"
    has_ui: bool
    default_port: int | None
    frameworks: list[str]
    model_types: list[str]  # ["llm"] — for filtering by deployed model type
```

**`process_manager.py`** — in-memory subprocess tracker:
```python
@dataclass
class AppProcess:
    app_id: str
    pid: int
    port: int | None
    status: str        # "launching" | "ready" | "running" | "stopped" | "crashed"
    model_url: str
    log_path: str
    started_at: str

class ProcessManager:
    _processes: dict[str, AppProcess] = {}

    def launch(app_id, model_url) -> AppProcess
    def stop(app_id)
    def get(app_id) -> AppProcess | None
    def list_all() -> list[AppProcess]
```

Persistence: write PIDs to `backend_cache_root/app_launcher_pids.json` so processes survive Django restarts (probe with `os.kill(pid, 0)` on startup).

**`repo_manager.py`**:
- `ensure_repo(repo_url, clone_dir)` — `git clone` on first use, `git pull` on subsequent calls
- `ensure_venv(app_path)` — create `.venv` inside app dir, `pip install streamlit` first for UI apps, then `pip install -r requirements.txt`

**`views.py`** — 4 endpoints:

| Method | URL | Body / Params | Response |
|--------|-----|---------------|----------|
| `POST` | `/app-api/launch/` | `{app_id, container_id}` | `{app_id, status, port, url}` |
| `GET` | `/app-api/status/` | — | `[{app_id, status, port, url, pid}]` |
| `POST` | `/app-api/stop/` | `{app_id}` | `{status}` |
| `GET` | `/app-api/logs/<app_id>/` | — | SSE stream of stdout/stderr lines |

`launch/` flow:
1. Look up `container_id` in `get_deploy_cache()` → get `internal_url` → build `http://localhost:<port>/v1`
2. Spawn background thread: `ensure_repo()` → `ensure_venv()` → `Popen`
3. For UI apps: `_wait_for_port(port, timeout=60)` then set status `"ready"`
4. Return `202` immediately; frontend polls `/app-api/status/`

**`urls.py`**:
```python
urlpatterns = [
    path("launch/", LaunchView.as_view()),
    path("status/", StatusView.as_view()),
    path("stop/", StopView.as_view()),
    path("logs/<str:app_id>/", LogStreamView.as_view()),
]
```

### Modified backend files

| File | Change |
|------|--------|
| `app/backend/api/urls.py` | Add `path("app/", include("app_launcher.urls"))` |
| `app/backend/api/settings.py` | Add `"app_launcher"` to `INSTALLED_APPS` |

> Note: `vite.config.ts` already proxies `/app-api/` → `/app/` on the backend — no change needed.

---

## Frontend

### New components: `app/frontend/src/components/app_launcher/`

**`ExampleAppsDialog.tsx`** — modal dialog, receives `deployedModel` prop:
- Header: "Example Apps for `<model-name>`"
- Renders `AppGrid`
- Opens via button in `ManageCell`

**`AppGrid.tsx`** — maps registry to `AppCard` list, groups by category (Basic Chat / Agent / RAG)

**`AppCard.tsx`** — per-app card:
- Name, description, framework badges
- Status badge (idle / launching / ready / running / crashed)
- **Launch** button → `POST /app-api/launch/`
- **Open** button (UI apps only, shown when `status === "ready"`) → `window.open(url)`
- **Logs** button (script apps) → inline log viewer
- **Stop** button (when running)

**`AppLogViewer.tsx`** — SSE log stream from `GET /app-api/logs/<app_id>/`, same pattern as existing `LogStream` component.

### New API + hook files

| File | Purpose |
|------|---------|
| `app/frontend/src/api/appLauncherApis.ts` | `launchApp`, `fetchAppStatuses`, `stopApp` |
| `app/frontend/src/hooks/useAppLauncher.ts` | State + polling (2s interval while any app is `"launching"`) |

### Modified frontend files

| File | Change |
|------|--------|
| `app/frontend/src/components/models/row-cells/ManageCell.tsx` | Add "Example Apps" button |
| `app/frontend/src/components/models/ModelsTable.tsx` | Pass `onOpenExampleApps` prop |
| `app/frontend/src/components/models/ModelsDeployedCard.tsx` | Hold dialog open/close state, render `ExampleAppsDialog` |

---

## Build Phases

### Phase 1 — Backend skeleton (stub views, wired routing)
1. Create `app_launcher/` Django app with all 4 stub views returning hardcoded JSON
2. Register in `urls.py` and `settings.py`
3. Verify `/app-api/launch/` responds

### Phase 2 — Subprocess launch (chat_memory demo)
4. Implement `ProcessManager` and `RepoManager`
5. Wire `launch/` and `status/` views to actually spawn `streamlit run`
6. Test end-to-end with curl: launch `chat_memory`, poll until `"ready"`, open URL

### Phase 3 — Frontend dialog
7. `appLauncherApis.ts` + `useAppLauncher.ts`
8. `ExampleAppsDialog` + `AppGrid` + `AppCard` (static registry data first)
9. Wire "Example Apps" button into `ManageCell`
10. Poll status, show "Open" link when ready

### Phase 4 — Script/agent app logs
11. `LogStreamView` SSE endpoint
12. `AppLogViewer` frontend component
13. Wire log button on script-type `AppCard`

### Phase 5 — Stop + process persistence
14. `stop/` view with SIGTERM/SIGKILL
15. PID sidecar JSON for restart survival
16. Stop button in `AppCard`

---

## Complexity Traps to Avoid

- **Never run `ensure_venv()` in the request handler** — always in the background thread; return 202 immediately
- **Port conflicts** — always `find_free_port(preferred=8501)` for Streamlit, never hardcode
- **Zombie processes on Django restart** — persist PIDs to `app_launcher_pids.json`, probe with `os.kill(pid, 0)` on `ProcessManager.__init__`
- **TT_BASE_URL format** — must be `http://localhost:<port>/v1` (with `/v1`); read host port from `get_deploy_cache()` `internal_url`
- **MCP / third-party API keys** — out of scope for MVP; `openai_filesystem_mcp` and similar need user-exported env vars; document this, don't try to auto-inject
- **Don't add a `/apps` route in Phase 1** — dialog-from-model-row is simpler and covers the use case; global apps page can come later

---

## Related

- [`docs/blueprints/application-integrations.md`](../blueprints/application-integrations.md) — documents how to connect external apps to TT-Studio endpoints
- [`docs/bounties/litellm-inference-gateway.md`](litellm-inference-gateway.md) — stable multi-model gateway that would eventually replace per-container `TT_BASE_URL` wiring
