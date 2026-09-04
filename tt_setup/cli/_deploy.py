# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Terminal-driven model deploy for `python run.py run <model>`.

Drives the backend deploy API directly (no browser, no frontend JS) and renders
the deploy the way the rest of the launcher renders work: one collapsing line per
stage, a live bar while the Docker image or the weights download, and a ready
panel with the model's endpoint once it answers health checks.

The HTTP plumbing (catalog resolve, endpoint map, error type) is borrowed from
ci/deploy_healthcheck.py via the `dh` module handle so the CLI and CI exercise
the same request path.
"""

import sys
import time

from rich.progress import BarColumn, Progress, TextColumn
from tt_setup.console import console, is_verbose, notice_panel, ready_panel
from tt_setup.console._theme import _real_console

# Backend progress `stage` -> what the user sees. Mirrors the web UI's labels so a
# terminal deploy and a browser deploy tell the same story.
STAGE_LABELS = {
    "starting": "Starting deployment",
    "initialization": "Loading environment",
    "setup": "Running workflow configuration",
    "pulling_image": "Pulling Docker image",
    "image_ready": "Image ready",
    "model_preparation": "Preparing model",
    "container_setup": "Starting container",
    "container_started": "Container started",
    "network_setup": "Connecting to network",
    "finalizing": "Finalizing",
    "complete": "Deployed",
    "error": "Failed",
    "unknown": "Working",
}

# Stages whose progress payload can carry byte-level download detail.
DOWNLOAD_STAGES = {"pulling_image", "model_preparation"}

PROGRESS_DONE = "completed"
PROGRESS_FAIL = {"error", "failed", "timeout", "cancelled"}

# How long a fresh deploy job may report `not_found` before it counts as gone.
# The progress record can lag the deploy POST by a few seconds; past this, the
# backend has genuinely forgotten the job (e.g. it restarted) and polling for
# the full timeout would only spin.
NOT_FOUND_GRACE_S = 30


# ── pure helpers (unit-tested without a backend) ──────────────────────────────

def deploy_mode(args):
    """Where a `run <model>` deploy happens: "browser" (web UI drives it),
    "terminal" (this process drives the backend API), or None (no model)."""
    if not getattr(args, "auto_deploy", None):
        return None
    return "browser" if getattr(args, "browser", False) else "terminal"


def should_open_browser(args):
    """A terminal deploy never opens a browser — the terminal *is* the UI for that
    run. Otherwise honour --no-browser as before."""
    if deploy_mode(args) == "terminal":
        return False
    return not getattr(args, "no_browser", False)


def format_bytes(n):
    """Decimal units to match what Hugging Face and Docker report."""
    if n is None or n < 0:
        return "—"
    value, unit = float(n), "B"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1000 or unit == "TB":
            break
        value /= 1000
    if unit == "B":
        return f"{int(value)} B"
    text = f"{value:.0f}" if value >= 100 else f"{value:.1f}".rstrip("0").rstrip(".")
    return f"{text} {unit}"


def stage_label(data):
    """Headline for a progress payload. A weights download that is reporting
    bytes gets a more specific label than the generic 'Preparing model'."""
    stage = (data.get("stage") or "unknown").lower()
    if stage == "model_preparation" and data.get("downloaded_bytes") is not None:
        return "Downloading model weights"
    return STAGE_LABELS.get(stage, stage.replace("_", " ").capitalize())


def download_detail(data):
    """'1.2 GB / 23.3 GB · 85 MB/s' while an image or weights download is
    reporting bytes; None otherwise."""
    stage = (data.get("stage") or "").lower()
    if stage not in DOWNLOAD_STAGES or data.get("downloaded_bytes") is None:
        return None
    parts = [format_bytes(data["downloaded_bytes"])]
    if data.get("total_bytes"):
        parts[0] += f" / {format_bytes(data['total_bytes'])}"
    if data.get("speed_bps"):
        parts.append(f"{format_bytes(data['speed_bps'])}/s")
    return " · ".join(parts)


def download_fraction(data):
    """0..1 completion of the current download, or None when bytes are unknown."""
    total = data.get("total_bytes")
    done = data.get("downloaded_bytes")
    if not total or done is None:
        return None
    return max(0.0, min(1.0, done / total))


def endpoint_for(entry, host="localhost"):
    """Host-reachable URLs for a deployed-models entry (the dict served under
    /models/deployed/<id>). Returns {"url", "health", "port", "model_type"} —
    values are None when the entry doesn't expose them."""
    impl = entry.get("model_impl") or {}
    port = None
    for bindings in (entry.get("port_bindings") or {}).values():
        for b in bindings or []:
            if b.get("HostPort"):
                port = b["HostPort"]
                break
        if port:
            break
    route = impl.get("service_route") or ""
    health_route = impl.get("health_route") or "/health"
    base = f"http://{host}:{port}" if port else None
    return {
        "port": port,
        "url": f"{base}{route}" if base else None,
        "health": f"{base}{health_route}" if base else None,
        "model_type": impl.get("model_type"),
    }


