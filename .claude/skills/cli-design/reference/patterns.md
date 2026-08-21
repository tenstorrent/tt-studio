# Patterns — worked examples

Four patterns that carry most of the weight, each shown as the ugly output it
replaces, the code, and the test that keeps it honest. Lifted from real TT-Studio
launcher work; nothing here depends on that repo.

---

## 1. Expected-failure note (registry pull → local fallback)

**Before** — three raw daemon errors, a wrong explanation, and no clear outcome:

```
  Image ghcr.io/acme/app/backend:sha-205aedf73de2 failed to resolve reference
  "ghcr.io/acme/app/backend:sha-205aedf73de2": …: not found
  Error response from daemon: failed to resolve reference "…": not found
Registry unreachable — using locally cached images
```

The registry answered fine; the tag simply doesn't exist for an unmerged branch.

**After** — one line, correct cause, stated consequence:

```
  ✓ chroma pulled
  ○ Prebuilt images for sha-205aedf73de2 aren't published — using local images
```

**Code** — two pure functions plus one call site. Classification is separate from
wording so each is testable, and network trouble is checked *before* a missing
manifest (an offline machine reports both, and "you're offline" is more useful):

```python
def classify_pull_failure(output):
    """→ 'unreachable' | 'auth' | 'unpublished' | 'unknown'."""
    text = (output or "").lower()
    if not text.strip():
        return "unknown"
    if any(k in text for k in ("dial tcp", "no such host", "i/o timeout",
                              "tls handshake", "connection refused")):
        return "unreachable"
    if any(k in text for k in ("unauthorized", "authentication required", "denied")):
        return "auth"
    if any(k in text for k in ("not found", "manifest unknown", "name unknown")):
        return "unpublished"
    return "unknown"


def describe_pull_fallback(kind, tag, cached):
    """→ (message, hint). A note, not an error: pulling is an optimization."""
    next_step = "using local images" if cached else "building locally"
    reason = {
        "unpublished": f"Prebuilt images for {tag} aren't published",
        "auth": "the registry needs a login for these images",
        "unreachable": "couldn't reach the registry",
    }.get(kind, f"couldn't pull the prebuilt images ({tag})")
    hint = "run: docker login <registry>" if kind == "auth" else None
    return f"{reason} — {next_step}", hint
```

```python
rc, output = run_with_activity(pull_cmd, label="Pulling prebuilt images", parse=pull.feed)
if rc != 0:
    kind = classify_pull_failure(output)
    cached = images_present_locally(refs)
    message, hint = describe_pull_fallback(kind, tag, cached)
    note(message)
    if hint:
        note(hint, marker="")        # continuation line, same indent
```

**Test** with real captured output as the fixture — the tool's actual wording is the
input your classifier has to survive:

```python
def test_offline_wins_over_missing_manifest(self):
    out = "failed to resolve reference: dial tcp: lookup ghcr.io: no such host\nmanifest unknown"
    self.assertEqual(classify_pull_failure(out), "unreachable")
```

---

## 2. Diagnosis card (a service that didn't come up)

**Before** — the failure lands on the spinner row, then the buffer dumps out of order:

```
⠧ Docker Control service…Failed to start Docker Control Service. Check logs at /…/dc.log
✗ Docker Control service  11.0s
🔧 Starting Docker Control Service (dev/reload)...
🛑 Found process with PID 3267836 using port 8002. Attempting to stop it...
✅ Process 3267836 terminated by force.
```

Two bugs in one screen: a **child process wrote to the inherited tty** (Python-level
redirects don't reach a subprocess — fix with `stdout=DEVNULL, stderr=STDOUT`, and
let it log to a file), and the failure **dumped** instead of explaining.

**After**:

```
✗ Docker Control service  11.0s
╭─ Docker Control service didn't start — port 8002 is still taken ──────────────╮
│  Another process was holding port 8002 when the service tried to bind to it.  │
│  Log · ERROR:    [Errno 98] Address already in use                            │
│                                                                               │
│  Startup continues — the backend falls back to the Docker SDK.                │
│                                                                               │
│  Try:                                                                         │
│    lsof -i :8002                                                              │
│    myapp --stop, then re-run                                                  │
╰───────────────────────────────────────────────────────────────────────────────╯
```

```python
def diagnose_service_log(log_text, port=None, log_file=None):
    """→ {cause, detail, evidence, actions}. Pure: text in, dict out."""
    low = (log_text or "").lower()
    evidence = next((ln.strip() for ln in reversed((log_text or "").splitlines())
                     if any(k in ln.lower() for k in ("error", "exception", "errno"))), "")
    if "address already in use" in low or "errno 98" in low:
        return {"cause": f"port {port} is still taken",
                "detail": f"Another process was holding port {port} when the service tried to bind to it.",
                "evidence": evidence,
                "actions": [f"lsof -i :{port}", "myapp --stop, then re-run"]}
    if "modulenotfounderror" in low or "importerror" in low:
        return {"cause": "a Python dependency is missing",
                "detail": "The service's virtual environment is incomplete or out of date.",
                "evidence": evidence,
                "actions": ["delete the service's .venv, then re-run"]}
    return {"cause": "it didn't answer its health check",
            "detail": "The service started but never became healthy.",
            "evidence": evidence,
            "actions": [f"tail -50 {log_file}"]}
```

