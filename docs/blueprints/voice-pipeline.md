# Voice Pipeline — Conversational Bot

End-to-end voice conversation pipeline: record audio, transcribe with Whisper, generate a response with an LLM, and synthesize speech output. Three models chained in a single SSE-streaming pipeline on Tenstorrent hardware.

## Use This Blueprint When

- You want a fully on-device voice assistant without cloud STT/TTS APIs
- You need to chain multiple models into a single real-time pipeline
- You want to build a voice interface on top of any deployed LLM

## Architecture

```
┌───────────┐     ┌───────────┐     ┌───────────┐     ┌───────────┐
│  Audio    │     │  Whisper  │     │  LLM      │     │  TTS      │
│  Input    │────>│  (STT)    │────>│  (Chat)   │────>│  (Speech) │
│  Record   │     │  Tenstorrent│   │  Tenstorrent│   │  Tenstorrent│
└───────────┘     └───────────┘     └───────────┘     └───────────┘
                        │                 │                 │
                   "transcript"      "llm_chunk"      "audio_url"
                        └─────────────────┴─────────────────┘
                              SSE Streaming Response
```

## How It Works

1. **Record** — User records audio through the web interface
2. **Transcribe** — Audio is sent to a deployed Whisper model for speech-to-text
3. **Generate** — Transcript is passed to a deployed LLM as a chat message
4. **Synthesize** — LLM response is sent to a deployed TTS model for speech output
5. **Stream** — All stages stream results as Server-Sent Events: `transcript`, `llm_chunk`, `audio_url`, `done`

The TTS stage is optional — if no TTS model is deployed, the pipeline returns text only.

## Key Features

- Three-model pipeline chaining (STT &rarr; LLM &rarr; TTS)
- Real-time SSE streaming with per-stage events
- Configurable system prompts for LLM behavior
- Optional TTS — graceful fallback to text-only
- Multipart audio upload support

## Models Used

| Role | Model Type | Examples |
|------|-----------|---------|
| Speech-to-Text | SPEECH_RECOGNITION | whisper-large-v3, distil-large-v3 |
| Generation | LLM (CHAT) | Llama-3.1-8B-Instruct, Qwen3-8B |
| Text-to-Speech | TTS | speecht5_tts |

See the full [Model Catalog](../model-catalog.md) for all compatible models and hardware.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | Runs Whisper + small LLM + TTS (3 concurrent models) |
| N300 | Recommended — more headroom for larger LLMs |
| T3K | Full catalog support |

Running all three models concurrently requires enough device slots. On single-chip devices, use `device_id` to pin each model to a separate chip.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/pipeline/voice/` | POST | Multipart: audio_file, whisper_deploy_id, llm_deploy_id, tts_deploy_id |

**SSE Event Types:**

| Event | Payload | Description |
|-------|---------|-------------|
| `transcript` | Whisper output text | Speech-to-text result |
| `llm_chunk` | Token chunk | Streaming LLM response |
| `audio_url` | URL to audio file | Synthesized speech output |
| `done` | — | Pipeline complete |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (model serving)
- TT-Metal (execution framework)

**Inference Engines**
- vLLM (LLM serving)
- Media Engine (Whisper STT, SpeechT5 TTS)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy three models: a Whisper model, an LLM, and speecht5_tts
3. Navigate to **Voice Pipeline** in the web interface
4. Record audio and watch the pipeline process through all three stages

See the [Quick Start Guide](../quickstart.md) for full provisioning details.

## Related Blueprints

- [LLM Chat](llm-chat.md) — the same LLM backend used for text generation in this pipeline
- [RAG](rag.md) — combine with RAG to ground voice responses in your documents
