# Image Generation

Text-to-image with FLUX, Stable Diffusion, and Motif — 9 models, fully on-device, no cloud API costs. Enter a text prompt and receive a generated image running on Tenstorrent hardware via the Media Engine.

## Use This Blueprint When

- You need text-to-image generation without sending prompts to cloud APIs
- You want to evaluate FLUX, SDXL, or Motif architectures on Tenstorrent hardware
- You need image-to-image transformation or inpainting capabilities on-device

## Architecture

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  Prompt   │     │  Control  │     │  Diffusion│
│  Input    │────>│  Plane    │────>│  Model    │
│  (Web UI) │     │  Enqueue +│     │  (Media)  │
│           │     │  Poll     │     │  Tenstorrent│
└───────────┘     └───────────┘     └───────────┘
                        │                 │
                   Task enqueue      Image result
                   + status poll     (PNG/JPEG)
                        └─────────────────┘
                         Async task queue
                         with polling
```

## How It Works

1. **Prompt** — User enters a text description of the desired image
2. **Enqueue** — Control plane sends the prompt to the deployed model's `/enqueue` endpoint
3. **Poll** — Control plane polls the `/status/{task_id}` endpoint until generation completes
4. **Fetch** — Completed image is retrieved from `/fetch_image/{task_id}`
5. **Display** — Generated image is rendered in the web interface

Image generation uses an asynchronous task queue pattern rather than streaming, as diffusion models produce a single output after the full denoising process.

## Key Features

- Text-to-image generation with multiple architectures
- Image-to-image transformation (SDXL img2img)
- Inpainting support (SDXL Inpainting)
- Async task queue with status polling
- Cloud endpoint fallback for remote generation
- 9 pre-configured models across 3 architecture families

## Models Used

| Model | Architecture | Supported Devices | Status |
|-------|-------------|-------------------|--------|
| stable-diffusion-xl-base-1.0 | SDXL | N150, N300, T3K, Galaxy | COMPLETE |
| stable-diffusion-xl-base-1.0-img-2-img | SDXL | N150, N300, T3K, Galaxy | COMPLETE |
| stable-diffusion-xl-1.0-inpainting-0.1 | SDXL | N150, N300, T3K, Galaxy | COMPLETE |
| stable-diffusion-3.5-large | SD 3.5 | T3K, Galaxy | COMPLETE |
| FLUX.1-schnell | FLUX | T3K, Galaxy | COMPLETE |
| FLUX.1-dev | FLUX | T3K, Galaxy | COMPLETE |
| Motif-Image-6B-Preview | Motif | T3K, Galaxy | COMPLETE |
| Qwen-Image | Qwen | T3K, Galaxy | FUNCTIONAL |
| Qwen-Image-2512 | Qwen | T3K, Galaxy | FUNCTIONAL |

See the full [Model Catalog](../model-catalog.md) for all compatible models and hardware.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | SDXL models (base, img2img, inpainting) |
| N300 | SDXL models with more headroom |
| T3K | Required for FLUX, SD 3.5, Motif |
| Galaxy | Full catalog support |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/image-generation/` | POST | Local inference — submit prompt, receive generated image |
| `/api/models/image-generation-cloud/` | POST | Cloud endpoint fallback |

**Request Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `deploy_id` | string | Deployment identifier |
| `prompt` | string | Text description of the desired image |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (model serving)
- TT-Metal (execution framework)

**Inference Engine**
- Media Engine (diffusion model serving with async task queue)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy a diffusion model (e.g., stable-diffusion-xl-base-1.0) from the model catalog
3. Navigate to **Image Generation** in the web interface
4. Enter a text prompt to generate an image

See the [Quick Start Guide](../quickstart.md) for full provisioning details.

## Related Blueprints

- [Video Generation](video-generation.md) — same async task queue pattern extended to video output
- [Vision Language Model](vlm.md) — for image understanding rather than generation