def curl_example(url, model_type, hf_model_id=None):
    """A copy-pasteable first request for chat endpoints; None for other types."""
    if not url or model_type != "chat":
        return None
    model = hf_model_id or "<model>"
    return (
        f'curl {url} -H "Content-Type: application/json" '
        f'-d \'{{"model":"{model}","messages":[{{"role":"user","content":"Hello"}}]}}\''
    )


# ── backend interaction ───────────────────────────────────────────────────────

def resolve_model_with_retry(dh, client, model_name, deadline_s=60, sleep=time.sleep):
    """Resolve a catalog model id, retrying briefly while the backend is still
    warming up right after the stack came up. A true miss is not retried."""
    deadline = time.time() + deadline_s
    last_err = None
    while time.time() < deadline:
        try:
            return dh.resolve_model_id(client, model_name, None), None
        except dh.SmokeTestError as e:
            last_err = e
            if "cannot reach" in str(e) or "catalog fetch failed" in str(e):
                sleep(3)
                continue
            break
    return None, last_err


def watch_progress(dh, client, job_id, timeout=3600, interval=3, sleep=time.sleep):
    """Poll the deploy until it completes, rendering stage transitions as
    collapsed ✓ lines and the live stage (with download bytes) on a transient
    bar. Falls back to change-only plain lines when stdout is not a terminal.

    Returns the final progress payload; raises dh.SmokeTestError on failure."""
    tty = sys.stdout.isatty()
    started = time.time()
    deadline = started + timeout
    current_stage = None
    current_label = STAGE_LABELS["starting"]
    current_started = time.time()
    last_total = None
    last_plain = None

    progress = None
    task = None
    if tty:
        progress = Progress(
            TextColumn("  [info]{task.description}[/info]"),
            BarColumn(bar_width=24),
            TextColumn("[muted]{task.fields[detail]}[/muted]"),
            console=_real_console,
            transient=True,
        )
        progress.start()
        task = progress.add_task("Starting deployment", total=100, completed=0, detail="")

    def _finish_stage(label, started, note=None):
        elapsed = time.time() - started
        suffix = f" [muted]({note})[/muted]" if note else ""
        console.print(f"  [success]✓[/success] {label}{suffix} [muted]{elapsed:.0f}s[/muted]")

    try:
        while time.time() < deadline:
            st, data = client.get("progress", timeout=15, job_id=job_id)
            if st != 200 or not isinstance(data, dict):
                sleep(interval)
                continue
            status_ = (data.get("status") or "").lower()
            if status_ == "not_found":
                # Nothing to render yet; either the record is still registering
                # (keep waiting) or the backend has lost the job (give up).
                if time.time() - started > NOT_FOUND_GRACE_S:
                    raise dh.SmokeTestError(
                        "deployment lost: the backend no longer reports this deploy job "
                        f"(id {job_id}). It may have restarted; check the Deployed Models page."
                    )
                sleep(interval)
                continue
            stage = (data.get("stage") or "unknown").lower()
            label = stage_label(data)
            detail = download_detail(data)

            if stage != current_stage:
                if current_stage is not None:
                    prev_note = None
                    if current_stage in DOWNLOAD_STAGES and last_total:
                        prev_note = format_bytes(last_total)
                    _finish_stage(current_label, current_started, prev_note)
                current_stage, current_label, current_started = stage, label, time.time()
                last_total = None
            if data.get("total_bytes"):
                last_total = data["total_bytes"]
            if stage in DOWNLOAD_STAGES:
                current_label = label  # 'Preparing model' -> 'Downloading model weights'

            if progress is not None:
                frac = download_fraction(data)
                pct = frac * 100 if frac is not None else float(data.get("progress") or 0)
                progress.update(task, description=label, completed=pct, detail=detail or (data.get("message") or ""))
            else:
                line = f"  {label}" + (f" — {detail}" if detail else "")
                if line != last_plain:
                    console.print(line)
                    last_plain = line

            if status_ == PROGRESS_DONE:
                # The terminal "complete" stage is the ready panel's job to announce.
                if current_stage not in ("complete", "completed"):
                    _finish_stage(current_label, current_started)
                return data
            if status_ in PROGRESS_FAIL:
                reason = data.get("message") or status_
                raise dh.SmokeTestError(
                    f"deployment {status_}: {reason}\n  {dh.fetch_deploy_logs(client, job_id)}"
                )
            sleep(interval)
    finally:
        if progress is not None:
            progress.stop()

    raise dh.SmokeTestError(
        f"deployment did not complete within {timeout}s\n  {dh.fetch_deploy_logs(client, job_id)}"
    )


