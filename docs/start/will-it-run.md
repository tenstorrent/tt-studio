# Will it run on my machine?

Almost certainly yes — the question is which models you'll be able to deploy. This page gives you
the answer for your specific board, and the two supported paths if you don't have one.

## The 30-second answer

:::{tip} You have a Tenstorrent card
Yes. Run `python3 run.py`. The card is detected automatically through `/dev/tenstorrent`, the
hardware compose overlay is applied for you, and the model list is filtered to what your board can
actually run. Skip to [Quickstart](quickstart.md).
:::

:::{note} You don't have a Tenstorrent card
Yes, with limits. Either point TT-Studio at remote endpoints running on cards elsewhere, or deploy
the CPU-only echo model to exercise the full workflow locally. Both are covered in
[No Tenstorrent hardware](#no-tenstorrent-hardware) below.
:::

:::{warning} You have a card that isn't in the table below
TT-Studio will start and detect it, but individual models declare which device configurations they
support, so the catalog may show little or nothing as deployable. Mixed board types in one machine
are not supported — detection requires a homogeneous setup.
:::

## Before you start

- **Python 3.8 or newer** — `run.py` bootstraps its own virtual environment from there.
- **Docker and Docker Compose**, with your user in the `docker` group:
  `sudo usermod -aG docker $USER` (log out and back in afterwards).
- **Tenstorrent drivers and system setup**, if you have a card — follow the
  [Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html).
- **A Hugging Face account and token**, for gated weights such as Llama.

:::{important} Secrets are set in the app, not in a file
The Hugging Face token and the other API keys are entered in the first-run Welcome wizard, or later
under Settings. Values in `.env` are only used as a fallback. If you last used TT-Studio when these
lived in the environment file, this is the change most likely to trip you up.
:::

## Boards TT-Studio detects

Detection runs `tt-smi` and maps the reported board type and card count onto a device
configuration.

| Family | Configurations |
| :--- | :--- |
| Wormhole | E150, N150, N300, N150X4, T3K (4 × N300) |
| Blackhole | P100, P150, P300, P150X4, P150X8, P300x2 (QuietBox 2), P300Cx4 |
| Galaxy | GALAXY, GALAXY_T3K |

On a QuietBox 2 you can set `IS_QB2=true` in `.env` to have startup verify the board through
`tt-smi` before continuing. It's off by default so that a dev laptop, a cloud run, or a different
board isn't held to that check.

## What runs on what

Complete models over total models in the catalog, per board. A dash means nothing in the catalog
targets that combination.

| Board | Chat | Vision-lang. | Image | Video | Speech-to-text | Text-to-speech | Embeddings | Classification |
| :--- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| N150 | 2/8 | 0/4 | 3/3 | — | 2/2 | 1/1 | 0/3 | 3/7 |
| N300 | 2/10 | 0/6 | 3/3 | — | 2/2 | 1/1 | 0/3 | 3/7 |
| N150X4 | 0/2 | — | — | — | — | — | — | — |
| T3K | 4/14 | 0/9 | 6/8 | 1/1 | 2/2 | — | 0/3 | — |
| P100 | 1/1 | — | — | — | — | — | — | — |
| P150 | 1/1 | — | — | — | 2/2 | 1/1 | — | — |
| P150X4 | 2/2 | — | 2/2 | 1/1 | — | — | — | — |
| P150X8 | 3/3 | — | 2/2 | 1/1 | — | — | — | — |
| P300 | 1/1 | — | 2/2 | — | — | — | — | — |
| P300x2 (QuietBox 2) | 3/3 | — | 2/2 | 1/1 | 2/2 | 1/1 | — | — |
| GALAXY | 3/8 | 0/2 | 6/8 | 1/1 | 2/2 | — | 0/3 | — |
| GALAXY_T3K | 3/8 | 0/2 | — | — | — | — | — | — |

Counts are from tt-inference-server artifact v0.18.0 (54 entries, 17 complete). Two things the
table can't show:

- **P300Cx4 is detected but no catalogued model targets it.** The board comes up and telemetry
  works; the model list will be empty.
- **YOLOv4 object detection isn't in the table.** It predates the synced catalog and is defined
  separately, on Wormhole boards only.

### Rules of thumb

- **A single Wormhole card (N150, N300)** covers 8B-class chat, all three complete image models,
  both Whisper variants, text-to-speech, and the classification models. This is the broadest
  single-card story.
- **T3K or a QuietBox 2** is where the large chat models, FLUX, and video generation become
  available.
- **A single Blackhole card (P100, P150, P300)** currently runs Llama-3.1-8B-Instruct for chat;
  P150 adds speech, P300 adds image generation.
- **Galaxy** has the widest chat and image coverage.

(no-tenstorrent-hardware)=
## No Tenstorrent hardware

### Remote endpoints

Point the UI at models already running on cards somewhere else. Set `VITE_ENABLE_DEPLOYED=true` and
fill in the URL and auth-token pairs for the endpoints you have:

```bash
CLOUD_CHAT_UI_URL=
CLOUD_CHAT_UI_AUTH_TOKEN=
CLOUD_YOLOV4_API_URL=
CLOUD_YOLOV4_API_AUTH_TOKEN=
CLOUD_SPEECH_RECOGNITION_URL=
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN=
CLOUD_STABLE_DIFFUSION_URL=
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN=
```

The home page switches to the remote-endpoint view and you get chat, object detection,
speech-to-text and image generation. You do **not** get local deployment, board telemetry, the
voice pipeline, or video generation.

### The echo model

There is a CPU-only echo model in the catalog that needs no accelerator. Deploying it exercises the
real path — container start, health check, chat, logs — so it's the right choice for CI, for a
laptop, and for anyone working on the frontend.

→ [Run TT-Studio with no Tenstorrent card](../examples/run-without-a-tenstorrent-card.md)

## Run modes

`run.py` picks the right Docker Compose overlays for the situation.

| Mode | How it's chosen | What it does |
| :--- | :--- | :--- |
| Standard | Default | Builds and runs the published images |
| Development | `--dev` | Mounts your local source into the backend and frontend for hot reload |
| Hardware | Automatic when `/dev/tenstorrent` exists | Passes the device through to the containers |
| Production | Deployment configuration | Production serving settings |

## Next steps

- [Quickstart](quickstart.md) — get it running
- [Setup reference](setup-reference.md) — the full prerequisite and configuration detail
- [What you can build](use-cases.md) — pick a first thing to try
