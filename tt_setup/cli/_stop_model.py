# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`python run.py --stop-model [MODEL]` — stop one deployed model and reset the
chip(s) it occupied, without tearing the stack down.

Talks to the running backend: /models/deployed/ to find the model, then the
streaming stop endpoint (stop/stream/<container_id>/), which stops the container
and runs the per-chip `tt-smi -r` reset, reporting each step as Server-Sent
Events. Bare --stop-model opens a numbered picker of what is deployed.
"""

import json
import sys
import urllib.error
import urllib.request

from tt_setup.console import ask, console, is_verbose, notice_panel
from tt_setup.constants import _PURGE_MODEL_PICKER
from tt_setup.env_config import get_env_var


class StopModelError(Exception):
    pass


def backend_url():
    return f"http://localhost:{get_env_var('BACKEND_PORT', '8000') or '8000'}"


# ── pure helpers ──────────────────────────────────────────────────────────────

def summarize_deployed(payload):
    """Flatten the /models/deployed/ dict into picker rows:
    [{"id", "name", "model_name", "device_ids", "model_type"}], stable order."""
    rows = []
    for container_id, entry in (payload or {}).items():
        impl = entry.get("model_impl") or {}
        rows.append({
            "id": container_id,
            "name": entry.get("name") or impl.get("model_name") or container_id[:12],
            "model_name": impl.get("model_name") or entry.get("name") or "",
            "device_ids": entry.get("device_ids") or (
                [entry["device_id"]] if entry.get("device_id") is not None else []),
            "model_type": impl.get("model_type") or entry.get("model_type") or "",
        })
    rows.sort(key=lambda r: (r["device_ids"] or [999], r["name"]))
    return rows


def match_deployed(rows, wanted):
    """Resolve a user-typed name against deployed rows: exact (case-insensitive)
    on the container name or the catalog model name first, then a unique
    substring match. Returns (row, None) or (None, reason)."""
    needle = wanted.strip().lower()
    if not needle:
        return None, "empty model name"
    exact = [r for r in rows if needle in (r["name"].lower(), r["model_name"].lower())]
    if len(exact) == 1:
        return exact[0], None
    if len(exact) > 1:
        return None, f'"{wanted}" matches several deployments: ' + ", ".join(r["name"] for r in exact)
    loose = [r for r in rows if needle in r["name"].lower() or needle in r["model_name"].lower()]
    if len(loose) == 1:
        return loose[0], None
    if len(loose) > 1:
        return None, f'"{wanted}" is ambiguous: ' + ", ".join(r["name"] for r in loose) + ". Use an exact name."
    return None, f'"{wanted}" is not deployed'


def parse_sse(lines):
    """Yield the JSON payload of each `data:` frame in an SSE byte/str stream."""
    for raw in lines:
        line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        line = line.rstrip("\r\n")
        if not line.startswith("data:"):
            continue
        body = line[len("data:"):].strip()
        if not body:
            continue
        try:
            yield json.loads(body)
        except json.JSONDecodeError:
            yield {"type": "log", "message": body}


def parse_selection(raw, count):
    """'1 3', '1,3' or 'all' -> sorted unique 1-based indices; [] when invalid."""
    raw = (raw or "").strip().lower()
    if raw == "all":
        return list(range(1, count + 1))
    picked = set()
    for tok in raw.replace(",", " ").split():
        if not tok.isdigit() or not 1 <= int(tok) <= count:
            return []
        picked.add(int(tok))
    return sorted(picked)


# ── backend interaction ───────────────────────────────────────────────────────

def fetch_deployed(base):
    try:
        with urllib.request.urlopen(f"{base}/models/deployed/", timeout=15) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.URLError as e:
        raise StopModelError(f"cannot reach the TT Studio backend at {base}: {e.reason}")


def stream_stop(base, container_id, timeout=900):
    """GET the stop stream and yield its parsed events until the connection ends."""
    url = f"{base}/docker/stop/stream/{container_id}/"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            yield from parse_sse(resp)
    except urllib.error.URLError as e:
        raise StopModelError(f"stop request failed: {e.reason}")


def stop_one(base, row, stream=stream_stop):
    """Stop + reset one deployment, rendering the backend's steps. Returns True
    when the backend reported success."""
    chips = ", ".join(str(d) for d in row["device_ids"]) or "unknown"
    console.print(f"\n[bold accent]⏹  Stopping {row['name']}[/bold accent] [muted](chips {chips})[/muted]")
    final = None
    for event in stream(base, row["id"]):
        kind = event.get("type")
        msg = event.get("message", "")
        if kind == "step":
            console.print(f"  [info]•[/info] {msg}")
        elif kind == "log":
            if is_verbose():
                console.print(f"    [muted]{msg}[/muted]")
        elif kind == "complete":
            final = event
            break
    if final is None:
        console.print("  [warning]⚠  The stop stream ended without a result — check the Deployed Models page.[/warning]")
        return False
    if final.get("status") == "success":
        console.print(f"  [success]✓[/success] {final.get('message') or 'Stopped and reset'}")
        return True
    console.print(f"  [error]✗[/error] {final.get('message') or 'Stop failed'}")
    return False


def pick_interactively(rows):
    """Numbered picker over deployed models. None when the user cancels."""
    console.print("\n[bold]Deployed models[/bold]")
    for i, r in enumerate(rows, start=1):
        chips = ", ".join(str(d) for d in r["device_ids"]) or "—"
        kind = f" [muted]{r['model_type']}[/muted]" if r["model_type"] else ""
        console.print(f"  [bold]{i:>2}[/bold]  {r['name']}{kind}  [muted]chips {chips}[/muted]")
    while True:
        try:
            raw = ask("Models to stop (e.g. '1 3', or 'all'; Enter to cancel)", default="")
        except (KeyboardInterrupt, EOFError):
            raw = ""
        raw = (raw or "").strip()
        if raw.lower() in ("", "q", "quit", "n", "no"):
            console.print("\n[info]🛑 Aborted — nothing was stopped.[/info]")
            return None
        selection = parse_selection(raw, len(rows))
        if selection:
            return [rows[i - 1] for i in selection]
        console.print(f"[muted]Enter numbers between 1 and {len(rows)} (space/comma separated), or 'all'.[/muted]")


def stop_models(args, base=None, fetch=fetch_deployed, stream=stream_stop):
    """Entry point for --stop-model. Exit code 0 on success or a clean abort; 1
    when a name doesn't resolve (nothing is stopped in that case), the picker has
    no terminal, the backend is unreachable, or a stop/reset did not succeed."""
    base = base or backend_url()
    requested = list(getattr(args, "stop_model", None) or [])
    picker_requested = all(t == _PURGE_MODEL_PICKER for t in requested)

    try:
        rows = summarize_deployed(fetch(base))
    except StopModelError as e:
        console.print()
        console.print(notice_panel("TT Studio isn't reachable", [
            str(e), "",
            "Start it with python run.py, then run --stop-model again.",
        ], border_style="error"))
        return 1

    if not rows:
        console.print("\n[info]No models are deployed — nothing to stop.[/info]")
        return 0

    if picker_requested:
        if not sys.stdin.isatty():
            console.print()
            console.print(notice_panel("--stop-model needs a terminal for its picker", [
                "Pass the model name instead: python run.py --stop-model <name>",
                "Deployed now: " + ", ".join(r["name"] for r in rows),
            ], border_style="error"))
            return 1
        selected = pick_interactively(rows)
        if selected is None:
            return 0
    else:
        selected, problems = [], []
        for wanted in requested:
            if wanted == _PURGE_MODEL_PICKER:
                continue
            row, why = match_deployed(rows, wanted)
            if row is None:
                problems.append(why)
            elif row not in selected:
                selected.append(row)
        if problems:
            console.print()
            console.print(notice_panel("Model not found", problems + [
                "", "Deployed now: " + ", ".join(r["name"] for r in rows),
            ], border_style="error"))
            return 1

    # Attempt every selection even if one fails, then report the worst outcome.
    results = [stop_one(base, row, stream=stream) for row in selected]
    console.print()
    return 0 if all(results) else 1
