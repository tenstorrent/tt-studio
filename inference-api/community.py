# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Community-model endpoints: the tt-model-manager deploy path.

Parallel to the tt-inference-server path in api.py, and deliberately shaped the same
way. A deploy returns a ``job_id`` immediately and writes into the *same* progress and
log stores, so ``/run/progress/{job_id}``, ``/run/logs/{job_id}`` and
``/run/stream/{job_id}`` serve community jobs with no changes — and the backend and
frontend track them exactly as they track an inference-server deploy.

All tt-model-manager work happens in ``tt_model_runner.py``, executed under the
artifact venv's interpreter (see tt_setup/model_manager). Nothing here imports
tt_kernel: it lives behind an incompatible pydantic pin.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

RUNNER = str(Path(__file__).parent / "tt_model_runner.py")

# Hub listings are slow and rarely change; the deploy UI reads them on every visit.
_CATALOG_TTL_SECONDS = 300

# A catalog/inspect call is one bounded Hub request. A serve has no timeout here:
# a first-time bundle install downloads an image and weights.
_QUERY_TIMEOUT_SECONDS = 90

# Byte counters a `download` event sets, in the shape inference-api's own deploys
# report so the deploy UI renders both the same way.
_DOWNLOAD_FIELDS = (
    "downloaded_bytes", "total_bytes", "speed_bps", "eta_seconds",
    "weights_repo", "weights_cached", "expects_weights",
)
# Cleared when the next stage starts, so its view does not show a finished download.
_TRANSFER_FIELDS = ("downloaded_bytes", "total_bytes", "speed_bps", "eta_seconds")

# Deploy-log lines read for the failure message when the runner exits without one.
_ERROR_TAIL_LINES = 40


class CommunityRunRequest(BaseModel):
    """One community deploy. Mirrors the fields the backend already computes for an
    inference-server deploy, so DeployView can populate both from the same place."""

    repo_id: str
    profile: Optional[str] = None
    # TT Studio's own convention: 7000 + device_id. Moves both docker's published
    # mapping and the engine's --port, keeping community and catalog models aligned.
    service_port: Optional[int] = None
    # Chips to scope the container to, matching the profile's own chip count. Omitted
    # lets tt-model-manager pick the lowest free chips itself.
    device_ids: Optional[List[int]] = None
    network: Optional[str] = "tt_studio_network"
    hf_token: Optional[str] = None
    wait_ready: bool = False


class CommunityStopRequest(BaseModel):
    repo_id: str
    profile: Optional[str] = None


def runner_python() -> Optional[str]:
    """The artifact venv interpreter, or None when the artifact is not installed."""
    python = os.environ.get("TT_MODEL_MANAGER_PYTHON")
    if python and os.path.exists(python):
        return python
    # Fall back to the conventional location so a manually-provisioned artifact works
    # even if the launcher did not export the variable.
    default = Path(__file__).parent.parent / ".artifacts" / "tt-model-manager"
    candidate = default / ".venv" / "bin" / "python"
    return str(candidate) if candidate.exists() else None


def deployment_log_path(log_dir: Path, repo_id: str, profile: Optional[str]) -> Path:
    """This deploy's log file, named like inference-server deploy logs.

    The logs browser and bug-report bundle list the directory for ``model_run_*.log``.
    """
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    bundle = re.sub(r"[^A-Za-z0-9._-]", "-", repo_id)
    name = f"model_run_{stamp}_{bundle}_{profile or 'default'}_community.log"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / name


def _tail(path: Path, lines: int) -> str:
    """Last ``lines`` of a log file, for a failure message. Never raises."""
    try:
        with open(path, "r", errors="replace") as handle:
            return "".join(deque(handle, maxlen=lines)).strip()
    except OSError:
        return ""


def _runner_env(hf_token: Optional[str] = None) -> Dict[str, str]:
    """Environment for the runner: the host user's, plus the UI-managed HF token.

    tt-model-manager passes ``--env HF_TOKEN`` by name only, so the value is
    inherited from this process rather than written into an argv that ``ps`` shows.
    """
    env = os.environ.copy()
    if hf_token:
        env["HF_TOKEN"] = hf_token
    return env


def _run_query(args: List[str], *, hf_token: Optional[str] = None) -> Dict[str, Any]:
    """Run a single-document runner command and return its one JSON object."""
    python = runner_python()
    if not python:
        raise HTTPException(
            status_code=503,
            detail="tt-model-manager is not installed; community models are unavailable",
        )
    try:
        completed = subprocess.run(
            [python, RUNNER, *args],
            capture_output=True, text=True,
            timeout=_QUERY_TIMEOUT_SECONDS,
            env=_runner_env(hf_token),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="tt-model-manager did not respond")

    payload = _last_json_line(completed.stdout)
    if payload is None:
        detail = (completed.stderr or "").strip().splitlines()
        raise HTTPException(
            status_code=502,
            detail=f"tt-model-manager produced no result: {detail[-1] if detail else 'no output'}",
        )
    if payload.get("event") == "error":
        raise HTTPException(status_code=400, detail=_error_detail(payload))
    return payload


