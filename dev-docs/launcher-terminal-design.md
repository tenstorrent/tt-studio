# TT Studio Launcher — Terminal Design Language

How `python run.py` (the `tt_setup/` launcher) renders to the terminal. Read this before
touching launcher output so the UX stays consistent. **All terminal output goes through the
shared Rich layer in `tt_setup/console.py` — not raw `print()` + ANSI.**

> Scope: the host-side launcher in `tt_setup/`. Not the Django backend, the frontend, or
> anything inside Docker containers.

---

## TL;DR (the rules that matter most)

1. **Render through `tt_setup/console.py`.** Use `console.print("[success]✓ …[/success]")`, the
   theme styles, `step()`, the phase API, and the panel builders. Don't add raw
   `print(f"{C_GREEN}…{C_RESET}")` — the legacy `C_*` ANSI constants in `constants.py` still
   exist but are not for new code.
2. **Minimal by default; `-v` reveals everything.** Routine "done" output is *folded* (hidden) on
   a normal run and shown with `--verbose/-v`. Gate it with **`show_detail()`** — never bare
   `not in_phase()` (that would also hide it under `-v`).
3. **Keep progress, fold confirmations.** KEEP live "working" indicators (spinners, `🔓 Freeing…`,
   `🔧 Starting…`, `⏳ Waiting…`, download bars). FOLD completion confirmations
   (`✅ … ready at <url>`, `(cached)`, "Freed N ports: …").
4. **Always show failures, prompts, and actionable warnings** — never fold those.
5. **Never wrap an interactive prompt (`input()`/`getpass`) in a capturing `step()` or an active
   phase spinner** — it hides the prompt and hangs. Suspend/pause around prompts, sudo, and the
   Docker build.
6. **Only one Rich `Live`/`status` at a time.** The phase spinner, `step()` spinner, and the
   Docker build `Progress` all use Live — suspend the phase spinner around the build and prompts.
7. **Degrade cleanly on non-TTY / piped logs** (no escape-code garbage) and **never import Rich in
   `bootstrap.py`** (it runs before Rich is installed — stdlib only).

---

## Theme palette (`TT_THEME` in console.py)

| Style | Color | Use for |
|---|---|---|
| `info` | cyan | neutral status, values |
| `success` | green | `✓` / confirmations |
| `warning` | yellow | non-fatal warnings, "kept/skipped" |
| `error` | bold red | failures, fatal errors |
| `muted` | dim | secondary detail, hints, folded-by-nature text |
| `accent` | purple `color(99)` (brand, == legacy `C_TT_PURPLE`) | panel borders/titles, headings |

Markup form: `console.print("[accent]…[/accent]")`, `console.print(x, style="error")`. Combine
attributes like `[bold accent]`. Escape user-derived text with `rich.markup.escape` (or
`markup=False`) so a stray `[` doesn't get parsed (see `env_config.render_hf_access`).

---

## Core components (all in `tt_setup/console.py`)

### `step(label, spinner=True)` — one calm phase line
Context manager: shows `label…` (live spinner on a TTY), captures the block's stdout/stderr to
`startup.log`, then collapses to `✓ label` — or `✗ label` + the captured output on failure.
Handle methods: `s.detail("3 removed")` (muted suffix), `s.skip("nothing to stop")` (`○`),
`s.fail()`. Use `spinner=False` when the block may prompt for a sudo password.

```python
with step("Stopping containers") as s:
    n = do_work()
    s.detail(f"{n} container(s)")
```

### Phases — the collapsing startup structure
Startup is a **fixed set of numbered phases** (currently `Checks · Configure · Services · Build ·
Launch`, i.e. `k/5`). Fixed count = `k/N` never drifts with flags. Each phase shows a spinner
naming the current sub-step, then **collapses to a single divider rule that sweeps in left→right**.

