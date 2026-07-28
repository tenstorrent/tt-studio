# What you can build

TT-Studio covers a wide surface, which makes a plain feature list hard to read. This page is
organised by the job instead: five situations people are actually in, what TT-Studio gives each of
them, and where to go to build it.

## You can't send your data to a third party

Legal, medical, defence, or anywhere an upload is a compliance event. You still want an assistant
that knows your material.

Upload PDFs, Word files, Markdown, plain text, HTML or source files through the RAG page. They're
chunked, embedded and stored in a ChromaDB instance running in your own stack, then pulled into
chat as context. Collections are scoped per browser, so two people using the same TT-Studio
instance don't see each other's documents. A relevance threshold lets you tighten the match when
answers start drifting off-source.

The catalog also carries domain-tuned vision-language models, including the MedGemma family,
though those are marked experimental — see the maturity note at the bottom of this page.

→ [Chat with your documents](../examples/chat-with-your-documents.md)

## You want your own inference instead of a per-token bill

You have a QuietBox under the desk and you're paying for coding assistance by the token.

Deploy a chat model, open the Connect Agents page, and copy the generated configuration. Claude
Code, OpenCode, OpenClaw and plain OpenAI-compatible clients each get their own snippet with the
right base URL, token and model name filled in. Reasoning models are additionally exposed under a
`-thinking` name so you can choose whether you want the deliberation.

Only models with verified native tool-calling are offered to the gateway, because a coding agent
against a model that can't call tools reliably is worse than no agent at all.

→ [Point a coding agent at your own box](../examples/coding-agent-on-your-own-box.md)

## You're building something that listens and talks

A kiosk, a lab assistant, a demo that responds out loud.

The voice pipeline chains speech-to-text, a chat model, and text-to-speech into one request and
streams the result back stage by stage. A bundled wake word means it can sit idle until spoken to,
with no cloud service listening. Face recognition lets it greet a returning user by name. The
system prompt is editable while it's running, so you can iterate on its personality without
redeploying anything.

The per-stage latency panel is the part people end up using most — it tells you whether your
bottleneck is transcription, generation, or synthesis.

→ [A voice assistant that greets you by name](../examples/voice-assistant-that-knows-you.md)

## You generate media and don't want it leaving the building

Unreleased assets, client work, or simply too many images to pay per-image for.

FLUX, Stable Diffusion 3.5, and SDXL — including image-to-image and inpainting — all run locally,
as does Wan 2.2 for text-to-video. Image generation is the best-covered modality in the catalog
after speech.

→ [Generate images and video](../examples/generate-images-and-video.md)

## You're evaluating the hardware

You have a card, or you're deciding whether to get one, and you want to know what it really does.

Deploy a model straight from the command line with `--auto-deploy`, pin it to a chip with
`--device-id`, and watch the box with the `--status` monitor. Board telemetry, thermal snapshots,
alerts and device reset are all in the UI. If you have no card yet, the CPU-only echo model
exercises the entire deploy path so you can see the workflow before committing.

→ [Deploy a model in one command](../examples/unattended-deploy.md)

## The full menu

Every modality in the catalog, with the app page it lands on.

| Modality | Page | Notes |
| :--- | :--- | :--- |
| Chat | `/chat` | Llama, Qwen, Mistral, DeepSeek, GPT-OSS and others |
| Vision-language | `/chat` | Image-and-text input; Llama Vision, Qwen-VL, Gemma, MedGemma |
| Image generation | `/image-generation` | FLUX, Stable Diffusion 3.5, SDXL, plus image-to-image and inpainting |
| Video generation | `/video-generation` | Wan 2.2 text-to-video |
| Speech-to-text | `/speech-to-text` | Whisper large-v3 and Distil-Whisper |
| Text-to-speech | `/tts` | SpeechT5 |
| Voice agent | `/voice-agent` | Speech-to-text, chat and text-to-speech chained together |
| Object detection | `/object-detection` | YOLOv4 |
| Face recognition | `/face-recognition` | Register and recognise faces |
| Embeddings | — | BGE and Qwen embedding models |
| Classification | — | MobileNetV2, ViT, ResNet-50, SegFormer and other CNNs |
| Workflows | `/workflows` | Chain models, retrieval and the agent as a node graph |
| Canvas | `/canvas` | Chat that streams code with a live preview |

:::{admonition} Read the maturity label before you commit to a model
:class: important

The catalog tags every model `COMPLETE`, `FUNCTIONAL` or `EXPERIMENTAL`.

- **COMPLETE** — validated end to end. Start here.
- **FUNCTIONAL** — runs, but hasn't been through full validation.
- **EXPERIMENTAL** — may not work on your board, or at all.

As of tt-inference-server artifact v0.18.0 that's 17 complete out of 54 entries. Chat, image
generation, video, speech-to-text and text-to-speech all have complete models. **Vision-language
and embeddings currently have none** — every entry in those two categories is functional or
experimental, so treat them as previews.
:::

## Next steps

- [Will it run on my machine?](will-it-run.md) — check your board before picking a model
- [Examples](../examples/index.md) — worked walkthroughs for each of the jobs above
