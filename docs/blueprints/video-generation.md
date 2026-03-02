# Video Generation

Text-to-video generation using diffusion models running on Tenstorrent hardware via the Media Engine. Enter a text prompt and receive a generated video clip — supports Mochi and Wan architectures.

## Architecture

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  Prompt   │     │  Control  │     │  Video    │
│  Input    │────>│  Plane    │────>│  Diffusion│
│  (Web UI) │     │  Enqueue +│     │  (Media)  │
│           │     │  Poll     │     │  Tenstorrent│
└───────────┘     └───────────┘     └───────────┘
                        │                 │
                   Task enqueue      Video result
                   + status poll     (MP4)
                        └─────────────────┘
                         Async task queue
                         with polling
```

## How It Works

1. **Prompt** — User enters a text description of the desired video
2. **Enqueue** — Control plane sends the prompt to the deployed model's task queue
3. **Poll** — Control plane polls for task completion (video generation is compute-intensive)
4. **Fetch** — Completed video is retrieved and returned to the client
5. **Display** — Generated video is rendered in the web interface

Video generation uses the same asynchronous task queue pattern as image generation, with longer processing times due to the temporal dimension.

## Key Features

- Text-to-video generation from natural language prompts
- Multiple video diffusion architectures
- Async task queue with status polling
- 2 pre-configured models

## Models Used

| Model | Parameters | Supported Devices | Status |
|-------|-----------|-------------------|--------|
| mochi-1-preview | — | T3K, Galaxy | COMPLETE |
| Wan2.2-T2V-A14B-Diffusers | 14B | T3K, Galaxy | COMPLETE |

See the full [Model Catalog](../model-catalog.md) for all compatible models and hardware.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| T3K | Minimum for video generation models |
| Galaxy | Recommended for faster generation |

Video diffusion models require significant compute. Both supported models require T3K or Galaxy hardware.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/inference/` | POST | Submit video generation prompt |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (model serving)
- TT-Metal (execution framework)

**Inference Engine**
- Media Engine (video diffusion serving with async task queue)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy a video model (e.g., mochi-1-preview) from the model catalog
3. Navigate to the deployed model in the web interface
4. Enter a text prompt to generate a video

See the [Quick Start Guide](../quickstart.md) for full provisioning details.
