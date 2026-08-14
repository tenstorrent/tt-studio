---
name: cli-design
description: >-
  The complete CLI design language distilled from TT-Studio's `python run.py`, made
  portable to any repo: the command surface (one self-bootstrapping entrypoint,
  grouped `--help` panels, early-dispatch utility flags, lifecycle symmetry,
  re-viewable state), the run's spine (a fixed phase stepper, one collapsing line
  per step, minimal-by-default folding with `-v`), progress parsed out of subprocess
  streams, failures rendered as diagnosis cards instead of log dumps, lenient
  defaults with opt-in strictness, and the testing/verification patterns that keep
  it honest. Use when building a setup/launcher/dev-tool CLI, adopting this style in
  another repo, or cleaning up a CLI that dumps raw tool output, tracebacks, or
  ungrouped flags — and whenever someone says the CLI "looks bad". Ships runnable
  reference files (`cli_skeleton.py`, `console.py`, `demo.py`, tests) plus a
  one-command `install.py`.
---

# CLI design

How to build a CLI that orchestrates messy tools (Docker/compose, package installs,
downloads, background services) and still reads like something a person designed.
The tools emit thousands of lines; the user needs about twelve. This is the whole
design — command surface, run structure, output, failures, checks, testing — and
nothing in it is specific to one repo.

## Install into another repo

```bash
python3 install.py ../other-repo                        # skill + reference files
python3 install.py ../other-repo --module-dest mycli/console.py   # …and wire the module in
python3 install.py --user                               # available in every repo on this machine
```

Then see the design run before adopting it:

```bash
python3 reference/demo.py            # the output language, ~15s   (--fail for failure paths, -v for verbose)
python3 reference/cli_skeleton.py --help   # the command surface  (then: no flags, --info, --stop)
```

| File | What it gives you |
|---|---|
| `reference/cli_skeleton.py` | a working CLI in this design: bootstrap → parse → early dispatch → phases → ready card |
| `reference/console.py` | the output layer (Rich only): theme, `step()`, phases, activity row, cards |
| `reference/demo.py` | runnable tour of every output element; doubles as a smoke test |
| `reference/patterns.md` | the four failure/progress patterns, with before/after and tests |
| `reference/test_cli_output.py` | copy into `tests/`: pure helpers, stream parsing, PTY + non-TTY render checks |

Reference implementation in the wild: TT-Studio's `tt_setup/` (+ its house-rules doc
`dev-docs/launcher-terminal-design.md`).

---

## 1. The shape of the CLI

**One entrypoint.** `python run.py` (or `mycli`) does everything: setup, start, stop,
purge, logs, status, bug reports. Not a script per task, not a Makefile the user has
to read. One name to remember, discoverable from `--help`.

**It bootstraps itself.** First run creates the managed venv, installs deps, and
re-execs. The user needs a python3, nothing else. That bootstrap code runs *before*
your dependencies exist — stdlib only, and it must never import your pretty layer.
Mimic the style by hand there (a plain stdlib spinner is ~15 lines).

**Flags are grouped, because `--help` is documentation.** A fixed set of panels —
*Setup · Lifecycle · Reset · Advanced · Troubleshooting* — so a new flag has an
obvious home and `--help` stays skimmable. (Typer: `rich_help_panel=`; argparse:
`add_argument_group` — see `cli_skeleton.py`.)

**Name flags as actions, and match the wording of their output.** `--stop` prints
"Stopping… / Stopped", never "Cleaning up". Destructive flags say what they destroy
(`--purge-all`) and confirm first. Deprecated flags stay as hidden aliases that warn
and normalize onto the current name — never break someone's muscle memory or script.

**Early dispatch.** Utility/lifecycle flags (`--stop`, `--info`, `--logs`,
`--status`, `--report-bug`) do their work at the top of the run function and
**return before any phase starts**. Only flags that modify a normal run fall through
to the phases. This single rule is what keeps a launcher from turning into a maze of
conditionals inside the startup flow.

**Lifecycle commands are symmetric and honest about data.** `--stop` keeps data and
says so with a *Preserved* card; `--purge-all` removes it and confirms first. A
teardown gets the same calm steps as a startup — it is a first-class command, not an
afterthought.

**Make state re-viewable and hints discoverable.** The end-of-run card is produced by
*one* renderer that probes live state, and the same renderer backs `--info`. Its
footer advertises the next actions (`--stop`, `--logs`, `--info`). Never duplicate
the assembly — a second copy drifts within a month.

## 2. The run's spine