API:
- `begin_phase(index, total, title)` → handle; starts the spinner.
- `handle.set("activity")` — update the spinner's current sub-step.
- `handle.suspend()` / `handle.resume()` (and `with handle.pause():`) — stop the spinner around
  work that prompts, sudos, or runs its own `Live` (e.g. the Docker build `Progress`).
- `handle.fail()` — render `✗` on collapse.
- `end_phase(handle)` — collapse to `✓ Phase k/N · Title ────` (animated sweep on a TTY,
  instant on non-TTY).
- `stop_active_phase()` — stop the spinner WITHOUT printing a line; call from error/interrupt
  handlers so a `Live` doesn't corrupt a following panel (cli.py's `except SystemExit/Exception`).
- `in_phase()` → bool; `show_detail()` → `is_verbose() or not in_phase()`.

Because phases use the imperative `begin_phase/…/end_phase` (not a `with`), the error paths in
`cli.py` (`except SystemExit:` etc.) must call `stop_active_phase()` to clean up the spinner.

### Panels — `box.ROUNDED`, accent border, title in the top border
- `welcome_panel(title, left_lines, sections, logos=None, tagline=None)` — the Claude-Code-style
  launch box: title in border, optional centered ASCII logo(s) + tagline, two-column body. Logos
  render via `Text(no_wrap, overflow="crop")` and the panel is pinned to `_PANEL_WIDTH` (78) so a
  **terminal resize doesn't reflow/garble the art**.
- `ready_panel(title, rows, footer_lines)` — post-startup summary card (endpoints/mode + hints).
- `kept_panel(title, rows, footer_lines)` — muted-border "what was preserved" card (after `--stop`).
- `notice_panel(title, lines, border_style)` — generic callout (warnings/errors, e.g. the tt-smi
  warning, the podman warning, the interrupt/error panels). Content-sized (`expand=False`).

### Live helpers
- `progress_status(label)` — a transient `console.status` spinner for waits (replaces hand-rolled
  `\r` loops). Auto-disables on non-TTY.
- `download_with_progress(url, dest, label)` — Rich download bar on the real terminal.

---

## The folding model (minimal-by-default)

`show_detail()` returns `is_verbose() or not in_phase()`. Gate routine "done" output on it:

```python
if show_detail():
    console.print("[success]✅ Docker Control Service ready at http://localhost:8002[/success]")
```

- Inside a phase on a normal run → **folded** (the phase rule is the "done" signal; endpoint URLs
  live in the ready card).
- With `-v` → **shown** (un-hidden).
- Outside any phase → shown.

The same idea (verbose-gating) is used for the update-check "couldn't reach GitHub" notes
(`startup_checks.py`), the HF-access success line and "Environment configured"
(`env_config.py`), the freed-ports breakdown (`services.py`), and the "(cached)" lines
(`inference_server.py`). **Failures, prompts, and actionable warnings are never gated.**

---

## What the user sees

**Startup (`python run.py [--dev]`)**
```
╭─ TT Studio · <branch> ───────────────╮   welcome_panel (logo + tagline + context)
│ … tenstorrent art … TT Studio …      │
╰──────────────────────────────────────╯
✓ Up to date · tt-studio + artifact        update check (warns if behind; notes hidden unless -v)
✓ Phase 1/5 · Checks ───────────────        each phase: spinner while running → swept rule
✓ Phase 2/5 · Configure ────────────
✓ Phase 3/5 · Services ─────────────
✓ Phase 4/5 · Build ────────────────
✓ Phase 5/5 · Launch ───────────────
╭─ TT Studio is ready ─────────────────╮   ready_panel (URLs, mode, stop/logs hints)
╰──────────────────────────────────────╯
```
Failures (HF 401 + gated-model links), prompts (token choice), and behind-origin warnings break
through under their phase. `-v` un-folds all the routine detail.

**Stop (`python run.py --stop`)** — `Stopping TT Studio` → `✓ Stopping services` → `Preserved`
panel → `✓ Stopped`. If the Docker daemon is down it skips container teardown gracefully (no raw
"Cannot connect to the Docker daemon" leak) and stops only the host services.

