# AI Agent

Autonomous AI assistant with tool use, model auto-discovery, and persistent conversation threads. This blueprint connects to any deployed LLM on Tenstorrent hardware and extends it with agentic reasoning capabilities.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Experience     │      │  Agent          │      │  LLM            │
│  Layer          │─────>│  Service        │─────>│  (vLLM)         │
│  (Web UI)       │      │  (FastAPI)      │      │  Tenstorrent     │
│                 │      │  Tool Use       │      │  Hardware       │
└─────────────────┘      └────────┬────────┘      └─────────────────┘
                                  │
                         ┌────────┴────────┐
                         │  Tools          │
                         │  · Web Search   │
                         │    (Tavily)     │
                         │  · Auto-        │
                         │    Discovery    │
                         └─────────────────┘
```

## How It Works

1. **Discovery** — Agent service auto-discovers deployed models on the TT-Studio network
2. **Routing** — User messages are routed to the agent service, which selects the appropriate LLM
3. **Reasoning** — The agent processes the request with tool-use capabilities
4. **Tool Execution** — External tools (web search via Tavily, etc.) are invoked as needed
5. **Streaming** — Responses stream back to the experience layer in real-time

## Key Features

- Automatic discovery of deployed LLM models
- Persistent conversation threads with thread ID tracking
- Tool use integration (web search, knowledge retrieval)
- Cloud LLM fallback when no local deployment is available
- Streaming response support

## Models Used

| Role | Model Type | Examples |
|------|-----------|---------|
| Reasoning | LLM (CHAT) | Llama-3.1-8B-Instruct, Qwen3-32B, Llama-3.3-70B-Instruct |

Any deployed CHAT model is automatically discoverable by the agent. See the full [Model Catalog](../model-catalog.md).

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | Runs 1B-8B instruction-tuned models |
| T3K | Recommended for 32B+ models with stronger reasoning |
| GALAXY | Required for 70B+ models |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/agent/` | POST | Send message to agent |
| `/api/models/agent/status/` | GET | Agent status and discovery info |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (LLM serving via vLLM)
- TT-Metal (execution framework)

**Third-Party**
- FastAPI (agent service)
- Tavily (web search, required)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy an instruction-tuned LLM (e.g., Llama-3.1-8B-Instruct)
3. The agent auto-discovers the deployed model
4. Navigate to **AI Agent** in the web interface
5. Start a conversation — the agent routes to your deployed model

Set `TAVILY_API_KEY` in `.env` to enable web search capabilities (required).

See the [Quick Start Guide](../quickstart.md) for full provisioning details.
