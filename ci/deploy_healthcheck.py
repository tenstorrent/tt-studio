# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Deploy healthcheck: deploy one or more models through the TT-Studio backend API
and assert each reaches HEALTHY status. Used by CI (the Deploy Healthcheck
workflow) and by hand for manual / overnight testing. Dependency-free (stdlib
urllib only), so it runs on a bare runner without the backend venv.

Before the first deploy it runs a whole-board reset (stop models + tt-smi -r),
and it mirrors the frontend's deploy request (e.g. force_full_board for
Llama-3.1-8B on P300x2) so a deploy behaves like a real UI deploy. When run
inside GitHub Actions it also writes a step summary + `::error::` annotations.

Phases per model:
  0. preflight  — resolve the target model_id from the catalog
  1. deploy     — POST /docker/deploy/ -> job_id (frontend-style body)
  2. progress   — poll /docker/deploy/progress/<job_id>/ until "completed"
  3. resolve    — find the deploy_id in /models/deployed/
  4. health     — poll /models/health/?deploy_id=... until "Healthy" (HTTP 200)
  5. cleanup    — stop the container to free the board (default; --no-cleanup keeps it)

Exit code 0 iff every requested model reached healthy; any failure/timeout exits
non-zero (so the CI step fails). A .log and a .json report are written under
./ci-runs/ for artifact upload.

Examples:
  # Single model (default Qwen3-32B), up to 2h to go healthy:
  python3 ci/deploy_healthcheck.py --models "Qwen3-32B" --timeout 2h

  # Leave the model up after the check (local debugging):
  python3 ci/deploy_healthcheck.py --model-name Qwen3-32B --no-cleanup

  # Fire-and-forget over SSH: prints where the log/report live, then backgrounds.
  python3 ci/deploy_healthcheck.py --model-name Llama-3.1-8B-Instruct --detach

  # Overnight batch (cleanup between each frees the board):
  python3 ci/deploy_healthcheck.py --models Qwen3-32B FLUX.1-dev --detach

  # Dry run — verify connectivity + resolve ids, deploy nothing.
  python3 ci/deploy_healthcheck.py --dry-run
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# --- endpoint paths -------------------------------------------------------
# The backend mounts these directly (http://localhost:8000/docker/... etc).
# The frontend (nginx/vite) proxies them under prefixes: docker -> docker-api,
# models -> models-api. --proxy switches to those prefixes.
PATHS_DIRECT = {
    "catalog": "docker/catalog/",
    "deploy": "docker/deploy/",
    "progress": "docker/deploy/progress/{job_id}/",
    "deployed": "models/deployed/",
    "health": "models/health/",
    "logs": "docker/deploy/logs/{job_id}/",
    "stop": "docker/stop/stream/{container_id}/",
    "chip_status": "docker/chip-status/",
    "reset_all": "docker/reset_all/",
    "reset_all_status": "docker/reset_all/status/",
}
PATHS_PROXY = {
    "catalog": "docker-api/catalog/",
    "deploy": "docker-api/deploy/",
    "progress": "docker-api/deploy/progress/{job_id}/",
    "deployed": "models-api/deployed/",
    "health": "models-api/health/",
    "logs": "docker-api/deploy/logs/{job_id}/",
    "stop": "docker-api/stop/stream/{container_id}/",
    "chip_status": "docker-api/chip-status/",
    "reset_all": "docker-api/reset_all/",
    "reset_all_status": "docker-api/reset_all/status/",
}

# Progress statuses that mean "stop polling".
PROGRESS_DONE = "completed"
PROGRESS_FAIL = {"error", "failed", "timeout", "cancelled"}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def parse_duration(value):
    """Parse a duration like '4h', '90m', '3600s', or a bare number of seconds."""
    s = str(value).strip().lower()
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([hms]?)", s)
    if not m:
        raise argparse.ArgumentTypeError(f"invalid duration {value!r} (use e.g. 4h, 90m, 3600s)")
    n, unit = float(m.group(1)), m.group(2)
    return int(n * {"h": 3600, "m": 60, "s": 1, "": 1}[unit])


class _Tee:
    """Write-through stream that mirrors output to the terminal and a log file."""
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)
            s.flush()

    def flush(self):
        for s in self.streams:
            s.flush()


