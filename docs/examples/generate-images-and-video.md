# Generate images and video

## What you'll build

Images, and — if your board is large enough — video, generated on your own hardware. No per-image
bill, and unreleased assets never leave the machine.

## Check your board first

This is where people most often get stuck: image and video models have much narrower hardware
requirements than chat models. Find your board here before deploying anything.

| Model | What it does | Boards |
| :--- | :--- | :--- |
| **SDXL base 1.0** | Text to image | N150, N300, T3K, Galaxy |
| **SDXL image-to-image** | Restyle an existing image | N150, N300, T3K, Galaxy |
| **SDXL inpainting** | Replace a masked region | N150, N300, T3K, Galaxy |
| **FLUX.1-schnell** | Text to image, few steps, fast | T3K, P300, P300x2, P150X4, P150X8, Galaxy |
| **FLUX.1-dev** | Text to image, higher quality | T3K, P300, P300x2, P150X4, P150X8, Galaxy |
| **Stable Diffusion 3.5 Large** | Text to image | T3K, Galaxy |
| **Wan 2.2 T2V** | Text to video | T3K, P300x2, P150X4, P150X8, Galaxy |

All of the above are marked complete. Qwen-Image is also in the catalog for T3K and Galaxy, but
it's functional rather than complete.

:::{admonition} On a single Wormhole card
:class: note

N150 and N300 get the three SDXL variants and nothing else. That's still text-to-image,
image-to-image and inpainting — a complete workflow. FLUX and video need a multi-chip board.
:::

## Steps

### 1. Deploy an image model

Start with SDXL base if you're on a single card, or FLUX.1-schnell if you're on a T3K or QuietBox 2
— schnell needs far fewer steps per image, which makes iterating on a prompt much less tedious.

### 2. Generate

Open **Image Generation**, enter a prompt, and generate. The first request after a deploy is slower
while the model warms up.

### 3. Iterate, then switch models

Work out your prompt on the fast model, then deploy FLUX.1-dev and re-run the prompt you settled
on. Schnell for exploration, dev for the final image, is the pattern that wastes the least time.

### 4. Add video

If your board supports it, deploy Wan 2.2 and open **Video Generation**. Video is substantially
slower than image generation — expect to wait, and start with short clips.

## Make it yours

**Edit instead of generating from scratch.** Deploy the image-to-image variant to restyle an
existing image, or the inpainting variant to replace part of one while keeping the rest. Both run
on the same single-card boards as SDXL base.

**Drive it from a script.** Image generation is exposed at `/v1/images/generations`, video at
`/v1/videos/generations`, both OpenAI-shaped. The API info page for the deployed model gives you a
working request to copy. Useful for generating a batch overnight.

**Watch the board.** Media models are heavy. The footer shows chip occupancy and telemetry — worth
keeping an eye on while a long video job runs.

## Troubleshooting

**The model you want isn't in the deploy list.** Your board isn't in its device configurations.
Check the table above; this is the usual cause.

**Deploy fails on a multi-chip board.** Media models often need the whole board rather than a
single chip. Don't pin a device ID unless you know the model supports it.

**Generation is very slow.** Confirm nothing else is deployed on the same chips. For iteration,
use FLUX.1-schnell rather than dev.

## Next steps

- [Will it run on my machine?](../start/will-it-run.md) — the full board and modality table
- [Deploy a model in one command](unattended-deploy.md) — skip the UI when you already know what you want