A **fixed** set of phases (`Checks · Configure · Build · Launch`), so `k/N` never
drifts with flags and the denominator is trustworthy. Each phase shows a stepper
(done / current / pending), labels its body with a rule, and collapses to one line.
Inside a phase, each operation is one `step()` that collapses to `✓ label  1.2s`.

```
✓ Checks ── ✓ Configure ── ◉ Build ── ○ Launch
Build ───────────────────────────────────────
  ✓ chroma pulled
  ○ Prebuilt images for sha-abc123 aren't published — using local images
⠹ Pulling images  ▕████████░░░░░░▏  2/5 images · 143 MB
```

Four zones, each with exactly one job:

| Zone | Job | Never |
|---|---|---|
| Stepper | where am I in the whole run | per-tool detail |
| Phase body | milestones + notes, ~1 line each | raw child output |
| Activity row | proof it's alive, what it's doing now | history |
| Cards | grouped state: welcome, ready, preserved, failure | anything transient |

## 3. Output rules

**The one-sentence rule: every line the user sees is a decision you made; nothing
reaches the terminal because a subprocess happened to print it.** Raw tool output is
evidence, not UI — capture it, keep it in a log, surface a sentence you wrote.

1. **Render through one console module.** No scattered `print(f"{GREEN}…")`. One
   module owns theme, `step()`, panels, progress helpers.
2. **Minimal by default, `-v` reveals everything.** One predicate:
   `show_detail() = verbose or not in_phase()`. Gate routine "done" lines on it.
3. **Keep progress, fold confirmations.** A live spinner earns its space; "✓ done in
   0.3s" eleven times does not. The collapsed phase line *is* the confirmation — don't
   also print "✅ X ready".
4. **Never fold failures, prompts, or actionable warnings.** They are why the user is
   watching.