Render it **after** the step collapses (never inside the capturing block, where it
would be swallowed and reprinted uncoloured):

```python
with step("Docker Control service") as s:
    ok = start_service()
    if not ok:
        s.fail()
if not ok:
    console.print(failure_card("Docker Control service",
                               diagnose_service_log(read_log_tail(LOG), port=8002, log_file=LOG),
                               log_file=LOG,
                               consequence="Startup continues — the backend falls back to the Docker SDK."))
```

Paths read better relative to the repo root; keep the evidence to one line (~120
chars) so the card can't become a log viewer.

---

## 3. Progress from a stream you don't control

Piped `docker compose pull` gives per-layer *downloaded* bytes and no layer totals,
so a percentage would be invented. Count what you know exactly — images — and show
bytes as a live counter:

```
⠹ Pulling prebuilt images  ▕█████████░░░░░▏  2/3 images · 7.3 MB
```

```python
class PullProgress:
    """Pure aggregator: feed(line) → event | None, activity() → str."""
    _RESOLVED = ("Pulled", "Exists", "Skipped", "Error")

    def __init__(self, label="Pulling prebuilt images"):
        self.label, self.images, self.failures, self._layers = label, {}, [], {}

    def feed(self, line):
        parsed = parse_pull_line(line)          # regex → ('image'|'layer', …)
        if parsed is None:
            return None
        if parsed[0] == "layer":
            _, layer_id, _state, size = parsed
            if size:
                # Each line restates that layer's running total, and completion
                # lines re-report 0B — so keep the max, never overwrite.
                self._layers[layer_id] = max(size, self._layers.get(layer_id, 0))
            return None
        _, ref, state, detail = parsed
        if state == "Error":
            self.images[ref] = "error"
            self.failures.append((ref, detail))
        elif state in self._RESOLVED:
            self.images[ref] = "done"
            if state == "Pulled":
                return ("milestone", f"{short_image_name(ref)} pulled")
        else:
            self.images.setdefault(ref, "pulling")
        return None

    def activity(self):
        done = sum(1 for s in self.images.values() if s != "pulling")
        total = len(self.images)
        if not total:
            return f"{self.label}…"
        text = f"{self.label}  {progress_bar(done, total)}  {done}/{total} images"
        downloaded = sum(self._layers.values())
        return text + (f" · {fmt_bytes(downloaded)}" if downloaded else "")
```

Notes that matter:

- **Errored items count as resolved** so the bar can still complete — a failed pull
  falls back, it isn't a hang.
- **Force plain tool output** (`BUILDKIT_PROGRESS=plain`) so the stream is parseable
  at all.
- **Capture the real output once** and paste it into the test file as a fixture. Then
  the parser is tested with no Docker, no network, no TTY.

---

## 4. Don't create the failure you then have to explain

The port-conflict card above was covering for a race the launcher caused itself:
free the port, immediately bind it. Killing the holder doesn't hand the port back
instantly, and `uvicorn --reload` passes its socket to a child that survives the
first kill.

```python
def wait_for_port_release(port, timeout=6.0, interval=0.25):
    deadline = time.monotonic() + timeout
    while True:
        if check_port_available(port):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(interval)


def kill_process_on_port(port, attempts=3, **kw):
    """Return only once the port is genuinely free."""
    for attempt in range(attempts):
        result = _kill_port_holder(port, **kw)
        if result is not True:          # e.g. "docker" (never kill the engine)
            return result
        if wait_for_port_release(port):
            return True
    return check_port_available(port)
```

The general rule: **when output looks bad, check whether the underlying behaviour is
bad.** Prettier rendering of a self-inflicted error is the wrong fix; the best
version of an error message is the run that never needs it.

---

## Verification recipes

```bash
# pure logic: parsers, classifiers, wording
python -m pytest tests/ -q

# non-TTY must emit ZERO escape codes
mycli --dev | cat -v | grep -c '\^\['      # expect 0

# widths and folding
COLUMNS=80 mycli --dev; COLUMNS=120 mycli --dev; mycli --dev -v
```

Animated output needs a real PTY — assert on the captured bytes:

```python
import os, pty, sys
out = open("render.raw", "wb")
pty.spawn([sys.executable, "demo.py"], lambda fd: (lambda d: (out.write(d), d)[1])(os.read(fd, 1024)))
```

Check for: the spinner advancing through frames, `\r\033[2K` erasing its row before
the result line, the stepper's ✓ filling in left to right, and — on every exit path,
including Ctrl-C — the scroll region reset (`\033[r`) if you use one.

And reproduce failures for real: point at a nonexistent image, occupy the port,
unplug the network. Mocked errors teach your parser the wording you imagined rather
than the wording the tool actually prints.