def _daemonize(logpath):
    """Double-fork into the background and redirect stdio to `logpath`. The
    original (terminal) process exits here; only the detached child returns."""
    sys.stdout.flush()           # os._exit() below skips buffer flush — do it now
    sys.stderr.flush()
    if os.fork() > 0:
        os._exit(0)              # original terminal process leaves
    os.setsid()                  # new session — no controlling terminal
    if os.fork() > 0:
        os._exit(0)              # intermediate parent leaves
    # Grandchild: reopen stdio onto the log file so all output is captured.
    logfd = os.open(logpath, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(logfd, 1)
    os.dup2(logfd, 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)


class SmokeTestError(Exception):
    """Fatal, script-terminating failure."""


# --- tiny HTTP layer (stdlib only) ----------------------------------------
def _request(method, url, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload
    except urllib.error.URLError as e:
        raise SmokeTestError(f"cannot reach {url}: {e.reason}")


class Client:
    def __init__(self, base_url, proxy):
        self.base = base_url.rstrip("/")
        self.paths = PATHS_PROXY if proxy else PATHS_DIRECT

    def _url(self, key, **fmt):
        path = self.paths[key].format(**fmt)
        return f"{self.base}/{path}"

    def get(self, key, timeout=30, query=None, **fmt):
        url = self._url(key, **fmt)
        if query:
            url += "?" + urllib.parse.urlencode(query)
        return _request("GET", url, timeout=timeout)

    def post(self, key, body, timeout=60, **fmt):
        return _request("POST", self._url(key, **fmt), body=body, timeout=timeout)


# --- failure diagnostics --------------------------------------------------
def fetch_deploy_logs(client, job_id, tail=40):
    """Best-effort: pull the deployment log tail so a failure prints *why*.
    Returns a formatted string or a short note if logs are unavailable."""
    try:
        st, data = client.get("logs", timeout=15, job_id=job_id)
    except SmokeTestError as e:
        return f"(could not fetch logs: {e})"
    if st != 200 or not isinstance(data, dict):
        return f"(logs unavailable, HTTP {st})"
    logs = data.get("logs") or []
    if not logs:
        return f"(no logs returned; {data.get('error') or 'empty'})"
    lines = []
    for entry in logs[-tail:]:
        # FastAPI log entries are dicts ({message,timestamp,...}) or plain strings.
        lines.append(entry.get("message", str(entry)) if isinstance(entry, dict) else str(entry))
    body = "\n    ".join(lines)
    return f"last {min(tail, len(logs))} of {data.get('total_messages', len(logs))} log lines:\n    {body}"


def container_alive(client, deploy_id):
    """True if deploy_id is still a running managed deployment. A crashed/dead
    vLLM container drops out of /models/deployed/, so absence == it died."""
    st, data = client.get("deployed", timeout=15)
    if st != 200 or not isinstance(data, dict):
        return None  # unknown — treat as inconclusive, don't false-fail
    entry = data.get(deploy_id)
    if entry is None:
        return False
    # If a status field is present, "running" is the only healthy value.
    stat = (entry.get("status") or entry.get("state") or "").lower()
    if stat and stat not in ("running", "created", "restarting"):
        return False
    return True


# --- phases ---------------------------------------------------------------
def resolve_model_id(client, model_name, explicit_id):
    """Return the deploy model_id. Model ids are generated at runtime, so we
    resolve by human-readable model_name against the live catalog rather than
    hardcoding an id that could drift."""
    st, data = client.get("catalog", timeout=30)
    if st != 200 or data.get("status") != "success":
        raise SmokeTestError(f"catalog fetch failed (HTTP {st}): {data}")
    models = data.get("models", {})
    if not models:
        raise SmokeTestError("catalog returned no models")

    if explicit_id:
        if explicit_id not in models:
            raise SmokeTestError(
                f"--model-id {explicit_id!r} not in catalog. Available: {list(models)}"
            )
        log(f"using explicit model_id: {explicit_id}")
        return explicit_id

    # Exact model_name match first, then a loose contains-match as a fallback.
    exact = [mid for mid, m in models.items() if m.get("model_name") == model_name]
    if exact:
        log(f"resolved model_id: {exact[0]} (model_name == {model_name!r})")
        return exact[0]

    needle = model_name.lower()
    loose = [mid for mid, m in models.items() if needle in (m.get("model_name") or "").lower()]
    if len(loose) == 1:
        log(f"resolved model_id: {loose[0]} (loose match on {model_name!r})")
        return loose[0]
    if len(loose) > 1:
        names = {mid: models[mid].get("model_name") for mid in loose}
        raise SmokeTestError(f"{model_name!r} matched multiple models: {names}. Pass --model-id.")

    available = sorted(m.get("model_name") for m in models.values())
    raise SmokeTestError(f"no catalog model matches {model_name!r}. Available: {available}")


def _norm(name):
    return re.sub(r"[\s_]", "", (name or "").lower())


def _is_llama31_8b(name):
    t = _norm(name)
    return "llama-3.1-8b" in t or "llama3.18b" in t


def fe_deploy_overrides(client, model_name):
    """Build the same deploy body the frontend sends, so CI is a faithful
    representation of a real UI deploy (not a bare API call).

    The one case where the backend's bare auto-allocation diverges from the UI:
    a flexible model on a P300x2 board. A single P300 chip is a tt-metal
    "CUSTOM cluster type" that fails to init, so the UI deploys full-board via
    `force_full_board`. The backend only honors that flag for CHAT + P300x2 +
    Llama-3.1-8B (see should_force_full_board_llama / getModelPlacement); it's
    ignored elsewhere, and other models already auto-allocate correctly.
    """
    overrides = {"weights_id": "", "use_image_override": True}
    try:
        st, cs = client.get("chip_status", timeout=15)
    except SmokeTestError:
        st, cs = 0, {}
    board = cs.get("board_type") if st == 200 and isinstance(cs, dict) else None
    if board == "P300x2" and _is_llama31_8b(model_name):
        overrides["force_full_board"] = True
        log(f"placement: {model_name} on {board} → force_full_board (full mesh), mirroring the UI")
    return overrides


def reset_all_board(client, timeout=600, interval=5):
    """Whole-board reset before the first deploy: stop every deployed model, then
    reset all devices (tt-smi -r) — mirrors the UI's 'Reset all'. Ensures a clean
    mesh so a prior crashed run can't wedge this deploy (on p300x2 a dirty mesh
    makes ttnn.get_num_devices() raise IndexError). Best-effort: warns and
    continues if it can't confirm completion. Deploys are blocked (409) while a
    reset is in flight, so this waits for `done` before returning.
    """
    log("reset: whole-board reset (stop models + tt-smi -r)…")
    try:
        st, data = client.post("reset_all", {}, timeout=60)
    except SmokeTestError as e:
        log(f"reset: WARNING could not start reset ({e}) — continuing")
        return
    if st not in (200, 202):
        log(f"reset: WARNING start returned HTTP {st}: {data} — continuing")
        return
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            st, state = client.get("reset_all_status", timeout=15)
        except SmokeTestError:
            time.sleep(interval)
            continue
        if st == 200 and isinstance(state, dict):
            step = state.get("step")
            if step != last:
                log(f"reset: step={step}")
                last = step
            if state.get("done"):
                if state.get("ok"):
                    log("reset: board clean ✓")
                else:
                    log(f"reset: WARNING finished not-ok: {state.get('error')}")
                return
        time.sleep(interval)
    log(f"reset: WARNING not confirmed done within {timeout}s — continuing")


def deploy(client, model_id, extra=None):
    body = {"model_id": model_id}
    if extra:
        body.update(extra)
    st, data = client.post("deploy", body, timeout=120)
    if st not in (200, 201) or data.get("status") != "success":
        raise SmokeTestError(f"deploy failed (HTTP {st}): {data}")
    job_id = data.get("job_id")
    if not job_id:
        raise SmokeTestError(f"deploy returned no job_id: {data}")
    log(f"deploy accepted: job_id={job_id} device={data.get('allocated_device_id')}")
    return job_id


def poll_progress(client, job_id, timeout, interval):
    """Poll until deployment reaches 'completed' or a failure/timeout."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        st, data = client.get("progress", timeout=15, job_id=job_id)
        if st != 200:
            log(f"progress HTTP {st}: {data}")
            time.sleep(interval)
            continue
        status_ = (data.get("status") or "").lower()
        line = f"progress: status={status_} pct={data.get('progress')} — {data.get('message', '')}"
        if line != last:  # only print on change to keep logs readable
            log(line)
            last = line
        if status_ == PROGRESS_DONE:
            return
        if status_ in PROGRESS_FAIL:
            reason = data.get("message") or status_
            raise SmokeTestError(
                f"deployment {status_}: {reason}\n  {fetch_deploy_logs(client, job_id)}"
            )
        time.sleep(interval)
    raise SmokeTestError(
        f"deployment did not complete within {timeout}s (backend caps deploys at 5h)\n"
        f"  {fetch_deploy_logs(client, job_id)}"
    )


def resolve_deploy_id(client, model_id, timeout, interval):
    """After 'completed', the running model appears in /models/deployed/ keyed
    by its deploy_id. Find the one for our model_id."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        st, data = client.get("deployed", timeout=15)
        if st == 200 and isinstance(data, dict):
            for deploy_id, entry in data.items():
                impl = entry.get("model_impl") or {}
                if impl.get("model_id") == model_id:
                    log(f"found deploy_id={deploy_id} for {impl.get('model_name')}")
                    return deploy_id
        time.sleep(interval)
    raise SmokeTestError(f"model {model_id} never appeared in /deployed/ within {timeout}s")


def poll_health(client, deploy_id, job_id, timeout, interval, unavailable_grace=3):
    """Poll /models/health/ until Healthy (200), or fail fast if the container
    dies. 200=Healthy, 202=Starting (keep waiting), 503=Unavailable.

    Crash detection:
      * container drops out of /models/deployed/  -> it died, fail immediately
      * >= `unavailable_grace` consecutive 503s    -> definitively unhealthy
        (the backend already remaps warmup 503s to 202, so a real 503 here is
        a genuine failure, not startup noise)
    """
    deadline = time.time() + timeout
    last = None
    consecutive_503 = 0
    while time.time() < deadline:
        # Did the vLLM container crash out from under us?
        alive = container_alive(client, deploy_id)
        if alive is False:
            raise SmokeTestError(
                f"container for {deploy_id} died during startup "
                f"(vanished from /deployed/)\n  {fetch_deploy_logs(client, job_id)}"
            )

        st, data = client.get("health", timeout=20, query={"deploy_id": deploy_id})
        line = f"health: HTTP {st} — {data.get('message', data)}"
        if line != last:
            log(line)
            last = line

        if st == 200:
            return True
        if st == 503:
            consecutive_503 += 1
            if consecutive_503 >= unavailable_grace:
                raise SmokeTestError(
                    f"model {deploy_id} reported Unavailable {consecutive_503}x in a row: "
                    f"{data.get('details') or data.get('message')}\n"
                    f"  {fetch_deploy_logs(client, job_id)}"
                )
        else:
            consecutive_503 = 0  # 202 Starting or transient — reset the streak

        time.sleep(interval)
    raise SmokeTestError(
        f"model {deploy_id} did not become healthy within {timeout}s\n"
        f"  {fetch_deploy_logs(client, job_id)}"
    )


def cleanup(client, container_id):
    """Best-effort stop via the SSE stop stream; read until a terminal event."""
    log(f"cleanup: stopping {container_id}")
    url = client._url("stop", container_id=container_id)
    try:
        req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                try:
                    event = json.loads(line[len("data:"):].strip())
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "complete":
                    log(f"cleanup: {event.get('status')} — {event.get('message')}")
                    return
    except (urllib.error.URLError, OSError) as e:
        log(f"cleanup: WARNING failed to stop cleanly: {e}")


def write_report(path, report):
    """Persist the run outcome to a JSON file. Written in a finally block so the
    result survives even if you've lost your SSH session to the box."""
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        with open(path, "w") as f:
            json.dump(report, f, indent=2)
        log(f"report written: {path}")
    except OSError as e:
        log(f"WARNING could not write report to {path}: {e}")


def emit_github_outputs(combined):
    """When running inside GitHub Actions, emit `::error::` annotations for any
    failed model and append a Markdown result table to $GITHUB_STEP_SUMMARY.
    No-ops (annotations aside) when not under Actions."""
    ok_results = ("healthy", "dry_run_ok")
    for m in combined.get("models", []):
        if m.get("result") not in ok_results:
            reason = (m.get("reason") or m.get("result") or "failed").splitlines()[0]
            print(f"::error title=deploy healthcheck::{m.get('model_name')}: {reason}", flush=True)

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    models = combined.get("models", [])
    healthy = sum(1 for m in models if m.get("result") in ok_results)
    icon = {"healthy": "✅", "dry_run_ok": "✅"}
    lines = [
        f"## Deploy healthcheck — {combined.get('result', 'unknown')}",
        "",
        f"`{healthy}/{len(models)}` healthy · `{combined.get('base_url', '')}`",
        "",
        "| Result | Model | Duration | Note |",
        "| --- | --- | --- | --- |",
    ]
    for m in models:
        dur = m.get("duration_seconds")
        dur_s = f"{dur:.0f}s" if isinstance(dur, (int, float)) else ""
        note = (m.get("reason") or "").splitlines()[0].replace("|", r"\|") if m.get("reason") else ""
        lines.append(f"| {icon.get(m.get('result'), '❌')} {m.get('result')} | {m.get('model_name')} | {dur_s} | {note} |")
    try:
        with open(summary_path, "a") as f:
            f.write("\n".join(lines) + "\n")
    except OSError as e:
        log(f"WARNING could not write GITHUB_STEP_SUMMARY: {e}")


def run_model(client, model_name, model_id_override, do_cleanup,
              deploy_timeout, health_timeout, poll_interval):
    """Deploy one model and drive it to healthy. Returns a result dict; never
    raises SmokeTestError (it's caught and recorded) so a caller running a batch
    can continue to the next model."""
    started = time.time()
    report = {
        "result": "unknown",
        "model_name": model_name,
        "model_id": model_id_override,
        "deploy_id": None,
        "job_id": None,
        "reason": None,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "finished_at": None,
        "duration_seconds": None,
    }
    log(f"==== {model_name} ====")
    try:
        model_id = resolve_model_id(client, model_name, model_id_override)
        report["model_id"] = model_id

        job_id = deploy(client, model_id, fe_deploy_overrides(client, model_name))
        report["job_id"] = job_id

        deploy_id = None
        try:
            poll_progress(client, job_id, deploy_timeout, poll_interval)
            deploy_id = resolve_deploy_id(client, model_id, timeout=120, interval=poll_interval)
            report["deploy_id"] = deploy_id
            poll_health(client, deploy_id, job_id, health_timeout, poll_interval)
            log(f"SUCCESS: {model_name} reached HEALTHY status.")
            report["result"] = "healthy"
        finally:
            if do_cleanup:
                cleanup(client, deploy_id or job_id)
    except SmokeTestError as e:
        log(f"FAILURE: {model_name}: {e}")
        report["result"] = "failed"
        report["reason"] = str(e)
    finally:
        report["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        report["duration_seconds"] = round(time.time() - started, 1)
    return report


# --- orchestration --------------------------------------------------------
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default=os.environ.get("TTSTUDIO_BASE_URL", "http://localhost:8000"),
                   help="Backend base URL (default: http://localhost:8000, or $TTSTUDIO_BASE_URL)")
    p.add_argument("--proxy", action="store_true",
                   help="Use frontend proxy prefixes (docker-api/models-api) instead of hitting the backend directly")
    p.add_argument("--model-name", default=None,
                   help="Single model to deploy, matched against the catalog (default: Qwen3-32B). "
                        "Takes priority over --models if both are given.")
    p.add_argument("--models", nargs="+", metavar="MODEL",
                   help="Deploy several models one after another (space-separated). Cleanup is forced "
                        "between them so each frees the board for the next — ideal for overnight runs. "
                        "Ignored if --model-name is passed.")
    p.add_argument("--model-id", default=os.environ.get("TTSTUDIO_MODEL_ID"),
                   help="Exact catalog model_id; overrides --model-name (single-model mode only)")
    p.add_argument("--timeout", type=parse_duration, default=None,
                   help="Max time to wait, applied to BOTH the deploy and health phases. "
                        "Accepts 4h / 90m / 3600s / plain seconds. Simple knob for 'give it up to N'.")
    p.add_argument("--deploy-timeout", type=parse_duration,
                   default=os.environ.get("TTSTUDIO_DEPLOY_TIMEOUT", "3600"),
                   help="Advanced: seconds/duration to wait for deployment to complete (default: 1h). Overridden by --timeout.")
    p.add_argument("--health-timeout", type=parse_duration,
                   default=os.environ.get("TTSTUDIO_HEALTH_TIMEOUT", "1800"),
                   help="Advanced: seconds/duration to wait for the model to become healthy (default: 30m). Overridden by --timeout.")
    p.add_argument("--poll-interval", type=parse_duration, default=os.environ.get("TTSTUDIO_POLL_INTERVAL", "10"),
                   help="Seconds between polls (default: 10)")
    p.add_argument("--output-dir", default=os.environ.get("TTSTUDIO_OUTPUT_DIR", "ci-runs"),
                   help="Directory for the auto-named .log and .json report (default: ./ci-runs)")
    p.add_argument("--dry-run", action="store_true",
                   help="Preflight only: verify connectivity + resolve the model id, then exit. Deploys nothing.")
    p.add_argument("--detach", action="store_true",
                   help="Run in the background (survives SSH loss). Prints where the log/report live, then returns. For manual use; CI never passes it.")
    p.add_argument("--no-cleanup", action="store_true",
                   help="Leave the model deployed after the check (default: clean up to free the board)")
    p.add_argument("--no-reset", action="store_true",
                   help="Skip the whole-board reset (stop models + tt-smi -r) before the first deploy")
    args = p.parse_args()

    # --timeout is the simple knob: it sets both phase timeouts at once.
    if args.timeout is not None:
        args.deploy_timeout = args.timeout
        args.health_timeout = args.timeout

    # Resolve the run mode. --model-name (single) has priority over --models;
    # then a batch via --models; then $TTSTUDIO_MODEL_NAME; then the default.
    if args.model_name:
        models, batch = [args.model_name], False
    elif args.models:
        models, batch = args.models, True
    else:
        models, batch = [os.environ.get("TTSTUDIO_MODEL_NAME", "Qwen3-32B")], False

    # Cleanup defaults ON so CI always frees the board; --no-cleanup opts out.
    # Batch mode always cleans up between models regardless.
    do_cleanup = (not args.no_cleanup) or batch

    # Auto-name the log + report under --output-dir. Single: <model>_<ts>;
    # batch: batch_<ts>.
    if batch:
        slug = "batch"
    else:
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", models[0]).strip("-") or "model"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    base = os.path.join(args.output_dir, f"{slug}_{stamp}")
    logpath = base + ".log"
    args.report = base + ".json"
    os.makedirs(args.output_dir, exist_ok=True)

    label = f"{len(models)} models {models}" if batch else repr(models[0])
    # --detach forks into the background so a run survives losing SSH (manual use;
    # CI never passes it). The foreground process prints where the log/report live
    # and exits; the daemon child writes everything to the log file. Otherwise run
    # foreground, mirroring output to the terminal / Actions log AND the log file.
    if args.detach and not args.dry_run:
        print(f"Deploying {label} in the background.")
        print(f"  live log : {logpath}")
        print(f"  result   : {args.report}")
        print(f"  watch    : tail -f {logpath}")
        _daemonize(logpath)  # only the detached child returns from this
    else:
        sys.stdout = sys.stderr = _Tee(sys.__stdout__, open(logpath, "a"))
        print(f"logging to {logpath}")

    client = Client(args.base_url, args.proxy)
    log(f"target base_url={client.base} proxy={args.proxy} models={models} cleanup={do_cleanup}")

    run_started = time.time()
    combined = {
        "result": "unknown",
        "base_url": client.base,
        "batch": batch,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "finished_at": None,
        "duration_seconds": None,
        "models": [],
    }
    try:
        # Dry run: just resolve every model and exit — deploy nothing.
        if args.dry_run:
            ok = True
            for name in models:
                try:
                    mid = resolve_model_id(client, name, args.model_id if not batch else None)
                    combined["models"].append({"model_name": name, "model_id": mid, "result": "dry_run_ok"})
                except SmokeTestError as e:
                    ok = False
                    log(f"FAILURE: {name}: {e}")
                    combined["models"].append({"model_name": name, "result": "failed", "reason": str(e)})
            combined["result"] = "dry_run_ok" if ok else "some_failed"
            return 0 if ok else 1

        # Clean slate before the first deploy: stop any leftover models + reset
        # all devices, so a prior crashed run can't wedge the mesh.
        if not args.no_reset:
            reset_all_board(client)

        # Deploy each model in succession.
        for name in models:
            result = run_model(
                client, name,
                model_id_override=(args.model_id if not batch else None),
                do_cleanup=do_cleanup,
                deploy_timeout=args.deploy_timeout,
                health_timeout=args.health_timeout,
                poll_interval=args.poll_interval,
            )
            combined["models"].append(result)

        healthy = [m for m in combined["models"] if m["result"] == "healthy"]
        combined["result"] = "all_healthy" if len(healthy) == len(models) else "some_failed"

        # End-of-run summary — the at-a-glance answer for an overnight batch.
        log("==== summary ====")
        for m in combined["models"]:
            log(f"  {m['result']:>8}  {m['model_name']}"
                + (f"  ({m['reason'].splitlines()[0]})" if m.get("reason") else ""))
        log(f"{len(healthy)}/{len(models)} healthy")
        return 0 if combined["result"] in ("all_healthy",) else 1
    finally:
        combined["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        combined["duration_seconds"] = round(time.time() - run_started, 1)
        write_report(args.report, combined)
        emit_github_outputs(combined)


if __name__ == "__main__":
    sys.exit(main())