5. **Capture subprocess noise; surface it only on failure.** `step()` captures
   stdout/stderr and reveals the buffer only when the block fails. For children that
   write to the tty, pass `stdout=DEVNULL, stderr=STDOUT` and let them log to a file —
   `redirect_stdout` is Python-level and does **not** reach a subprocess. (This is the
   #1 cause of `⠧ Starting service…Failed to start service…` collisions.)
6. **One live display at a time.** Spinner, phase pulse, download bar all own the
   cursor. Suspend the outer one around prompts, sudo, and anything with its own
   `Live`. Never wrap an `input()`/`getpass` in a capturing step.
7. **Degrade cleanly on non-TTY.** Piped output must contain zero escape codes.
8. **Pad renderables, don't indent strings** — a wrapped note must keep its indent.

## 4. Failures: diagnose, don't dump

The instinct is `print(last_15_log_lines)`. That is a worse version of the log file:
no cause, no next step, and it scrolls the good stuff away. Classify instead, in a
**pure** function (text in, dict out — so it's unit-testable), then render one card:
**cause in the title, one line of evidence, the consequence, then what to try.**

```
╭─ Docker Control service didn't start — port 8002 is still taken ────────────╮
│  Another process was holding port 8002 when the service tried to bind.      │
│  Log · ERROR:    [Errno 98] Address already in use                          │
│                                                                             │
│  Startup continues — the backend falls back to the Docker SDK.              │
│                                                                             │
│  Try:                                                                       │
│    lsof -i :8002                                                            │
│    myapp --stop, then re-run                                                │
╰─────────────────────────────────────────────────────────────────────────────╯
```

- **Always name the consequence** — fatal, or does the run continue?
- **Give a fix *and* an escape hatch** ("install the driver, **or** unset `X` to run
  without one").
- **Link docs; don't offer to fix the user's machine.** No `sudo service docker start`
  guesses.
- **Never a bare traceback.** Under `-v`, sure.
- **Render the card after the step collapses**, never inside the capturing block.
- **Ctrl-C gets a card too**: what state the machine is in, how to resume or clean up.

**Expected failures are notes, not errors.** A registry with no image for an unmerged
branch, an optional service missing, no network — one muted line stating the accurate
cause and what happens instead: `○ Prebuilt images for sha-abc123 aren't published —
using local images`. Guessing the cause is worse than saying nothing ("registry
unreachable" when the registry answered fine).

**And check whether the *behaviour* is bad, not just the output.** TT-Studio's
port-conflict card was covering for a race the launcher caused itself (free the port,
bind immediately). Waiting for the port to actually release deleted the error. The
best version of an error message is the run that never needs it.

## 5. Progress out of a stream you don't control

You rarely get a progress API — you get lines. Parse them into (a) milestones worth a
`✓` and (b) one activity label that updates in place. Keep the aggregator pure
(`feed(line) → event | None`, `activity() → str`), and **pick a denominator you
actually know**: piped `docker compose pull` reports bytes per layer but no layer
totals, so count *images* (exact) and show bytes as a counter. An honest
`2/5 images · 143 MB` beats a fake percentage. Force plain tool output
(`BUILDKIT_PROGRESS=plain`) so the stream is parseable, keep it off fd 1, and pulse
while nothing prints — that's what separates "working" from "hung". Full worked
example: `reference/patterns.md` §3.

## 6. Checks and environment

- **Lenient defaults; strict is opt-in.** Never block a dev laptop or a
  no-hardware/cloud box out of the box. Strict checks are opt-in (a flag or env var)
  or gated on a real signal (the tool is installed, the device node exists).
- **Assume and verify, never assume and trust.** If config claims something ("this is
  a QB2"), check it against reality and surface the mismatch instead of trusting it.
- **Fail fast, at the earliest phase**, when something is genuinely wrong — with a fix
  and an escape hatch.
- **Config lives in one place** (`.env` from a checked-in default), documented behind
  its own flag (`--help-env`).

## 7. Structure, docs, and keeping them in sync

- **Focused submodules, one public surface.** Split by concern
  (`console/`, `services/`, `cleanup/`, …) and have each package's `__init__.py`
  re-export its public names, so callers' imports never churn when you move code.
- **Watch the `import *` blind spot.** If submodules do `from .constants import *`,
  linters downgrade undefined-name detection — a name you use but forgot to import
  won't be flagged and will crash at runtime. Keep a test that walks the modules.
- **Extract pure helpers** for anything with branching logic (classification, label
  resolution, wording) so the matrix is testable without a TTY, hardware, or Docker.
- **Write the house-rules doc** (what TT-Studio keeps in
  `dev-docs/launcher-terminal-design.md`) and point contributors at it. When you add a
  flag, update `--help`, the docs table, and the tests in the same commit.

## 8. Verifying it

```bash
python -m pytest tests/ -q                        # pure parsers/classifiers/wording
mycli | cat -v | grep -c '\^\['                   # non-TTY: expect 0 escape codes
COLUMNS=80 mycli; COLUMNS=120 mycli               # panel/rule widths
mycli -v                                          # folded detail returns
mycli --help                                      # flags still grouped and named right
```

Anything animated needs a real PTY (`pty.spawn`) — assert the spinner advances, the
row is erased (`\r\033[2K`) before the result, the stepper fills in, and any scroll
region is reset on **every** exit path including Ctrl-C. `reference/test_cli_output.py`
has all of these ready to copy. And reproduce failures for real — point at a
nonexistent image, occupy the port, unplug the network. Mocked errors teach your
parser the wording you imagined, not the wording the tool prints.

## Anti-patterns

| Symptom in the terminal | What it means | Fix |
|---|---|---|
| `Error response from daemon: failed to resolve reference "…"` | raw child stderr is UI | capture; classify; one note |
| `⠧ Starting service…Failed to start…` on one row | a child wrote to the inherited tty | `stdout=DEVNULL`, log to file |
| 15 log lines after a `✗` | dumping instead of diagnosing | classify → card |
| The same status line three times | tool restates state each poll | dedupe by line |
| "Registry unreachable" when it wasn't | guessed cause | classify from real output |
| `✅ X ready` under a `✓ Phase` line | double confirmation | gate on `show_detail()` |
| Wrapped text starting at column 0 | note printed without padding | pad the renderable |
| `--help` as one flat list of 30 flags | no grouping | fixed `rich_help_panel` groups |
| `--stop` printing "Cleaning up…" | flag and output disagree | name it once, use it everywhere |
| Lifecycle flags handled mid-startup | no early dispatch | do the work and return at the top |

## Adoption path

Front-loaded payoff — stop wherever it's good enough:

1. `python3 install.py <repo>`; run the demo and the skeleton to see the target.
2. Copy `console.py` into your CLI package; wrap each long operation in `step()`.
   (This alone deletes most of the noise.)
3. Route remaining `print`s through the theme, gated on `show_detail()`.
4. Declare the phases; move lifecycle flags to early dispatch; group the `--help` flags.
5. Replace log dumps with diagnosis cards; turn expected failures into notes.
6. Add stream parsing for your slowest command.
7. Copy `test_cli_output.py` into `tests/`; write your own house-rules doc.
