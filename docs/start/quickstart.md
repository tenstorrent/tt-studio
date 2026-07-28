# Quickstart

From an empty directory to a model answering questions. On a machine with a Tenstorrent card this
takes about ten minutes, most of it spent downloading model weights.

If you aren't sure your machine qualifies, check
[Will it run on my machine?](will-it-run.md) first.

## 1. Check you're ready

- Python 3.8 or newer
- Docker and Docker Compose, with your user in the `docker` group
- A Hugging Face token, for gated models such as Llama
- Tenstorrent drivers installed, if you have a card

:::{note}
You don't need to create a virtual environment. `run.py` creates and manages its own.
:::

## 2. Clone and run

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py
```

That single command does all the setup: it fetches the tt-inference-server artifact, writes your
`.env`, works out which Docker Compose overlays your hardware needs, and starts every container.

Along the way you'll see it detect your board, and a **Welcome wizard** will open in the browser
asking for your Hugging Face token. You can skip the wizard and add keys later under Settings —
nothing is permanent.

When it finishes, TT-Studio is at **<http://localhost:3000>**.

:::{tip}
Run `python3 run.py --install-shortcut` once and you can start it from any directory afterwards by
typing `tt-studio`.
:::

## 3. Deploy your first model

The home page walks you through choosing hardware and a model.

Pick **Llama-3.1-8B-Instruct**. It's marked complete, and it's the one chat model that lists every
board from a single N150 upward, so it works whatever you have. Larger models are more interesting
but need a T3K, a QuietBox 2, or a Galaxy.

The first deploy downloads weights, so it takes a while. The progress bar tracks the image pull and
the container start; the model appears as healthy when it's ready to serve.

## 4. Say hello

Once the model reports healthy, **Chat** appears in the navigation. Open it, pick your model, and
ask it something.

Under each reply you'll get the tokens-per-second and time-to-first-token measured on your own
hardware, which is a more honest benchmark than anything you'll read online.

## 5. Where to go next

Pick whichever is closest to what you came for:

| You want to | Go to |
| :--- | :--- |
| Ask questions about your own documents | [Chat with your documents](../examples/chat-with-your-documents.md) |
| Use your box from your editor | [Point a coding agent at your own box](../examples/coding-agent-on-your-own-box.md) |
| Talk to it out loud | [A voice assistant that greets you by name](../examples/voice-assistant-that-knows-you.md) |
| Generate images or video | [Generate images and video](../examples/generate-images-and-video.md) |

## 6. Stopping and cleaning up

```bash
python3 run.py --stop        # stop the containers, keep your data
python3 run.py --status      # live view of services, models and board health
python3 run.py --logs        # follow the logs from every container
python3 run.py --info        # re-print the URLs and hardware summary
```

:::{warning}
`python3 run.py --purge-all` also deletes the persistent volume and your `.env`. Downloaded model
weights, RAG collections and deployment history all go with it. Use `--stop` unless you genuinely
want a clean slate.
:::

## If it didn't work

```bash
python3 run.py --verbose      # re-run with full output
python3 run.py --report-bug   # bundle the logs and open a pre-filled GitHub issue
```

`--report-bug` collects logs from every container into a ZIP and opens an issue with the details
already filled in — it's the fastest way to get help, and it's offered automatically if setup
fails.

## Next steps

- [What you can build](use-cases.md) — the wider surface
- [Setup reference](setup-reference.md) — every flag and environment variable
- [Examples](../examples/index.md) — worked walkthroughs
