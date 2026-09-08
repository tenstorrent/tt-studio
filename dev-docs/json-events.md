# Machine-readable event stream (`--json-events` / `--status --json`)

The launcher can report progress as **NDJSON** (one JSON object per line on
stdout) so a wrapping program — e.g. a desktop launcher — can render bring-up
natively instead of scraping the Rich/ANSI terminal output.

Two entry points use it:

```bash
python run.py --json-events      # full bring-up, streaming events as it runs
python run.py --status --json    # one-shot state dump (no TUI), then exit
```

In both modes **stdout carries nothing but events** — the human-facing output
(panels, spinners, prompts' text) moves to stderr — and the stream is safe to
read from a PTY or a pipe (no ANSI escapes either way). The implementation
lives in `tt_setup/console/_events.py`; the phase taps in
`tt_setup/console/_stepper.py`.

## Envelope

Every line is one JSON object with exactly these keys, in this order:

| Key | Type | Meaning |
| --- | --- | --- |
| `v` | int | Schema version. Currently `1`; bumped only on breaking changes. |
| `ts` | float | Unix timestamp of the event. |
| `event` | string | Event type (below). |
| `phase` | string \| null | The setup phase the event belongs to (`Checks`, `Configure`, `Services`, `Build`/`Pull`, `Launch`), or `null` outside any phase. |
| `detail` | object | Type-specific payload (may be empty). |

Consumers should ignore lines that don't parse as JSON (on the very first run
of a fresh checkout, the pre-Rich bootstrap prints a few plain setup lines
before the CLI — and the venv — exist) and tolerate unknown event types and
extra `detail` keys: additions are non-breaking within `v: 1`.

## Event types

| `event` | When | `detail` |
| --- | --- | --- |
| `phase_begin` | A setup phase starts. | `index` (1-based), `total` |
| `phase_end` | A phase resolves. | `index`, `status` (`"ok"` \| `"failed"`), `duration_s` (omitted on abort paths) |
| `progress` | Activity inside a phase: the current sub-step (`activity`), a Docker build/pull milestone (`kind`, `service`, `label`), or a phase retitle (`kind: "phase_renamed"`, e.g. Pull → Build fallback). | varies as above |
| `note` | Informational note (e.g. why the image pull was skipped). | `text` |
| `warn` | Actionable warning — the same items the terminal recaps in "Needs attention". | `text` |
| `error` | Something failed. **Always** carries a fix. | `message`, `remediation`, plus context (`service`, `container`, `log`, `exit_code`) when known |
| `prompt_blocked` | The run needed interactive input; `--json-events` implies non-interactive, so it exits (code 2) instead of hanging. | `prompt`, `remediation` |
| `ready` | Bring-up finished; the stack is usable. | `urls` (`app`, and unless skipped `fastapi`, `docker_control`), `hardware` (detected label) |
| `status` | `--status --json` only: the one-shot state dump. | `services` (list of `{name, port, url, healthy}`), `head` (short git SHA), `hardware` |

## Example: a successful bring-up

```json
{"v": 1, "ts": 1787179000.1, "event": "phase_begin", "phase": "Checks", "detail": {"index": 1, "total": 5}}
{"v": 1, "ts": 1787179000.2, "event": "progress", "phase": "Checks", "detail": {"activity": "tt-smi"}}
{"v": 1, "ts": 1787179003.7, "event": "phase_end", "phase": "Checks", "detail": {"index": 1, "status": "ok", "duration_s": 3.5}}
{"v": 1, "ts": 1787179004.0, "event": "phase_begin", "phase": "Configure", "detail": {"index": 2, "total": 5}}
{"v": 1, "ts": 1787179060.0, "event": "progress", "phase": "Build", "detail": {"kind": "pulled", "service": "frontend"}}
{"v": 1, "ts": 1787179095.4, "event": "ready", "phase": null, "detail": {"urls": {"app": "http://localhost:3000", "fastapi": "http://localhost:8001", "docker_control": "http://localhost:8002"}, "hardware": "QuietBox (QB2) · 4 device(s)"}}
```

And a failure:

```json
{"v": 1, "ts": 1787179050.0, "event": "error", "phase": "Launch", "detail": {"message": "Inference server didn't start — port 8001 is still taken", "remediation": "lsof -i :8001; python run.py --stop, then re-run", "service": "Inference server", "log": "fastapi.log"}}
{"v": 1, "ts": 1787179050.1, "event": "phase_end", "phase": "Launch", "detail": {"index": 5, "status": "failed"}}
```

## Semantics a consumer can rely on

- **Stable envelope.** The five envelope keys, their order, and `v` are the
  compatibility contract; the stream is valid NDJSON end to end.
- **Phase roadmap.** A normal run emits `phase_begin`/`phase_end` pairs for the
  5 phases in order. Phase 4 may begin as `Pull` and be renamed to `Build`
  (signalled via `progress` / `kind: "phase_renamed"`).
- **Exactly one terminal outcome.** Success ends with `ready`; failure ends
  with an `error` (with `remediation`) and/or a `phase_end` with
  `status: "failed"`, and a non-zero exit code.
- **Non-interactive.** With `--json-events` the launcher never waits on stdin:
  any would-be prompt becomes `prompt_blocked` + exit code 2. Pre-answer via
  `.env` / flags (e.g. `HF_TOKEN`, `--accept-terms`, `-y`).
- **stderr is human.** Anything on stderr is display output; don't parse it.

Tests: `tests/test_events.py` (emitter + stepper taps) and
`tests/test_json_stream.py` (end-to-end stream purity, incl. a PTY check).
