# LLM Chat

Interactive chat interface for large language models deployed on Tenstorrent hardware. Supports streaming token generation, configurable sampling parameters, and OpenAI-compatible API endpoints via vLLM.

## Architecture

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  Chat UI  │     │  Control  │     │  LLM      │
│  (React)  │────>│  Plane    │────>│  (vLLM)   │
│  Streaming│     │  Route +  │     │  Tenstorrent│
│           │     │  SSE      │     │  Hardware  │
└───────────┘     └───────────┘     └───────────┘
                        │                 │
                   Message routing    Token stream
                   + deploy lookup    (SSE chunks)
                        └─────────────────┘
                         Real-time streaming
                         chat completions
```

## How It Works

1. **Select** — User selects a deployed LLM from the model list
2. **Message** — User sends a chat message through the web interface
3. **Route** — Control plane resolves the deployment and forwards to the running vLLM container
4. **Generate** — vLLM generates tokens on Tenstorrent hardware using the `/v1/chat/completions` endpoint
5. **Stream** — Tokens stream back as Server-Sent Events, rendered in real-time in the chat UI

## Key Features

- Real-time SSE token streaming
- Configurable sampling: temperature, top_k, top_p, max_tokens
- OpenAI-compatible `/v1/chat/completions` API
- Multi-turn conversation history
- Cloud LLM fallback when no local deployment is available
- RAG context injection (when paired with a collection)
- 24 pre-configured models from 1B to 120B parameters

## Models Used

| Model | Parameters | Supported Devices | Status |
|-------|-----------|-------------------|--------|
| Llama-3.1-8B-Instruct | 8B | N150, N300, P100, P150, T3K, Galaxy | COMPLETE |
| Llama-3.1-70B-Instruct | 70B | T3K, P150X4, P150X8, Galaxy | COMPLETE |
| Llama-3.3-70B-Instruct | 70B | T3K, P150X4, P150X8, Galaxy | COMPLETE |
| DeepSeek-R1-Distill-Llama-70B | 70B | T3K, P150X4, P150X8, Galaxy | COMPLETE |
| Mistral-7B-Instruct-v0.3 | 7B | N150, N300, T3K | COMPLETE |
| Qwen3-32B | 32B | T3K, P150X8, Galaxy | COMPLETE |
| Qwen3-8B | 8B | N150, N300, T3K, Galaxy | FUNCTIONAL |
| QwQ-32B | 32B | T3K, Galaxy | FUNCTIONAL |
| Qwen2.5-72B-Instruct | 72B | T3K, Galaxy | FUNCTIONAL |
| Qwen2.5-Coder-32B-Instruct | 32B | T3K, Galaxy | EXPERIMENTAL |

See the full [Model Catalog](../model-catalog.md) for all 24 chat models.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | Runs 1B-8B models |
| N300 | Runs 1B-8B models with more headroom |
| T3K | Required for 32B+ models |
| Galaxy | Required for 70B+ models |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/inference/` | POST | Send chat message, receive streaming response |
| `/api/models/inference_cloud/` | POST | Cloud LLM fallback endpoint |

**Request Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `deploy_id` | string | Deployment identifier |
| `messages` | array | Chat message history (OpenAI format) |
| `temperature` | float | Sampling temperature |
| `top_k` | int | Top-k sampling |
| `top_p` | float | Nucleus sampling |
| `max_tokens` | int | Maximum tokens to generate |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (model serving)
- TT-Metal (execution framework)

**Inference Engine**
- vLLM with `/v1/chat/completions` OpenAI-compatible endpoint

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy an LLM from the model catalog (e.g., Llama-3.1-8B-Instruct)
3. Navigate to **Chat** in the web interface
4. Start a conversation with the deployed model

See the [Quick Start Guide](../quickstart.md) for full provisioning details.