def _last_json_line(text: str) -> Optional[Dict[str, Any]]:
    """The last parseable JSON object in the runner's stdout."""
    result = None
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            result = parsed
    return result


def _error_detail(event: Dict[str, Any]) -> str:
    """Flatten a runner error event into one actionable sentence."""
    parts = [event.get("message") or "community model operation failed"]
    if event.get("detail"):
        parts.append(str(event["detail"]))
    actions = event.get("actions") or []
    if actions:
        parts.append(f"Try: {actions[0]}")
    return " ".join(parts)


def create_community_router(
    *,
    progress_store: Dict[str, Dict[str, Any]],
    log_store: Dict[str, deque],
    progress_lock: threading.Lock,
    max_log_messages: int,
    deployment_log_dir: Optional[Path] = None,
) -> APIRouter:
    """Build the /community router bound to api.py's job stores.

    Injected rather than imported so this module has no import cycle with api.py and
    stays independently testable.
    """
    router = APIRouter(prefix="/community", tags=["community"])
    catalog_cache: Dict[str, Any] = {"fetched_at": 0.0, "key": None, "payload": None}
    cache_lock = threading.Lock()

    def _set_progress(job_id: str, **fields: Any) -> None:
        with progress_lock:
            if job_id in progress_store:
                progress_store[job_id].update({**fields, "last_updated": time.time()})

    def _clear_transfer(job_id: str) -> None:
        with progress_lock:
            record = progress_store.get(job_id)
            for key in _TRANSFER_FIELDS if record else ():
                record.pop(key, None)

    # Per-job log files; the in-memory deque is capped and dies with the process.
    log_files: Dict[str, Any] = {}

    def _append_log(job_id: str, level: str, message: str) -> None:
        with progress_lock:
            if job_id in log_store:
                log_store[job_id].append(
                    {"timestamp": time.time(), "level": level, "message": message}
                )
            handle = log_files.get(job_id)
        if handle is None:
            return
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            handle.write(f"{stamp} - {level}: {message}\n")
            handle.flush()
        except (OSError, ValueError):
            pass

    @router.get("/status")
    async def community_status():
        """Whether this host can deploy community models, and at which pin."""
        python = runner_python()
        return {
            "available": bool(python),
            "python": python,
            "ref": os.environ.get("TT_MODEL_MANAGER_REF"),
        }

    @router.get("/models")
    async def community_models(arch: Optional[str] = None, query: Optional[str] = None,
                               limit: int = 100, refresh: bool = False):
        """The community catalog for an arch, cached briefly (one Hub request)."""
        key = f"{arch}|{query}|{limit}"
        now = time.time()
        with cache_lock:
            fresh = (
                not refresh
                and catalog_cache["key"] == key
                and catalog_cache["payload"] is not None
                and now - catalog_cache["fetched_at"] < _CATALOG_TTL_SECONDS
            )
            if fresh:
                return catalog_cache["payload"]

        args = ["catalog", "--limit", str(limit)]
        if arch:
            args += ["--arch", arch]
        if query:
            args += ["--query", query]
        payload = _run_query(args)
        with cache_lock:
            catalog_cache.update({"fetched_at": now, "key": key, "payload": payload})
        return payload

    @router.get("/models/{repo_id:path}")
    async def community_model(repo_id: str):
        """Deployable metadata for one bundle: profiles, mesh, chips, weights, engine."""
        return _run_query(["inspect", repo_id])

    @router.post("/run")
    async def community_run(request: CommunityRunRequest):
        """Start a community deploy and return a job_id for the existing progress APIs."""
        if not runner_python():
            raise HTTPException(
                status_code=503,
                detail="tt-model-manager is not installed; community models are unavailable",
            )
        job_id = str(uuid.uuid4())[:8]
        with progress_lock:
            progress_store[job_id] = {
                "status": "starting",
                "stage": "initialization",
                "progress": 0,
                "message": f"Starting {request.repo_id}…",
                "last_updated": time.time(),
            }
            log_store[job_id] = deque(maxlen=max_log_messages)

        thread = threading.Thread(
            target=_drive_serve,
            args=(job_id, request),
            name=f"community-deploy-{job_id}",
            daemon=True,
        )
        thread.start()
        return {
            "status": "success",
            "job_id": job_id,
            "message": f"Deployment of {request.repo_id} started",
        }

    @router.post("/stop")
    async def community_stop(request: CommunityStopRequest):
        """Stop through tt-model-manager so the mesh is closed (and reset) properly."""
        args = ["stop", request.repo_id]
        if request.profile:
            args += ["--profile", request.profile]
        return _run_query(args)

    def _drive_serve(job_id: str, request: CommunityRunRequest) -> None:
        """Stream the runner's NDJSON into the shared job stores."""
        args = ["serve", request.repo_id]
        if request.profile:
            args += ["--profile", request.profile]
        if request.service_port:
            args += ["--port", str(request.service_port)]
        if request.device_ids:
            args += ["--device-id", ",".join(str(d) for d in request.device_ids)]
        if request.network:
            args += ["--network", request.network]
        if request.wait_ready:
            args.append("--wait-ready")

        python = runner_python()
        result: Optional[Dict[str, Any]] = None
        error: Optional[Dict[str, Any]] = None
        log_path = _open_deploy_log(job_id, request)
        try:
            process = subprocess.Popen(
                [python, RUNNER, *args],
                stdout=subprocess.PIPE,
                # tt-model-manager's console output; a file, since an undrained pipe
                # would block the runner once full.
                stderr=log_files.get(job_id) or subprocess.DEVNULL,
                text=True,
                env=_runner_env(request.hf_token),
            )
            for line in process.stdout:
                event = _parse_event(line)
                if event is None:
                    continue
                kind = event.get("event")
                if kind == "stage":
                    _clear_transfer(job_id)
                    _set_progress(
                        job_id,
                        stage=event.get("stage", "model_preparation"),
                        progress=event.get("progress", 0),
                        message=event.get("message", ""),
                    )
                    _append_log(job_id, "INFO", event.get("message", ""))
                elif kind == "download":
                    # Once a second while bytes arrive, so kept out of the log.
                    fields = {k: event[k] for k in _DOWNLOAD_FIELDS if k in event}
                    if "stage" in event:
                        fields.update(status="running", stage=event["stage"],
                                      message=event.get("message", ""))
                    _set_progress(job_id, **fields)
                elif kind in ("log", "warning"):
                    level = "WARNING" if kind == "warning" else event.get("level", "INFO")
                    _append_log(job_id, level, event.get("message", ""))
                elif kind == "started":
                    # The container exists; warmup is now tracked from its own logs by
                    # the backend's health monitor, exactly as for an inference-server
                    # deploy that returns before the model is loaded.
                    _set_progress(
                        job_id,
                        stage="container_setup",
                        progress=90,
                        message=f"{event.get('container_name')} started",
                        container_name=event.get("container_name"),
                        container_id=event.get("container_id"),
                    )
                elif kind == "result":
                    result = event
                elif kind == "error":
                    error = event
            process.wait()
            if process.returncode != 0 and error is None:
                tail = _tail(log_path, _ERROR_TAIL_LINES) if log_path else ""
                error = {
                    "message": tail.splitlines()[-1] if tail else
                    f"tt-model-manager exited with code {process.returncode}"
                }
        except Exception as exc:  # noqa: BLE001 - a thread boundary; report, never raise
            logger.exception("Community deploy %s failed", job_id)
            error = {"message": str(exc)}

        if error is not None or result is None:
            message = _error_detail(error or {"message": "deployment produced no result"})
            _set_progress(job_id, status="error", stage="error", progress=100,
                          message=message)
            _append_log(job_id, "ERROR", message)
            _close_deploy_log(job_id)
            return

        _set_progress(
            job_id,
            status="completed",
            stage="complete",
            progress=100,
            message="Deployment completed successfully",
            container_name=result.get("container_name"),
            container_id=result.get("container_id"),
        )
        _close_deploy_log(job_id)

    def _open_deploy_log(job_id: str, request: CommunityRunRequest) -> Optional[Path]:
        """Start this deploy's log file, and tell the job where it is."""
        if deployment_log_dir is None:
            return None
        try:
            path = deployment_log_path(deployment_log_dir, request.repo_id, request.profile)
            handle = open(path, "a", buffering=1)
        except OSError as e:
            logger.warning("Could not open a deploy log for %s: %s", job_id, e)
            return None
        with progress_lock:
            log_files[job_id] = handle
        _set_progress(job_id, log_file=str(path))
        _append_log(job_id, "INFO", f"deploying {request.repo_id} "
                                   f"(profile {request.profile or 'default'})")
        return path

    def _close_deploy_log(job_id: str) -> None:
        with progress_lock:
            handle = log_files.pop(job_id, None)
        if handle is not None:
            try:
                handle.close()
            except OSError:
                pass

    return router


def _parse_event(line: str) -> Optional[Dict[str, Any]]:
    line = (line or "").strip()
    if not line:
        return None
    try:
        parsed = json.loads(line)
    except ValueError:
        # The runner keeps stdout pure, so a non-JSON line means something else
        # wrote there. Log it rather than losing it.
        logger.debug("Non-JSON line from tt-model-manager runner: %s", line[:200])
        return None
    return parsed if isinstance(parsed, dict) else None
