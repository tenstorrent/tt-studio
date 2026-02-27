# Remote Endpoint Setup

You can use TT-Studio without local Tenstorrent hardware by connecting to remote endpoints that run models on Tenstorrent cards (or other compatible inference servers).

## Overview

- Run TT-Studio on your machine as the frontend.
- Point it at remote model endpoints (e.g., a TT Inference Server or other API running on Tenstorrent hardware elsewhere).
- No local Tenstorrent devices are required.

## True AI Playground

With **AI Playground mode** enabled, TT-Studio becomes a full AI playground: a single UI for all model types. You get:

- **Chat (LLMs)** – conversational AI, Q&A, text completion
- **Computer Vision (YOLO)** – object detection
- **Speech (Whisper)** – speech-to-text
- **Image Generation (Stable Diffusion)** – text-to-image

You can use the playground with **remote endpoints only** (no local hardware), with **local deployment** (Tenstorrent hardware), or a **mix** of both. Enable it with `VITE_ENABLE_DEPLOYED=true` and configure the endpoints you need (see below). The [Model Interface Guide](model-interface.md) has full details and usage.

## Setup

1. **Enable AI Playground mode**  
   In your `.env` file, set:
   ```env
   VITE_ENABLE_DEPLOYED=true
   ```

2. **Configure remote model endpoints**  
   Set the appropriate `CLOUD_*_URL` (and optional auth) variables in `.env` to your remote Tenstorrent or other inference endpoints. For example:
   - `CLOUD_CHAT_UI_URL` – LLM chat endpoint
   - `CLOUD_YOLOV4_API_URL` – YOLO vision endpoint
   - `CLOUD_SPEECH_RECOGNITION_URL` – Whisper endpoint
   - `CLOUD_STABLE_DIFFUSION_URL` – Image generation endpoint

3. **Start TT-Studio**  
   Run `python3 run.py --easy` (or `python3 run.py`). Open [http://localhost:3000](http://localhost:3000) to use the full AI Playground UI; requests go to your configured remote endpoints.

## SSH Port Forwarding (Remote Server Access)

If TT-Studio runs on a remote server with Tenstorrent hardware and you want to access it from your local browser, use SSH port forwarding:

```bash
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 -L 8002-8012:localhost:8002-8012 user@server
```

| Port | Service |
|------|---------|
| 3000 | Frontend (experience layer) |
| 8001 | TT Inference Server API |
| 8002-8012 | Deployed model inference endpoints |

Then open [http://localhost:3000](http://localhost:3000) in your local browser.

## More details

- **[Model Interface Guide](model-interface.md)** -- Full setup for each model type, env vars, and usage.
- **[FAQ](FAQ.md)** -- General “no Tenstorrent hardware” and usage questions.
- **[run.py guide -- Running on Remote Machine](run-py-guide.md#running-on-remote-machine)** -- If TT-Studio itself runs on a remote server and you want to access it from your local browser.
