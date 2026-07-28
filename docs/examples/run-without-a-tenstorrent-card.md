# Run TT-Studio without a Tenstorrent card

## What you'll build

A working TT-Studio on a machine with no accelerator. There are two ways to do this and they solve
different problems, so start by deciding which one you want.

| | Remote endpoints | The echo model |
| :--- | :--- | :--- |
| **Use it when** | You have access to models running on cards elsewhere | You want to exercise TT-Studio itself |
| **You get** | Real inference: chat, object detection, speech-to-text, image generation | A model that echoes your input back |
| **You don't get** | Local deployment, board telemetry, voice pipeline, video | Real inference of any kind |
| **Good for** | Using TT-Studio as a front end from a laptop | Frontend work, CI, demoing the deploy flow |

## Track A: remote endpoints

### 1. Turn on remote-endpoint mode

In `.env`:

```bash
VITE_ENABLE_DEPLOYED=true
```

### 2. Fill in the endpoints you have

Each service is a URL and a token. Set only the ones you actually have — the UI adapts to what's
configured.

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

### 3. Restart

```bash
python3 run.py --stop
python3 run.py
```

The home page is now the remote-endpoint view rather than the deployment stepper, because there's
no local hardware to deploy to.

### What works and what doesn't

Chat, object detection, speech-to-text and image generation all work against the remote cards.
Anything that depends on local hardware does not: you won't see board telemetry or chip status, you
can't deploy a model, and the voice pipeline and video generation are unavailable because they need
locally deployed models.

## Track B: the echo model

There is a CPU-only echo model in the catalog. It answers by repeating what you send it, which is
useless as a model and extremely useful as a test: deploying it exercises the real path — image
pull, container start, health check, chat, logs — with no accelerator involved.

### 1. Start TT-Studio normally

```bash
python3 run.py
```

It will report that no Tenstorrent hardware was detected and carry on. That's expected.

### 2. Deploy the echo model

Find it in the model list and deploy it like any other. It's small and starts quickly.

### 3. Talk to it

Open **Chat** and send a message. You'll get your own message back. What you've just proved is that
the whole deployment and inference path works on this machine.

### 4. Read the logs

Open **Logs** to see the deploy from the inside. This is the fastest way to understand what
TT-Studio does when you press deploy, without waiting on a multi-gigabyte weight download.

## Make it yours

**Use it in CI.** The echo model needs no weights, no token and no hardware, which makes it a
reasonable smoke test for a pipeline that needs to know the stack still comes up.

**Develop the frontend against it.** Run `python3 run.py --dev` for hot reload, deploy the echo
model, and you have a responsive backend to build UI against on any laptop.

**Switch between the two.** Remote-endpoint mode is a single environment variable, so you can flip
back to local mode when you're next at a machine with a card.

## Troubleshooting

**The UI looks wrong after enabling remote mode.** `VITE_ENABLE_DEPLOYED` is read at build time by
the frontend, so the containers have to be restarted, not just reloaded.

**Remote endpoints return 401.** Each URL has its own token variable and they aren't
interchangeable. Check you've paired them correctly.

**Nothing appears in the model list without hardware.** Only models with no device requirement can
be deployed. The echo model is the one to look for.

## Next steps

- [Will it run on my machine?](../start/will-it-run.md) — what changes once you do have a card
- [Quickstart](../start/quickstart.md) — the full first run