**Errors / Ctrl-C** — themed `notice_panel`s (resume/clean-up/help, or error + next steps).

---

## File map

| File | Responsibility |
|---|---|
| `tt_setup/console.py` | **The design system**: console, theme, `step()`, phases, panels, `show_detail`, progress helpers. Start here. |
| `tt_setup/cli.py` | `main()`/`_run()` orchestration; defines the 5 phases; flag parsing (`--stop`/`--purge-all`, deprecated `--cleanup`/`--cleanup-all`); interrupt/error panels. |
| `tt_setup/shell.py` | `display_welcome_banner()` (welcome_panel), `run_preflight_checks()`, `check_tt_smi()`. |
| `tt_setup/startup_checks.py` | Update/freshness check (up-to-date / behind / notes). |
| `tt_setup/env_config.py` | Interactive env/secrets config + `render_hf_access` (gated-model access + links). Heavy interactive prompts — keep them bare. |
| `tt_setup/services.py` | Port-freeing, FastAPI + Docker-Control lifecycle, health waits. |
| `tt_setup/inference_server.py` | Artifact download/extract, model-catalog sync. |
| `tt_setup/docker.py` | `check_docker_installation()` (links-only guidance, podman/Compose-v2 guard), compose-command building, `fix_docker_issues`. |
| `tt_setup/cleanup.py` | `--stop` / `--purge-all`: teardown, Preserved panel, daemon-down handling, `--purge-all` inventory. |
| `tt_setup/docker_diag.py` | Build `Progress` + container/build failure diagnostics. |
| `tt_setup/bootstrap.py` | Pre-Rich venv bootstrap — **stdlib only, no Rich**. |
| `tt_setup/constants.py` | Legacy `C_*` ANSI + ASCII art constants. |

---

## Conventions & gotchas

- **Docker errors link, they don't fix.** `check_docker_installation` points to official docs
  (`get-docker`, `compose/install`, daemon docs) and exits — no `--fix-docker` advertising, no
  `sudo service docker start` steps (Linux-only, wrong on macOS). Genuine-Docker runtimes (Docker
  Desktop, Colima, OrbStack, Rancher Desktop) must never be flagged as podman — detection uses
  *positive* podman signals only (`docker --version`/banner; `PodmanAPIVersion` in `docker info`).
- **Compose v2 only.** `docker compose` (v2 plugin), not legacy `docker-compose` / podman-compose.
- **Commands.** `--stop` / `--purge-all` are current; `--cleanup` / `--cleanup-all` are hidden
  deprecated aliases that warn and normalize. Output wording follows the command
  ("Stopping/Stopped", not "Cleaning up").
- **SPDX headers** are mandatory on new code files (`.py/.ts/.tsx/.js`) — not on `.md`.

## How to add output

- A milestone with a spinner that collapses → use a **phase** (`begin_phase`/`set`/`end_phase`) or
  a `step()` if it's standalone (outside the phase flow).
- A routine "done" line → gate on `if show_detail():`.
- A grouped summary / callout → a panel (`notice_panel` for warnings/errors, `ready_panel`/
  `kept_panel` for summaries).
- Anything that prompts/sudos/uses its own `Live` inside a phase → wrap in `with ph.pause():` (or
  `ph.suspend()/resume()`), and never let a prompt sit inside a capturing `step()`.

## Verifying changes

- `python -m py_compile tt_setup/*.py` and import the edited modules.
- `python -m pytest tests/ -q` (must stay green).
- Render checks: exercise panels/phases via a small script; **pipe through `| cat -v`** to confirm
  non-TTY emits no raw escape sequences.
- Interactive-safety: grep that no `getpass`/`input(` sits inside a `with step(` block or an
  un-suspended phase.
- Try `COLUMNS=80` and `COLUMNS=120` for panel/rule width behavior, and `-v` to confirm folded
  detail returns.
- The live spinner animation, the rule sweep, and real interactive prompts only show on a true
  terminal — confirm those on actual hardware.
