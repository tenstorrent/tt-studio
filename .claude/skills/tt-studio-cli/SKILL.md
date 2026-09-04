---
name: tt-studio-cli
description: >-
  The TT-Studio CLI skill — how the `python run.py` command-line interface (the
  `tt_setup/` package) is built and how to change it the TT-Studio way: Typer CLI
  conventions (flag grouping, early-dispatch utility flags, `--help`/`--help-env`
  docs), package layout and the re-export pattern, the calm minimal-by-default
  terminal output, hardware/QB2 detection (IS_QB2 opt-in, verify-don't-trust), and
  the testing/verification patterns (pure helpers, PTY render checks). Use for any
  CLI work: BEFORE adding or changing a `python run.py` flag or its help text,
  editing anything under `tt_setup/` or its terminal output, touching
  startup/teardown flow, or changing hardware detection.
---

# TT-Studio CLI (`python run.py` / `tt_setup/`)

`python run.py` is the one entrypoint for everything (setup, start, stop, purge,
logs, status, bug reports). `run.py` itself is a thin shim: it bootstraps deps
into a managed venv and delegates to the **`tt_setup/`** package. `startup.sh` is
deprecated.

> Read this before touching the launcher. For the terminal-output design system
> specifically, `dev-docs/launcher-terminal-design.md` is the canonical reference —
> this skill covers the broader "how the launcher is built and how we like CLIs."

## Architecture

`run.py` → `tt_setup.bootstrap.ensure_environment()` (venv) → `tt_setup.cli.main()`.

The package is split into focused **subpackages**, each with an `__init__.py` that
**re-exports its prior public surface**:

| Area | Package / module |
|---|---|
| CLI surface + orchestration | `cli/` (`_args.py` = Typer flags, `_run.py` = phased flow + early dispatch) |
| Terminal design system | `console/` (`_theme`, `_stepper`, `_panels`, `_prompts`, `_steps`) |
| Env & secrets config | `env_config/` (`_values`, `_dotenv`, `_preferences`, `_hf_access`, `_version`, `_configure`) |
| Host services lifecycle | `services/` (`_ports`, `_fastapi`, `_docker_control`, `_frontend`, `_health`) |
| Inference-server artifact | `inference_server/` (`_catalog`, `_config`, `_env`, `_git`, `_metadata`, `_privileges`, `_orchestrator`) |
| Stop / purge teardown | `cleanup/` (`_runtime`, `_orchestrate`, `_resource_ops`) |
| Docker build/failure diag | `docker_diag/` (`_build_progress`, `_diagnostics`) |
| Standalone modules | `bootstrap.py`, `shell.py`, `startup_checks.py`, `docker.py`, `constants.py`, `logging.py`, `monitor.py`/`monitor_app.py` (`--status` TUI), `bug_report.py` (`--report-bug`), `shortcut.py` (`--install-shortcut`), `spdx.py`, `settings.py`, `venv_utils.py` |

**The re-export rule.** A package's `__init__.py` imports and re-exports the names
its submodules define, so `from tt_setup.console import step` and
`import tt_setup.console as C` keep working. When you add/move a submodule, wire
its public names through the `__init__`.

**Linter blind spot — read this before moving code between submodules.** Most
submodules do `from tt_setup.constants import *`. That makes ruff downgrade
undefined-name detection (`F821`) to a silent `F403`, so a name you *use* but
forgot to *import* in a submodule will NOT be flagged and will crash at runtime.
When you move a function into a submodule, add every import it needs locally
(names are module-scoped now, not inherited from the old monolith). `tests/
test_no_undefined_names.py` is the backstop; run it.

## Adding / changing a CLI flag

1. **Declare it** in `tt_setup/cli/_args.py` as a `typer.Option`, with a
   `rich_help_panel=` so it lands in the right `--help` group: *Setup &
   Configuration · Model Deployment · Lifecycle · Reset (--purge-all) · Advanced ·
   Developer Tools · Release (maintainers) · Troubleshooting & Info*. Deprecated
   flags use `hidden=True`
   and warn + normalize onto the current flag.
2. **Thread it** into the `args = SimpleNamespace(...)` passed to `_run(args)`.
3. **Dispatch it.** *Utility/lifecycle* flags (`--stop`, `--status`, `--logs`,
   `--info`, `--report-bug`, `--install-shortcut`, `--check-headers`) run in the
   **early-dispatch block at the top of `_run()`** — do the work, then `return` /
   `sys.exit()` **before** the 5-phase startup. Only flags that modify a normal
   startup fall through to the phases.
4. **Name it** for the user: lowercase, action-oriented, and match the wording of
   its output ("Stopping/Stopped" for `--stop`, not "Cleaning up").
5. Add a `tests/test_cli.py` case (see Testing) and document it in `CLAUDE.md`
   (Common commands) + `dev-docs/run-py-guide.md` (options table).

## Terminal output — the short version

Full rules: `dev-docs/launcher-terminal-design.md`. The essentials:

- **Everything goes through `tt_setup/console/`** — never raw `print()` + ANSI.
- **Calm, minimal by default; `-v` reveals everything.** Gate routine "done" lines
  on `if show_detail():`. The pinned phase stepper + one collapsing line per
  `step()` is the normal signal; endpoint URLs live in the ready panel.
- **Always show failures, prompts, and actionable warnings** — never fold those.
- **Never wrap an interactive prompt in a capturing `step()` or an active phase
  spinner** — suspend around prompts/sudo/anything with its own `Live`.
- **Degrade cleanly on non-TTY** (piped) — no escape-code garbage.
- **`bootstrap.py` runs before Rich exists → stdlib only, never import
  `tt_setup.console`.** Mimic the calm style by hand (it has a stdlib spinner).

**Reusable renderers.** When a piece of output should be re-viewable (e.g. the
ready panel via `--info`), extract a pure renderer that probes live state
(`show_ready_panel` in `cli/_run.py`) and call it from both places — don't
duplicate the assembly.

## CLI design principles — "what we like"

These emerged across the launcher work; apply them to new launcher behavior.

- **Fail fast, with a fix *and* an escape hatch.** Stop early (at the Checks
  phase) when something is genuinely wrong, but the message must say how to fix it
  *and* how to opt out — e.g. "fix your TT tooling and re-run, **or** set
  `IS_QB2=false`". Never a bare traceback; use an `error` `notice_panel`.
- **Lenient defaults; strict behavior is opt-in.** Never block a dev laptop or
  cloud/no-hardware box out of the box. Strict checks are opt-in (`IS_QB2`) or
  gated on real signals (tt-smi installed / `/dev/tenstorrent` present).
- **Assume-and-verify, not assume-and-trust.** A config claim (e.g. "this is a
  QB2") is checked against reality (tt-smi); a mismatch is surfaced, not hidden.
- **Plain language in user-facing text** — say "couldn't read the QB2's chips,"
  not "tt-smi returned nonzero." Explain internal tool/var names in passing.
- **Capture subprocess noise; surface it only on failure.** A child process must
  not scroll under a live spinner. Capture stdout/stderr (e.g. compose runs with
  `--ansi never` + captured output; `run_docker_command(interactive=False)` for
  captured non-interactive sudo) and reveal the buffer only when the step fails —
  the way `console.step()` does.
- **Reuse existing helpers** (`build_docker_compose_command`, console primitives)
  instead of hand-rolling equivalents.
- **Make state re-viewable and hints discoverable** — the ready panel footer
  advertises `--stop` / `--logs` / `--info`.

## Hardware & QB2

- **Detect:** `detect_tt_hardware()` (`docker.py`, checks `/dev/tenstorrent`);
  `check_tt_smi()` (`shell.py`, runs `tt-smi -s`, returns
  `(status, detail, board_type)`). Classification lives in `shell.py`:
  `_classify_boards()` mirrors `board_control/services.py:get_board_type`
  (substring match + device count → `P300x2`/`T3K`/…); `describe_board()` maps to
  a friendly name; `resolve_hardware_label()` builds the ready-panel label +
  optional QB2 warning (pure/testable).
- **QB2 == `P300x2`** (Blackhole QuietBox). `IS_QB2` is an **opt-in** flag,
  **default false** — a dev laptop/cloud is never held to the strict check. The
  `tt_qb2_launch` release branch ships `IS_QB2=true`. It is **independent of
  `TT_INFERENCE_ARTIFACT_BRANCH`**, which only selects the inference-server build
  (that decoupling is deliberate — don't re-derive QB2 from the artifact branch).
- **Behavior when `IS_QB2=true`:** confirm via tt-smi → label `QuietBox (QB2)`;
  a *different* board → non-fatal warning; can't read the chips *while real TT
  tooling is present* → **hard-stop** at Checks; no TT tooling at all → skip
  (escape hatch). With `IS_QB2` false (default) the whole strict path is skipped.

## Testing & verification

- **Tests** live in `tests/` (stdlib `unittest`), one `test_<area>.py` per module,
  each with the pre-refactor shim `try: from tt_setup import X ... except
  ImportError: import run as X`. Run: `.tt_studio_run_venv/bin/python -m pytest
  tests/ -q` (keep green).
- **Extract pure helpers** for anything with branching logic (e.g.
  `resolve_hardware_label`, `_classify_boards`) so it's unit-testable without
  hardware, a TTY, or Docker. Test the matrix of inputs directly.
- **Verify terminal output under a real PTY** (`pty.spawn([...])`) to confirm
  spinner animation + `\r\033[2K` self-heal + collapse to `✓`, and pipe non-TTY
  output through `| cat` to confirm no stray escape codes. The live spinner/rule
  sweep and real prompts only render on a true terminal — check those on hardware.
- **`tests/test_no_undefined_names.py`** guards the `import *` blind spot; keep it
  passing when you move code between submodules.
- Try `COLUMNS=80` and `COLUMNS=120` for panel/rule widths, and `-v` to confirm
  folded detail returns.

## Conventions

- **SPDX headers** are mandatory on every new `.py` (not on `.md`):
  `# SPDX-License-Identifier: Apache-2.0` / `# SPDX-FileCopyrightText: © 2026
  Tenstorrent AI ULC`. Run `python run.py --check-headers`.
- **Docker errors link, they don't fix.** Point to official docs; never advertise
  `--fix-docker` or Linux-only `sudo service docker start`. Compose **v2** only.
- **Git / PRs:** follow the `feature-branch-pr` skill (branch off `dev`, minimal
  diff, verify, no AI attribution in commits/PRs).
- Keep `CLAUDE.md` (Common commands) and `dev-docs/run-py-guide.md` in sync when
  you add a flag; the file map in `dev-docs/launcher-terminal-design.md` predates
  the package split and lists the old monolith paths — treat this skill's table as
  the current layout.
