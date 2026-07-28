# Deploy a model in one command

## What you'll build

A box that comes up with a model already running, without anyone clicking through the UI — useful
for a shared machine, a demo you don't want to set up live, or a benchmark run. Then the day-two
commands for keeping an eye on it.

## You'll need

- A model your board supports. Check [Will it run on my machine?](../start/will-it-run.md).
- A Hugging Face token already configured, if the model is gated. On a first run this is entered in
  the Welcome wizard; after that it's stored and reused.

## Steps

### 1. Bring the stack up with a model

```bash
python3 run.py \
  --auto-deploy Llama-3.1-8B-Instruct \
  --device-id 0 \
  --no-browser \
  --wait-for-services
```

- `--auto-deploy` takes the model name and deploys it once startup finishes.
- `--device-id` is the chip slot, 0–7. Leave it at the default unless you're placing models
  deliberately.
- `--no-browser` stops it opening a window, which you want on a headless box.
- `--wait-for-services` blocks until everything reports healthy, so the command only returns when
  the box is actually ready. That's what makes it usable from a script.

:::{note}
Multi-chip models generally want the whole board rather than a pinned chip. Don't set
`--device-id` for those.
:::

### 2. Watch it

```bash
python3 run.py --status
```

A live terminal monitor: service health, deployed models, board state. Leave it open on a second
screen while you work.

### 3. Everything else you'll want

```bash
python3 run.py --info        # re-print URLs, mode and hardware summary
python3 run.py --logs        # follow logs from every container
python3 run.py --stop        # stop containers, keep the data
```

## Day-two operations

**In the UI.** The footer shows live board telemetry and chip occupancy. There's a device reset for
a card in a bad state, and thermal snapshots and alerts under board control. **Deployment History**
lists every deploy with its outcome, which is the first place to look when something that worked
yesterday doesn't today.

**Moving between versions.**

```bash
python3 run.py --switch v2.9.0     # move the checkout to a tag or branch, then exit
python3 run.py                     # re-run to start on the new version
python3 run.py --resync            # force a model-catalog resync
```

**Making it convenient.**

```bash
python3 run.py --install-shortcut  # adds a `tt-studio` command
```

After that, `tt-studio --status` works from anywhere.

**When something breaks.**

```bash
python3 run.py --verbose
python3 run.py --report-bug
```

`--report-bug` bundles logs from every container into a ZIP and opens a pre-filled GitHub issue.

:::{warning}
`--purge-all` removes the persistent volume and `.env` along with the containers — downloaded
weights, RAG collections and deployment history all go. Use `--stop` for anything routine.
:::

## Make it yours

**Put it in a unit file.** Because `--wait-for-services` blocks until healthy, the command works as
a `systemd` `ExecStart` without extra readiness polling.

**Deploy several models.** Run the stack once, then deploy the rest from the UI or the API. Chip
capacity is validated before each deploy, so you'll be told rather than discovering it at runtime.

**See every flag.**

```bash
python3 run.py --help        # all flags, grouped
python3 run.py --help-env    # every environment variable
```

## Troubleshooting

**`--auto-deploy` finds no such model.** The name must match the catalog exactly. Copy it from the
model list in the UI, or run `--resync` if you think the catalog is stale.

**The deploy fails immediately on a multi-chip board.** Drop `--device-id` — pinning a chip for a
model that wants the whole board will fail.

**It hangs on first run.** The first deploy of a large model downloads weights, which can take a
long time. `--logs` will show the pull progressing.

## Next steps

- [Point a coding agent at your own box](coding-agent-on-your-own-box.md) — put the deployed model to work
- [Setup reference](../start/setup-reference.md) — the full flag and environment reference
