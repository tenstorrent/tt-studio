# Application Integrations

Connect Open WebUI, AnythingLLM, Continue, LangChain, and any OpenAI-compatible
client to LLMs running on Tenstorrent hardware via TT-Studio.

## Use This Blueprint When

- You want an existing LLM front-end (Open WebUI, AnythingLLM) to talk to model running on Tenstorrent hardware. Use tt-studio to help you deploy the desired models , then follow this guide to connect them here. 
- You're building a custom app using LangChain, LlamaIndex, or the OpenAI SDK
- You want a single stable OpenAI-compatible gateway across all deployed models

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌───────────────────┐
│  External Client    │     │  Gateway / Direct Port   │     │  vLLM Container   │
│  (Open WebUI,       │────>│                          │────>│  /v1/chat/        │
│   LangChain, curl)  │     │  Direct:  host:<port>/v1 │     │  completions      │
│                     │     │  Gateway: host:4000/v1   │     │  Tenstorrent HW   │
└─────────────────────┘     └──────────────────────────┘     └───────────────────┘
```

Two connection paths:

- **Direct:** `http://<host>:<model-port>/v1` — current, dynamic port, changes on container restart
- **Gateway:** `http://<host>:4000/v1` — planned LiteLLM proxy, stable across restarts, multi-model

## How It Works

1. **Deploy** — Launch an LLM from the TT-Studio model catalog
2. **Find endpoint** — Locate the host port from the TT-Studio UI or `GET /api/docker/status/`
3. **Configure client** — Set base URL to `http://<host>:<port>/v1`, API key to `"none"` (or any string)
4. **Set model name** — Query `GET /v1/models` on the container to get the exact model name string
5. **Chat** — `/v1/chat/completions` works natively with any OpenAI-compatible client

## Supported Applications

