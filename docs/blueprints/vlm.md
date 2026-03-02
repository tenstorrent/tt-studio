# Vision Language Model (VLM)

Multimodal chat combining text and image understanding. Upload images alongside text prompts and receive responses that reason about visual content — powered by vision-language models running on Tenstorrent hardware via vLLM.

## Architecture

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  Chat UI  │     │  Control  │     │  VLM      │
│  Text +   │────>│  Plane    │────>│  (vLLM)   │
│  Image    │     │  Format + │     │  Tenstorrent│
│  Upload   │     │  Route    │     │  Hardware  │
└───────────┘     └───────────┘     └───────────┘
                        │                 │
                   OpenAI-format     Token stream
                   image_url +       (SSE chunks)
                   text content
                        └─────────────────┘
                         Multimodal streaming
                         chat completions
```

## How It Works

1. **Upload** — User provides a text prompt along with one or more images (file upload or URL)
2. **Format** — Control plane formats the input as an OpenAI-compatible multimodal message (text + `image_url` content blocks)
3. **Route** — Request is forwarded to the deployed VLM container's `/v1/chat/completions` endpoint
4. **Generate** — VLM processes both visual and text inputs on Tenstorrent hardware
5. **Stream** — Tokens stream back as Server-Sent Events, rendered in the chat UI

VLM uses the same chat interface as text-only LLMs, extended with image upload support. The API format follows the OpenAI vision message specification.

## Key Features

- Multimodal input: text + images in a single conversation
- Image upload (file) and image URL support
- Real-time SSE token streaming
- Configurable sampling parameters (temperature, top_k, top_p, max_tokens)
- OpenAI-compatible `/v1/chat/completions` API with vision extensions
- Multi-turn conversation with mixed text and image history
- 12 pre-configured models from 3B to 90B parameters

## Models Used

| Model | Parameters | Supported Devices | Status |
|-------|-----------|-------------------|--------|
| Llama-3.2-11B-Vision-Instruct | 11B | N300, T3K | FUNCTIONAL |
| Llama-3.2-90B-Vision-Instruct | 90B | T3K | FUNCTIONAL |
| Qwen2.5-VL-72B-Instruct | 72B | T3K | FUNCTIONAL |
| Qwen2.5-VL-32B-Instruct | 32B | T3K | EXPERIMENTAL |
| Qwen2.5-VL-7B-Instruct | 7B | N150, N300, T3K | EXPERIMENTAL |
| Qwen2.5-VL-3B-Instruct | 3B | N150, N300, T3K | EXPERIMENTAL |
| gemma-3-27b-it | 27B | T3K, Galaxy | EXPERIMENTAL |
| gemma-3-4b-it | 4B | N150, N300 | EXPERIMENTAL |
| medgemma-27b-it | 27B | T3K, Galaxy | EXPERIMENTAL |
| medgemma-4b-it | 4B | N150, N300 | EXPERIMENTAL |

See the full [Model Catalog](../model-catalog.md) for all 12 VLM models.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | Runs 3B-4B vision models |
| N300 | Runs 3B-11B vision models |
| T3K | Required for 32B+ vision models |
| Galaxy | Full catalog support |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/inference/` | POST | Send multimodal message (text + images), receive streaming response |

VLM uses the same inference endpoint as text-only LLM chat. The control plane detects image content in the message payload and formats it appropriately.

**Request Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `deploy_id` | string | Deployment identifier |
| `messages` | array | Chat history with text and `image_url` content blocks |
| `temperature` | float | Sampling temperature |
| `top_k` | int | Top-k sampling |
| `top_p` | float | Nucleus sampling |
| `max_tokens` | int | Maximum tokens to generate |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (model serving)
- TT-Metal (execution framework)

**Inference Engine**
- vLLM with `/v1/chat/completions` OpenAI-compatible endpoint (multimodal extensions)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy a VLM from the model catalog (e.g., Llama-3.2-11B-Vision-Instruct)
3. Navigate to **Chat** in the web interface
4. Upload an image and ask questions about it

See the [Quick Start Guide](../quickstart.md) for full provisioning details.
