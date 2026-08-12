# Purging a Single Model (`--purge-model`)

`python run.py --purge-model` uninstalls everything belonging to one or more
specific models, without touching the rest of TT-Studio. It is the surgical
counterpart to `--purge-all`: your `.env`, chat history, RAG database, other
models, and the app stack all stay exactly as they are.

```bash
python run.py --purge-model                       # interactive picker
python run.py --purge-model Qwen3-32B             # one model
python run.py --purge-model Qwen3-32B --purge-model YOLOv4
python run.py --purge-model Qwen3-32B,YOLOv4      # same, comma form
python run.py --purge-model whisper -y            # partial name + skip prompt
```

## What gets removed

For each selected model, `--purge-model` removes up to five kinds of artifact.
Models deployed only briefly may have just one or two of these — anything not
found is simply skipped.

| Artifact | Where it lives | Notes |
| --- | --- | --- |
| Model weights | `tt_studio_persistent_volume/volume_id_<impl>-<model>-v<version>/` | Usually the big one (tens of GB). A model can have several versioned dirs; all are removed. |
| Docker weights volume | Docker named volume `volume_id_<impl>-<model>` | Created by the deployment pipeline, survives `compose down -v`. |
| Model env file | `tt_studio_persistent_volume/model_envs/<model>.env` | Per-model deployment settings. |
| Running container | `tt-inference-server-<uuid>` | Stopped and removed first (a live container pins its volume). The deployment record is marked stopped so the UI doesn't list a ghost. |
| Docker image | The `docker_image` tag from the model catalog | **Only when no other installed model shares the tag** — see below. |

An inventory of all of it, with sizes and a `Reclaims ≈ …` total, is shown
**before** anything is deleted, and nothing happens until you confirm (or pass
`--yes`/`-y` for scripted use). Answering `n` (or just pressing Enter) aborts
with nothing touched.

## The interactive picker

Run the flag bare and TT-Studio lists what is actually installed — models with
weights on disk, a Docker volume, or a live deployment — rather than the whole
catalog:

```
Installed models
  1.  Llama-3.1-8B-Instruct   31.2 GB
  2.  whisper-large-v3         2.9 GB   deployed
  3.  volume_id_old-thing-v0.0.1  1.1 GB   leftover files (not in catalog)

Models to purge (e.g. '1 3', or 'all'; Enter to cancel):
```

- Select several with spaces or commas (`1 3`, `2,3`), or everything with `all`.
- Press Enter (or `q`, or Ctrl-C) to cancel — nothing is deleted.
- Leftover `volume_id_*` directories that match no catalog model (from old
  versions or renamed models) show up as purgeable orphans under their raw
  directory name.
- The picker needs a real terminal. In scripts, pass model names instead.

## Naming models on the command line

Names are matched against the model catalog (the same names the deploy UI
shows, e.g. `Llama-3.1-8B-Instruct`):

- Exact and case-insensitive matches work as-is.
- A partial name works when it is unambiguous: `--purge-model whisper` resolves
  to `whisper-large-v3`.
- An unknown or ambiguous name aborts **before anything is removed** and
  suggests close matches — with several models named, it's all-or-nothing, so a
  typo never purges the rest of the list.

## Why was the image kept?

Model Docker images are shared: several models often run from the same tag
(most media models share one image, and vLLM tags cover multiple LLMs).
`--purge-model` reference-counts against the catalog and removes an image only
when **no other installed model** still uses it. Otherwise the inventory and
the final summary say so explicitly:

```
🐳  ghcr.io/tenstorrent/tt-media-inference-server:0.17.0-8c48a10   image kept — shared with speecht5_tts
```

Purge the remaining models that use the tag (in one command or later) and the
image goes with the last one.

## Troubleshooting

- **"still in use — run `python run.py --stop` first"** — a container TT-Studio
  couldn't map to the model is holding the Docker volume. Stop the stack
  (`python run.py --stop`) and re-run the purge.
- **Docker isn't running** — host-side files (weights, env file) are still
  purged; the Docker rows show `skipped (Docker not running)`. Re-run after
  starting Docker to remove the volume/image.
- **Root-owned weight files** — files written by containers are removed via an
  ephemeral cleanup container automatically. With `--no-sudo` and no Docker
  access they may be left behind (a warning says which paths).
- **Model not listed by the picker** — the picker only shows models with
  something on disk or deployed. A model you never deployed has nothing to
  purge.

## Relation to `--purge-all`

| | `--purge-model` | `--purge-all` |
| --- | --- | --- |
| Model weights / volumes | selected models only | all models |
| Images | only unshared tags | all TT-Studio images |
| `.env`, config, secrets | untouched | wiped |
| Chat history, RAG DB | untouched | wiped |
| App stack (frontend/backend) | untouched | torn down |

Use `--purge-model` to reclaim space from a model you're done with;
use [`--purge-all`](run-py-guide.md#reset) to reset TT-Studio to a fresh-clone
state.