| Application | Type | Integration Path |
|-------------|------|-----------------|
| [Open WebUI](https://github.com/open-webui/open-webui) | Chat UI | Admin Panel → Connections → OpenAI URL |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Chat + RAG UI | Settings → LLM Preference → Generic OpenAI-compatible |
| [Continue](https://continue.dev) | VS Code / JetBrains IDE assistant | `config.json` provider block |
| [LangChain](https://python.langchain.com) | Python framework | `ChatOpenAI(base_url=...)` |
| [LlamaIndex](https://www.llamaindex.ai) | Python framework | `OpenAI(api_base=...)` |
| [LiteLLM](https://litellm.ai) | OpenAI proxy / gateway | config-driven routing |
| [LibreChat](https://github.com/danny-avila/LibreChat) | Chat UI | `librechat.yaml` endpoint config |
| Any OpenAI SDK client | Generic | Set `base_url` + `api_key="none"` |

## TT Example Apps

Tenstorrent maintains a companion repo, [`tt-example-apps`](https://github.com/tenstorrent/tt-example-apps), with 14 plug-and-play Python/notebook apps built on top of TT inference. Each app is pre-wired to the OpenAI-compatible endpoint pattern used by TT-Studio.

### Connecting to TT-Studio Instead of Koyeb

The apps default to a Koyeb-hosted URL, but any TT-Studio deployed model works identically. Replace the Koyeb instance URL with `http://localhost:<port>` where `<port>` is the host port of your deployed model. The model name is auto-discovered via `/v1/models` — no hardcoding required.

```bash
# In any tt-example-apps project:
export TT_BASE_URL="http://localhost:<port>"   # your deployed model's port
# Then run the app — model is auto-discovered via /v1/models
```

### Basic Chat Apps

| App | Description | Frameworks |
|-----|-------------|------------|
| `chat_memory` | Streaming chatbot with conversation history | OpenAI SDK, Streamlit |
| `basic_scripts` | Foundational inference scripts | OpenAI SDK |

### Agent Apps

| App | Description | Frameworks |
|-----|-------------|------------|
| `langchain_search_agent` | Web search agent (requires Tavily API key) | LangChain |
| `langchain_math_agent` | Math problem-solving agent | LangChain |
| `agno_web_search` | Web search using Agno framework | Agno |
| `investment_agent` | Financial/investment analysis agent | Agno |
| `aws_strands_agent` | File-read agent via AWS Strands | AWS Strands |
| `google_adk_agent` | Text agent via Google ADK | Google ADK |
| `openai_exchange_rate_agent` | Currency exchange rate agent | OpenAI SDK |
| `openai_filesystem_mcp` | Filesystem agent via MCP protocol | OpenAI SDK + MCP |
| `travel_guide` | AI travel planning agent | OpenAI SDK |
| `weather_agent` | Weather information agent | OpenAI SDK |

### RAG Apps

| App | Description | Frameworks |
|-----|-------------|------------|
| `pdf_rag` | RAG over PDF documents | LangChain, ChromaDB |
| `webpage_rag` | RAG over web pages | LangChain, ChromaDB |

> **Note on tool calling:** Some agent apps require the model server to be launched with `--enable-auto-tool-choice`. TT-Studio models that support tool calling (Llama, Qwen) are configured for this when deployed via the catalog.

## Finding Your Model's Endpoint

**Option 1 — TT-Studio UI:**
Navigate to the deployed model card; the host port is shown in the deployment details.

**Option 2 — REST API:**
```bash
curl http://localhost:8000/api/docker/status/
```
Response includes `internal_url` per active deployment.

**Option 3 — Query the container directly:**
```bash
curl http://localhost:<port>/v1/models
```
Returns the exact model name string to use in client configuration.

## Application Guides

### Open WebUI

1. Deploy Open WebUI (see [Open WebUI docs](https://docs.openwebui.com))
2. Sign in → **Admin Panel** → **Settings** → **Connections**
3. Under **OpenAI API**, set:
   - **URL:** `http://<host>:<port>/v1`
   - **API Key:** `none`
4. Save → the TT-Studio model appears in the model selector

### AnythingLLM

1. Open **Settings** → **LLM Preference**
2. Select **Generic OpenAI-compatible** provider
3. Set:
   - **Base URL:** `http://<host>:<port>/v1`
   - **API Key:** `none`
   - **Model:** (from `GET /v1/models`)
4. Save and start a new workspace

### Continue (VS Code)

Add to `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "TT-Studio LLM",
      "provider": "openai",
      "model": "<model-name-from-v1/models>",
      "apiBase": "http://<host>:<port>/v1",
      "apiKey": "none"
    }
  ]
}
```

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://<host>:<port>/v1",
    api_key="none",
    model="<model-name-from-v1/models>",
)

response = llm.invoke("Explain Tenstorrent hardware in one paragraph.")
print(response.content)
```

### LlamaIndex

```python
from llama_index.llms.openai import OpenAI

llm = OpenAI(
    api_base="http://<host>:<port>/v1",
    api_key="none",
    model="<model-name-from-v1/models>",
)

response = llm.complete("What is a Tenstorrent N150?")
print(response)
```

### Generic (curl)

```bash
# List available models
curl http://localhost:<port>/v1/models

# Send a chat completion
curl http://localhost:<port>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-name>",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

## LiteLLM Gateway (Recommended for Multi-Model)

The LiteLLM gateway provides a single stable front-door for all deployed TT-Studio models. Once enabled:

- All active deployments are accessible at `http://<host>:4000/v1`
- A single base URL works regardless of which models are running or which ports they occupy
- `GET /v1/models` lists all currently active deployments dynamically

See the [LiteLLM Inference Gateway bounty spec](../bounties/litellm-inference-gateway.md) for implementation details.

## API Endpoint Reference

These endpoints are exposed directly by each deployed vLLM container (not by TT-Studio's Django backend):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | List models served by this container |
| `/v1/chat/completions` | POST | OpenAI-compatible chat completions (streaming supported) |
| `/health` | GET | Container health check |

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | Runs 1B–8B models |
| N300 | Runs 1B–8B models with more headroom |
| T3K | Required for 32B+ models |
| Galaxy | Required for 70B+ models |

Same requirements as [LLM Chat](llm-chat.md).

## Known Limitations

- **No stable port** — Container ports are dynamically assigned and change on restart. Use the LiteLLM gateway for stable client configurations.
- **No authentication** — Deployed containers do not enforce API key validation. Avoid exposing ports on shared or public networks.
- **LLM/VLM only** — TTS, image generation, and object detection models do not expose an OpenAI-compatible API. Use TT-Studio's own API endpoints for those.
- **Direct container access only** — There is no `/v1/chat/completions` or `/v1/models` at the TT-Studio Django backend level; clients must point directly at model container ports.

## Software Stack

**Inference Engine**
- vLLM — OpenAI-compatible `/v1/chat/completions` serving

**Optional Gateway**
- LiteLLM Proxy — unified multi-model gateway at a single stable port

**Container Management**
- TT Inference Server — manages container lifecycle and port assignment

## Quick Start

1. Start TT-Studio: `python3 run.py`
2. Deploy an LLM from the model catalog
3. Find the port: TT-Studio UI model card or `GET /api/docker/status/`
4. Set base URL: `http://localhost:<port>/v1`, API Key: `none`
5. Get model name: `curl http://localhost:<port>/v1/models`
6. Configure your client and start chatting

## Related Blueprints

- [LLM Chat](llm-chat.md) — TT-Studio's built-in streaming chat UI for the same deployed models
- [AI Agent](ai-agent.md) — extends LLM Chat with tool use, web search, and persistent threads
- [RAG](rag.md) — retrieval-augmented generation with document collections