def find_deployed_entry(client, model_id, timeout=120, interval=3, sleep=time.sleep):
    """After 'completed', the container shows up under /models/deployed/ keyed by
    its deploy id. Returns (deploy_id, entry) or (None, None) on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st, data = client.get("deployed", timeout=15)
        except Exception:
            st, data = None, None
        if st == 200 and isinstance(data, dict):
            for deploy_id, entry in data.items():
                impl = entry.get("model_impl") or {}
                if impl.get("model_id") == model_id:
                    return deploy_id, entry
        sleep(interval)
    return None, None


def wait_for_health(client, deploy_id, timeout=1800, interval=5, sleep=time.sleep):
    """Poll /models/health/ until the model answers 200. 202 = still warming.
    Returns True when healthy, False on timeout or a hard failure."""
    deadline = time.time() + timeout
    consecutive_503 = 0
    while time.time() < deadline:
        try:
            st, _ = client.get("health", timeout=20, query={"deploy_id": deploy_id})
        except Exception:
            st = None
        if st == 200:
            return True
        if st == 503:
            consecutive_503 += 1
            if consecutive_503 >= 3:
                return False
        else:
            consecutive_503 = 0
        sleep(interval)
    return False


def run_headless_deploy(dh, args, backend_url="http://localhost:8000", frontend=("localhost", 3000)):
    """Deploy `args.auto_deploy` from the terminal and show where it is serving.

    device_id is included only when the user set it; otherwise it's omitted so
    the backend allocates a slot based on the model's chip requirements."""
    client = dh.Client(backend_url, proxy=False)
    model_name = args.auto_deploy
    device_id = getattr(args, "device_id", None)
    fe_host, fe_port = frontend

    model_id, err = resolve_model_with_retry(dh, client, model_name)
    if model_id is None:
        console.print(notice_panel("Deploy failed", [str(err)], border_style="error"))
        return False

    body = {"model_id": model_id}
    if device_id is not None:
        body["device_id"] = device_id
    else:
        # Same whole-card hint the web UI sends for an unpinned deploy. The
        # backend honours it only where it matters (Llama-3.1-8B on a P300x2
        # dies on a lone chip) and ignores it everywhere else.
        body["force_full_board"] = True
    where = f"chip {device_id}" if device_id is not None else "auto-allocated slot"
    web_ui = f"http://{fe_host}:{fe_port}/models-deployed"

    try:
        st, data = client.post("deploy", body, timeout=120)
        if st not in (200, 201) or data.get("status") != "success":
            msg = data.get("message") if isinstance(data, dict) else None
            lines = [msg or f"deploy failed (HTTP {st}): {data}"]
            if isinstance(data, dict) and data.get("hf_url"):
                lines += ["", f"Request access at {data['hf_url']}, then run again."]
            if isinstance(data, dict) and data.get("conflicts"):
                busy = ", ".join(
                    f"{c.get('model', 'another model')} (device {c.get('slot', '?')})"
                    for c in data["conflicts"]
                )
                lines += ["", f"Stop these first: {busy}."]
            console.print(notice_panel("Deploy refused", lines, border_style="error"))
            return False
        job_id = data.get("job_id")
        if not job_id:
            raise dh.SmokeTestError(f"deploy returned no job_id: {data}")

        console.print(f"\n[bold accent]🚀 Deploying {model_name}[/bold accent] [muted]({where})[/muted]")
        console.print("  [muted]Ctrl-C stops watching; the deploy keeps running in the backend.[/muted]")
        watch_progress(dh, client, job_id)
        deploy_id, entry = find_deployed_entry(client, model_id)
        healthy = False
        if deploy_id:
            console.print("  [muted]Waiting for the model to answer health checks…[/muted]")
            healthy = wait_for_health(client, deploy_id)
    except dh.SmokeTestError as e:
        console.print(notice_panel("Deploy failed", [str(e)], border_style="error"))
        return False
    except KeyboardInterrupt:
        console.print()
        console.print(notice_panel("Stopped watching", [
            f"{model_name} keeps deploying in the backend.",
            f"Follow it at {web_ui}, or run python run.py --status.",
            f"To cancel it: python run.py --stop-model {model_name}",
        ], border_style="warning"))
        return False

    ep = endpoint_for(entry or {}, host=fe_host)

    impl = (entry or {}).get("model_impl") or {}
    chips = (entry or {}).get("device_ids") or ([device_id] if device_id is not None else [])
    rows = [("Model", model_name)]
    if chips:
        rows.append(("Chips", ", ".join(str(c) for c in chips)))
    if ep["url"]:
        rows.append(("Endpoint", ep["url"], "up" if healthy else "starting"))
    if ep["health"]:
        rows.append(("Health", ep["health"]))
    rows.append(("Web UI", web_ui))

    footer = []
    if not healthy:
        footer.append("[warning]The model is still warming up — the endpoint answers once health reports 200.[/warning]")
    example = curl_example(ep["url"], ep["model_type"], impl.get("hf_model_id"))
    if example:
        footer.append("[muted]Try it:[/muted]")
        footer.append(f"  [info]{example}[/info]")
    footer.append("[muted]python run.py --stop to stop · python run.py --logs for logs[/muted]")

    title = f"{model_name} is ready" if healthy else f"{model_name} is starting"
    console.print()
    console.print(ready_panel(title, rows, footer))
    console.print()
    if is_verbose() and deploy_id:
        console.print(f"[muted]deploy id: {deploy_id}[/muted]")
    return healthy
