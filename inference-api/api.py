# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, Iterable, Tuple
import sys
import os
import logging
import time
import docker
import threading
import uuid
import re
import json
from collections import deque
from pathlib import Path
from datetime import datetime
import math
import urllib.request
import urllib.error

# Add tt-inference-server root to sys.path so we can import workflows, run, etc.
# Prefer TT_INFERENCE_ARTIFACT_PATH if set; then .artifacts/tt-inference-server (default);
# otherwise fall back to tt-inference-server directory next to inference-api (e.g. git submodule).
_tt_studio_root = Path(__file__).resolve().parent.parent
_candidates = []
if os.getenv("TT_INFERENCE_ARTIFACT_PATH"):
    _candidates.append(Path(os.getenv("TT_INFERENCE_ARTIFACT_PATH")).resolve())
_candidates.append(_tt_studio_root / ".artifacts" / "tt-inference-server")
_candidates.append(_tt_studio_root / "tt-inference-server")

artifact_path = None
for _path in _candidates:
    if _path.exists() and (_path / "workflows" / "utils.py").exists():
        if str(_path) not in sys.path:
            sys.path.insert(0, str(_path))
        logging.info(f"Using tt-inference-server root: {_path}")
        artifact_path = _path
        break

if artifact_path is None:
    raise ImportError(
        "No tt-inference-server root with workflows found. "
        "Set TT_INFERENCE_ARTIFACT_PATH to .artifacts/tt-inference-server (with full workflows/) "
        "or ensure tt-inference-server/ exists at repo root with workflows/utils.py."
    )

# Patch get_repo_root_path to return artifact directory when running from artifact
# This MUST be done before importing any workflows modules that use it
import workflows.utils as workflows_utils  # noqa: E402
original_get_repo_root_path = workflows_utils.get_repo_root_path


def _patched_get_repo_root_path(marker: str = ".git") -> Path:
    """Return artifact directory as repo root when running from artifact."""
    if artifact_path and (artifact_path / "VERSION").exists():
        return artifact_path
    return original_get_repo_root_path(marker)


workflows_utils.get_repo_root_path = _patched_get_repo_root_path

# default_dotenv_path is computed at import time before the patch above takes effect,
# so explicitly override it to point to the artifact directory instead of the repo root.
if artifact_path:
    workflows_utils.default_dotenv_path = Path(artifact_path) / ".env"

# Patch setup_run_logger so run_log file handler is always present even when
# other handlers were attached to run_log before run_main() executes.
import workflows.log_setup as workflows_log_setup  # noqa: E402
original_setup_run_logger = workflows_log_setup.setup_run_logger


def _patched_setup_run_logger(logger, run_id, run_log_path, log_level=logging.DEBUG):
    configured_logger = original_setup_run_logger(logger, run_id, run_log_path, log_level)
    run_logger = logging.getLogger("run_log")
    target_run_log_path = Path(run_log_path)
    target_run_log_file = target_run_log_path.expanduser()

    handler_exists = any(
        isinstance(h, logging.FileHandler)
        and getattr(h, "baseFilename", None)
        and Path(h.baseFilename).expanduser() == target_run_log_file
        for h in run_logger.handlers
    )
    if handler_exists:
        return configured_logger

    target_run_log_path.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(target_run_log_path)
    file_handler.setLevel(log_level)
    formatter = workflows_log_setup.ConditionalFormatter(
        "%(asctime)s - %(filename)s:%(lineno)d - %(levelname)s: %(message)s"
    )
    file_handler.setFormatter(formatter)
    run_logger.addHandler(file_handler)
    return configured_logger


workflows_log_setup.setup_run_logger = _patched_setup_run_logger

# Import from tt-inference-server
try:
    from run import main as run_main, WorkflowType, DeviceTypes  # noqa: E402
    from workflows.model_spec import MODEL_SPECS  # noqa: E402
except ImportError as e:
    raise ImportError(
        f"Failed to import from tt-inference-server: {e}\n"
        f"Ensure TT_INFERENCE_ARTIFACT_PATH or tt-inference-server/ provides run and workflows."
    ) from e

# Set up logging
# DO NOT use basicConfig() - it interferes with file handlers
# Instead, configure logging manually
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)  # Set level on the logger itself
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")

# Configure FastAPI logger to also write to file
def setup_fastapi_file_logging():
    """Set up file logging for FastAPI - writes to fastapi.log at TT Studio root"""
    try:
        # Put the log file at TT Studio root:
        # <tt_studio_root>/fastapi.log
        tt_studio_root = Path(__file__).parent.parent.resolve()
        root_log_dir = tt_studio_root
        root_log_dir.mkdir(parents=True, exist_ok=True)
        root_log_file = root_log_dir / "fastapi.log"

        # Keep append mode here. run.py also streams uvicorn output to this file,
        # so truncate mode can create confusing interleaving/overwrite artifacts.
        root_handler = logging.FileHandler(root_log_file, mode="a", encoding="utf-8")
        root_handler.setLevel(logging.DEBUG)

        formatter = logging.Formatter(
            "%(asctime)s - %(filename)s:%(lineno)d - %(levelname)s: %(message)s"
        )
        root_handler.setFormatter(formatter)

        # Configure root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.DEBUG)

        # Remove any existing handlers to avoid duplicate logs (especially uvicorn's default ones)
        for h in root_logger.handlers[:]:
            root_logger.removeHandler(h)

        root_logger.addHandler(root_handler)

        # Let sub-loggers propagate into the root
        logger.setLevel(logging.DEBUG)
        logger.propagate = True

        for name, level in [
            ("fastapi", logging.INFO),
            ("uvicorn", logging.INFO),
            ("uvicorn.access", logging.INFO),
            ("uvicorn.error", logging.INFO),
        ]:
            l = logging.getLogger(name)
            l.setLevel(level)
            l.propagate = True

        logger.info(f"FastAPI file logging configured - writing to {root_log_file}")
        logger.debug(f"Root log absolute path: {root_log_file.absolute()}")

    except Exception as e:
        error_msg = f"Failed to setup FastAPI file logging: {e}"
        print(error_msg, file=sys.stderr)
        import traceback
        print(traceback.format_exc(), file=sys.stderr)

        # Try to write error to a local fallback log
        try:
            fallback_log = Path(__file__).parent / "fastapi_setup_error.log"
            with open(fallback_log, "a") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - {error_msg}\n")
                f.write(traceback.format_exc())
        except Exception:
            pass  # If even fallback fails, just continue

# Initialize file logging
setup_fastapi_file_logging()

# Global progress store with thread-safe access
progress_store: Dict[str, Dict[str, Any]] = {}
log_store: Dict[str, deque] = {}
progress_lock = threading.Lock()

# Store per-deployment log handlers for cleanup
deployment_log_handlers: Dict[str, logging.FileHandler] = {}

# Maximum number of log messages to keep per job
MAX_LOG_MESSAGES = 100
# Deployment timeout: 5 hours to allow for large model downloads
DEPLOYMENT_TIMEOUT_SECONDS = 5 * 60 * 60  # 5 hours

# Regex pattern for structured progress signals
PROG_RE = re.compile(r"TT_PROGRESS stage=(\w+) pct=(\d{1,3}) msg=(.*)$")

_DOCKER_RUN_NAME_RE = re.compile(r"--name\s+(?P<name>[^\s]+)")
_RUN_LOG_PATH_RE = re.compile(r"This log file is saved on local machine at:\s*(?P<path>\S+)")
_DOCKER_WORKFLOW_LOG_PATH_RE = re.compile(r"Running docker container with log file:\s*(?P<path>\S+)")

# Host-setup / weights download hints (from tt-inference-server logs)
_HF_DOWNLOAD_REPO_RE = re.compile(r"Downloading model from Hugging Face:\s*(?P<repo>[^\s]+)")
_HOST_HF_HOME_RE = re.compile(r"HOST_HF_HOME set to\s*(?P<path>\S+)")


def _format_bytes(num_bytes: Optional[float]) -> str:
    if not num_bytes or num_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    idx = min(int(math.log(num_bytes, 1024)), len(units) - 1)
    scaled = num_bytes / (1024 ** idx)
    # Keep it compact for UI messages
    if scaled >= 100 or idx == 0:
        return f"{scaled:.0f} {units[idx]}"
    if scaled >= 10:
        return f"{scaled:.1f} {units[idx]}"
    return f"{scaled:.2f} {units[idx]}"


def _format_eta(seconds: Optional[float]) -> str:
    if seconds is None or seconds < 0 or math.isinf(seconds) or math.isnan(seconds):
        return "ETA ?"
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"ETA {h}h {m:02d}m"
    if m > 0:
        return f"ETA {m}m {sec:02d}s"
    return f"ETA {sec}s"


def _extract_repo_and_hf_home_from_job_logs(job_id: str) -> Tuple[Optional[str], Optional[str]]:
    """Best-effort extraction of HF repo id and HOST_HF_HOME from captured run.py logs."""
    with progress_lock:
        entries = list(log_store.get(job_id, []))
    repo = None
    hf_home = None
    for e in entries:
        msg = str(e.get("message", ""))
        if repo is None:
            m = _HF_DOWNLOAD_REPO_RE.search(msg)
            if m:
                repo = m.group("repo")
        if hf_home is None:
            m = _HOST_HF_HOME_RE.search(msg)
            if m:
                hf_home = m.group("path")
        if repo and hf_home:
            break
    return repo, hf_home


def _default_hf_home() -> Path:
    # Mirror tt-inference-server defaulting behavior (HOST_HF_HOME -> HF_HOME -> ~/.cache/huggingface)
    return Path(
        os.getenv(
            "HOST_HF_HOME",
            os.getenv("HF_HOME", str(Path.home() / ".cache" / "huggingface")),
        )
    )


def _hf_cache_repo_root(hf_home: Path, repo_id: str) -> Optional[Path]:
    """Return the repo cache root under HF_HOME (supports both 'hub/' and legacy layouts)."""
    local_repo = repo_id.replace("/", "--")
    candidates = [
        hf_home / "hub" / f"models--{local_repo}",
        hf_home / f"models--{local_repo}",
    ]
    for p in candidates:
        if p.exists():
            return p
    # Return first candidate even if it doesn't exist yet (download just started)
    return candidates[0] if candidates else None


def _dir_size_bytes(path: Path) -> int:
    """Fast, non-recursive size sum for a directory of files."""
    try:
        total = 0
        if not path.exists() or not path.is_dir():
            return 0
        with os.scandir(path) as it:
            for entry in it:
                try:
                    if entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                except FileNotFoundError:
                    # File may disappear mid-scan; ignore.
                    continue
        return total
    except Exception:
        return 0


def _get_downloaded_bytes_from_hf_cache(hf_home: Path, repo_id: str) -> int:
    """Estimate downloaded bytes by summing HF cache blobs (and temp/incomplete) sizes."""
    repo_root = _hf_cache_repo_root(hf_home, repo_id)
    if not repo_root:
        return 0
    blobs = _dir_size_bytes(repo_root / "blobs")
    # Some downloads keep partials in "tmp" and/or ".incomplete" files; count tmp as well.
    tmp = _dir_size_bytes(repo_root / "tmp")
    return blobs + tmp


def _fetch_hf_total_bytes(repo_id: str, hf_token: str, exclude_prefixes: Iterable[str]) -> Optional[int]:
    """Fetch total expected bytes from Hugging Face model metadata (best-effort)."""
    if not repo_id or "/" not in repo_id:
        return None
    url = f"https://huggingface.co/api/models/{repo_id}"
    headers = {"User-Agent": "tt-studio/weights-progress"}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
        payload = json.loads(data.decode("utf-8"))
        siblings = payload.get("siblings", [])
        total = 0
        for s in siblings:
            try:
                name = s.get("rfilename") or ""
                if any(name.startswith(pfx) for pfx in exclude_prefixes):
                    continue
                size = s.get("size")
                if isinstance(size, int) and size > 0:
                    total += size
            except Exception:
                continue
        return total if total > 0 else None
    except urllib.error.HTTPError as e:
        logger.debug(f"HF total-bytes fetch failed for {repo_id}: HTTP {e.code}")
        return None
    except Exception as e:
        logger.debug(f"HF total-bytes fetch failed for {repo_id}: {e}")
        return None


def _weights_progress_monitor(job_id: str, stop_event: threading.Event) -> None:
    """Background monitor: converts HF cache growth into % + ETA and updates progress_store.

    This is designed to cover long-running `hf download <repo>` operations where tt-inference-server
    does not emit structured per-file progress events.
    """
    last_bytes = 0
    last_t = time.time()
    ema_speed_bps: Optional[float] = None
    repo_id: Optional[str] = None
    hf_home: Optional[Path] = None
    exclude_prefixes = ("original/",)

    # Poll at 1s cadence; keep it lightweight (single dir scan).
    while not stop_event.is_set():
        with progress_lock:
            cur = progress_store.get(job_id)
            if not cur:
                return
            status = cur.get("status")
            stage = cur.get("stage")
            if status in {"completed", "error", "failed", "timeout", "cancelled"}:
                return
            # If we've moved on to container setup/finalizing, stop updating weights progress.
            if stage in {"container_setup", "finalizing", "complete"}:
                return

        # Discover repo + HF_HOME from logs (these appear before the download starts).
        if repo_id is None or hf_home is None:
            discovered_repo, discovered_home = _extract_repo_and_hf_home_from_job_logs(job_id)
            if repo_id is None:
                repo_id = discovered_repo
            if hf_home is None:
                hf_home = Path(discovered_home) if discovered_home else None

        if hf_home is None:
            hf_home = _default_hf_home()

        if repo_id:
            downloaded = _get_downloaded_bytes_from_hf_cache(hf_home, repo_id)
            now = time.time()
            dt = max(1e-3, now - last_t)
            delta = downloaded - last_bytes
            if delta > 0:
                inst_speed = delta / dt
                # Exponential moving average to stabilize ETA.
                if ema_speed_bps is None:
                    ema_speed_bps = inst_speed
                else:
                    alpha = 0.2
                    ema_speed_bps = alpha * inst_speed + (1 - alpha) * ema_speed_bps
                last_bytes = downloaded
                last_t = now

            # Map weights download into the pre-40% portion of model_preparation.
            # tt-inference-server emits pct=40 when host setup completes; stay below that.
            with progress_lock:
                cur = progress_store.get(job_id)
                if not cur:
                    return
                status = cur.get("status")
                stage = cur.get("stage")
                if status not in {"starting", "running"} or stage in {"container_setup", "finalizing", "complete"}:
                    pass
                else:
                    base = 15  # env+setup emits 15%
                    max_before_host_setup_done = 39
                    progress_val = cur.get("progress", 0) or 0
                    # Without a known total size, we can't compute % completion. Still advance
                    # slightly so users can tell we're alive (cap below host-setup completion).
                    progress_val = max(progress_val, min(max_before_host_setup_done, base + 1))

                    speed_txt = _format_bytes(ema_speed_bps) + "/s" if ema_speed_bps else "—"
                    msg = f"Downloading weights: {_format_bytes(downloaded)} • {speed_txt}"

                    cur.update(
                        {
                            "status": "running",
                            "stage": "model_preparation",
                            "progress": progress_val,
                            "message": msg[:200],
                            "last_updated": time.time(),
                            "weights_repo": repo_id,
                            "downloaded_bytes": int(downloaded),
                            "speed_bps": float(ema_speed_bps) if ema_speed_bps is not None else None,
                        }
                    )

        time.sleep(1.0)


def _extract_from_job_logs(job_id: str) -> Dict[str, Optional[str]]:
    """Best-effort extraction of run outputs from captured run.py logs."""
    entries = list(log_store.get(job_id, []))
    text = "\n".join([str(e.get("message", "")) for e in entries])

    container_name = None
    m = _DOCKER_RUN_NAME_RE.search(text)
    if m:
        container_name = m.group("name")

    run_log_file_path = None
    m = _RUN_LOG_PATH_RE.search(text)
    if m:
        run_log_file_path = m.group("path")

    docker_log_file_path = None
    m = _DOCKER_WORKFLOW_LOG_PATH_RE.search(text)
    if m:
        docker_log_file_path = m.group("path")

    return {
        "container_name": container_name,
        "run_log_file_path": run_log_file_path,
        "docker_log_file_path": docker_log_file_path,
    }


class ProgressHandler(logging.Handler):
    """Custom logging handler to capture progress from run.py execution"""
    
    def __init__(self, job_id: str):
        super().__init__()
        self.job_id = job_id
        
        # Initialize log store for this job
        with progress_lock:
            if job_id not in log_store:
                log_store[job_id] = deque(maxlen=MAX_LOG_MESSAGES)
        
    def emit(self, record):
        message = record.getMessage()
        
        # Store raw log message
        with progress_lock:
            if self.job_id in log_store:
                log_store[self.job_id].append({
                    "timestamp": record.created,
                    "level": record.levelname,
                    "message": message
                })
        
        # 1) Structured DEBUG path - prefer this when available
        structured_parsed = False
        if record.levelno <= logging.DEBUG:
            m = PROG_RE.search(message)
            if m:
                stage, pct, text = m.group(1), int(m.group(2)), m.group(3)
                status = "running"
                if stage == "complete":
                    status = "completed"
                elif stage == "error":
                    status = "error"

                with progress_lock:
                    if self.job_id in progress_store:
                        cur = progress_store[self.job_id]
                        cur_status = cur.get("status", "running")
                        if cur_status in ("completed", "failed", "cancelled"):
                            pass
                        else:
                            prev = cur.get("progress", 0)
                            pct = max(prev, pct)  # monotonic clamp
                            progress_store[self.job_id].update({
                                "status": status,
                                "stage": stage,
                                "progress": pct,
                                "message": text[:200],
                                "last_updated": time.time(),
                            })
                    else:
                        # Initialize if not exists
                        progress_store[self.job_id] = {
                            "status": status,
                            "stage": stage,
                            "progress": pct,
                            "message": text[:200],
                            "last_updated": time.time(),
                        }
                structured_parsed = True

        # 2) Fallback: existing INFO-based heuristics (only if structured parsing didn't work)
        if not structured_parsed:
            stage = "unknown"
            progress = 0
            status = "running"
        
            # Based on the fastapi.log patterns, parse deployment stages
            if any(keyword in message.lower() for keyword in ["validate_runtime_args", "handle_secrets", "validate_local_setup"]):
                stage = "initialization"
                progress = 5
            elif any(keyword in message.lower() for keyword in ["setup_host", "setting up python venv", "loaded environment"]):
                stage = "setup"
                progress = 15
            elif any(keyword in message.lower() for keyword in ["downloading model", "huggingface-cli download", "setup already completed"]):
                stage = "model_preparation"
                progress = 40
            # HF metadata/config file fetch (e.g. "Fetching 15 files:  47%|...")
            elif "fetching" in message.lower() and "files" in message.lower():
                stage = "model_preparation"
                progress = 20
                message = "Downloading model configuration files..."
            # Docker image layer pull (e.g. "abc123: Download complete", "Pulling from ...")
            elif any(keyword in message.lower() for keyword in [
                "pulling from",
                ": download complete",
                ": verifying checksum",
                ": pull complete",
                ": already exists",
            ]):
                stage = "container_setup"
                progress = 50
                message = "Pulling container image layers..."
            elif any(keyword in message.lower() for keyword in ["docker run command", "running docker container"]):
                stage = "container_setup"
                progress = 70
            elif any(keyword in message.lower() for keyword in ["searching for container", "looking for container"]):
                stage = "finalizing"
                progress = 85
            elif any(keyword in message.lower() for keyword in ["connected container", "tt_studio_network"]):
                stage = "finalizing"
                progress = 90
            elif "renamed container" in message.lower():
                # This is the KEY indicator that deployment is complete!
                stage = "complete"
                progress = 100
                status = "completed"
            elif "deployment completed successfully" in message.lower():
                stage = "complete"
                progress = 100
                status = "completed"
            elif any(p in message.lower() for p in ["401", "403", "token invalid", "access not granted", "gated repo", "unauthorized", "hf_token"]) and any(p in message.lower() for p in ["huggingface", "hugging face", "hf_token", "token"]):
                status = "error"
                stage = "error"
                message = "HF_TOKEN authentication failed: your Hugging Face token is invalid, expired, or does not have access to this model. Re-run 'python run.py' to update your token."
            elif any(keyword in message for keyword in ["⛔", "Error", "Failed", "error"]):
                false_positives = [
                    "any errors will be in the logs",
                    "if you encounter any issues",
                    "see error messages in logs",
                    "this log file is saved",
                    "no config file found",
                    "the output of the workflows is not checked",
                ]
                if not any(fp in message.lower() for fp in false_positives):
                    status = "error"
                    stage = "error"
                
            # Update progress store (only if we have meaningful progress)
            if progress > 0 or status in ["error", "completed"]:
                with progress_lock:
                    if self.job_id in progress_store:
                        current_progress = progress_store[self.job_id].get("progress", 0)
                        current_status = progress_store[self.job_id].get("status", "running")
                        # Never let a log-line override a terminal status
                        if current_status in ("completed", "failed", "cancelled"):
                            pass
                        elif progress > current_progress or status == "error" or status == "completed":
                            progress_store[self.job_id].update({
                                "status": status,
                                "stage": stage,
                                "progress": progress,
                                "message": message[:200],
                                "last_updated": time.time()
                            })
                    else:
                        # Initialize if not exists
                        progress_store[self.job_id] = {
                            "status": status,
                            "stage": stage,
                            "progress": progress,
                            "message": message[:200],
                            "last_updated": time.time()
                        }


class FastAPIHandler(logging.Handler):
    """Forward run.py logs into FastAPI logger output."""

    def emit(self, record):
        # Forward run.py logs as plain text to avoid carriage-return and ANSI artifacts.
        message = record.getMessage().replace("\r", "\n")
        message = ANSI_ESCAPE_RE.sub("", message)
        for line in message.splitlines() or [""]:
            logger.info(f"[RUN.PY] {line}")

app = FastAPI(
    title="TT Inference Server API",
    description="Fast API wrapper for the TT Inference Server run script",
    version="1.3.0"
)

# Test logging on startup
logger.info("FastAPI application initialized")
logger.info("Progress tracking system enabled")
logger.debug("Debug logging test message")

class RunRequest(BaseModel):
    model: str
    workflow: str
    device: str
    impl: Optional[str] = None
    local_server: Optional[bool] = False
    docker_server: Optional[bool] = False
    interactive: Optional[bool] = False
    workflow_args: Optional[str] = None
    service_port: Optional[str] = "7000"
    disable_trace_capture: Optional[bool] = False
    dev_mode: Optional[bool] = False
    override_docker_image: Optional[str] = None
    device_id: Optional[str] = None
    override_tt_config: Optional[str] = None
    vllm_override_args: Optional[str] = None
    # Optional secrets - can be passed through API if not set in environment
    jwt_secret: Optional[str] = None
    hf_token: Optional[str] = None
    # Internal flag to track if this is already a retry (to prevent infinite loops)
    is_retry: Optional[bool] = False
    skip_system_sw_validation: Optional[bool] = False

def normalize_device_alias(device: str) -> str:
    """Normalize device aliases to supported device names"""
    if not device:
        return device
    alias_map = {
        "p300cx2": "p300x2",
        "p300c*2": "p300x2",
        "p300*2": "p300x2",
    }
    return alias_map.get(device.strip().lower(), device)

def get_fastapi_logs_dir():
    """Get the FastAPI logs directory at TT Studio root"""
    tt_studio_root = Path(__file__).parent.parent.resolve()
    fastapi_logs_dir = tt_studio_root / "fastapi_logs"
    fastapi_logs_dir.mkdir(parents=True, exist_ok=True)
    return fastapi_logs_dir

def create_deployment_log_handler(job_id: str, model: str, device: str):
    """Create a per-deployment log file handler with model and device in filename"""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    fastapi_logs_dir = get_fastapi_logs_dir()
    
    # Create log file with pattern: fastapi_YYYY-MM-DD_HH-MM-SS_ModelName_device_server.log
    log_filename = f"fastapi_{timestamp}_{model}_{device}_server.log"
    log_file_path = fastapi_logs_dir / log_filename
    
    # Create file handler
    file_handler = logging.FileHandler(log_file_path, mode='w')
    file_handler.setLevel(logging.DEBUG)
    
    # Use workflow log format
    formatter = logging.Formatter(
        "%(asctime)s - %(filename)s:%(lineno)d - %(levelname)s: %(message)s"
    )
    file_handler.setFormatter(formatter)
    
    # Store handler reference for cleanup
    with progress_lock:
        deployment_log_handlers[job_id] = file_handler
    
    logger.info(f"Created per-deployment log file: {log_file_path}")
    return file_handler, log_file_path

def setup_run_logging_to_fastapi():
    """Configure run.py logging to also write to FastAPI logger"""
    # Get the run_log logger that run.py uses
    run_logger = logging.getLogger("run_log")

    # Add the FastAPI handler to run_logger
    fastapi_handler = FastAPIHandler()
    fastapi_handler.setLevel(logging.DEBUG)  # Capture DEBUG messages too

    # Check if this handler is already added to avoid duplicates
    handler_exists = any(isinstance(h, FastAPIHandler) for h in run_logger.handlers)

    if not handler_exists:
        run_logger.addHandler(fastapi_handler)
        logger.info("Added FastAPI logging handler to run_log logger")

@app.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {"message": "TT Inference Server API is running"}

@app.get("/health")
async def health():
    """Lightweight health check endpoint"""
    logger.info("Health endpoint accessed")
    return {
        "status": "ok",
        "timestamp": time.time(),
    }
@app.get("/test-logging")
async def test_logging():
    """Test endpoint to verify logging is working"""
    logger.info("Test logging endpoint called")
    logger.debug("Debug level test message")
    logger.warning("Warning level test message")
    return {
        "message": "Logging test completed", 
        "check": "fastapi.log file for log messages",
        "timestamp": time.time()
    }

@app.get("/run/progress/{job_id}")
async def get_run_progress(job_id: str):
    """Get progress for a running deployment job"""
    with progress_lock:
        progress = progress_store.get(job_id, {
            "status": "not_found",
            "stage": "unknown",
            "progress": 0,
            "message": "Job not found",
            "last_updated": time.time()
        })
        
        # Add stalled detection (>120s no updates)
        if progress["status"] == "running" and "last_updated" in progress:
            time_since_update = time.time() - progress["last_updated"]
            if time_since_update > DEPLOYMENT_TIMEOUT_SECONDS:  # 2 minutes
                progress = progress.copy()  # Don't modify the stored version
                progress["status"] = "stalled"
                progress["message"] = f"No progress updates for {int(time_since_update)}s - deployment may be stalled"
                
    return progress

@app.get("/run/logs/{job_id}")
async def get_run_logs(job_id: str, limit: int = 50):
    """Get recent log messages for a deployment job"""
    with progress_lock:
        logs = log_store.get(job_id, deque())
        # Convert deque to list and get last 'limit' messages
        log_list = list(logs)[-limit:] if logs else []
    
    return {
        "job_id": job_id,
        "logs": log_list,
        "total_messages": len(log_list)
    }

@app.get("/run/stream/{job_id}")
async def stream_run_progress(job_id: str):
    """Stream real-time progress updates via Server-Sent Events"""
    
    def event_generator():
        last_progress = None
        
        # Send initial progress if available
        with progress_lock:
            if job_id in progress_store:
                last_progress = progress_store[job_id].copy()
                yield f"data: {json.dumps(last_progress)}\n\n"
        
        # Poll for updates and stream changes
        while True:
            try:
                with progress_lock:
                    current_progress = progress_store.get(job_id)
                    
                    if current_progress:
                        # Check if progress has changed
                        if not last_progress or current_progress != last_progress:
                            last_progress = current_progress.copy()
                            
                            # Add stalled detection (>5 hours no updates)
                            # Changed from 120s to 5 hours to accommodate long model downloads
                            if current_progress["status"] == "running" and "last_updated" in current_progress:
                                time_since_update = time.time() - current_progress["last_updated"]
                                if time_since_update > DEPLOYMENT_TIMEOUT_SECONDS:  # 5 hours
                                    last_progress["status"] = "stalled"
                                    last_progress["message"] = f"No progress updates for {int(time_since_update/60)} minutes - deployment may be stalled"
                            
                            yield f"data: {json.dumps(last_progress)}\n\n"
                            
                            # Stop streaming if deployment is complete or failed
                            if last_progress["status"] in ["completed", "error", "failed", "cancelled"]:
                                break
                    else:
                        # Job not found
                        yield f"data: {json.dumps({'status': 'not_found', 'message': 'Job not found'})}\n\n"
                        break
                
                # Wait before next poll
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"Error in SSE stream: {str(e)}")
                yield f"data: {json.dumps({'status': 'error', 'message': f'Stream error: {str(e)}'})}\n\n"
                break
    
    # Only enable SSE if TT_PROGRESS_SSE is set
    if os.getenv("TT_PROGRESS_SSE") != "1":
        raise HTTPException(status_code=404, detail="SSE endpoint not enabled")
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

def sync_tokens_from_tt_studio():
    """
    Cross-check and sync JWT_SECRET and HF_TOKEN from TT Studio's .env 
    to inference server's .env file if they differ.
    """
    from workflows.utils import load_dotenv
    
    # Paths to .env files
    tt_studio_root = os.getenv("TT_STUDIO_ROOT")
    if not tt_studio_root:
        logger.warning("TT_STUDIO_ROOT environment variable not set, cannot sync tokens")
        return
    tt_studio_env = Path(tt_studio_root) / "app" / ".env"
    
    # Use artifact directory for inference server .env if available, otherwise use TT Studio root
    if artifact_path:
        inference_server_env = Path(artifact_path) / ".env"
    else:
        inference_server_env = tt_studio_root / ".env"
    
    # Read TT Studio .env values
    tt_studio_jwt = None
    tt_studio_hf = None
    
    if tt_studio_env.exists():
        with open(tt_studio_env, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key == 'JWT_SECRET':
                            tt_studio_jwt = value
                        elif key == 'HF_TOKEN':
                            tt_studio_hf = value
    else:
        logger.warning(f"TT Studio .env file not found at {tt_studio_env}")
        return
    
    # Read inference server .env values
    inference_jwt = None
    inference_hf = None
    env_lines = []
    
    if inference_server_env.exists():
        with open(inference_server_env, 'r') as f:
            env_lines = f.readlines()
            for line in env_lines:
                line_stripped = line.strip()
                if line_stripped and not line_stripped.startswith('#'):
                    if '=' in line_stripped:
                        key, value = line_stripped.split('=', 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key == 'JWT_SECRET':
                            inference_jwt = value
                        elif key == 'HF_TOKEN':
                            inference_hf = value
    
    # Check for differences and update if needed
    updated = False
    
    # Update or add JWT_SECRET
    if tt_studio_jwt and tt_studio_jwt != inference_jwt:
        logger.info("JWT_SECRET differs between TT Studio and inference server - updating inference server .env")
        # Remove old JWT_SECRET line if exists
        env_lines = [line for line in env_lines 
                    if not line.strip().startswith('JWT_SECRET=')]
        # Add new JWT_SECRET
        env_lines.append(f"JWT_SECRET={tt_studio_jwt}\n")
        updated = True
    
    # Update or add HF_TOKEN
    if tt_studio_hf and tt_studio_hf != inference_hf:
        logger.info("HF_TOKEN differs between TT Studio and inference server - updating inference server .env")
        # Remove old HF_TOKEN line if exists
        env_lines = [line for line in env_lines 
                    if not line.strip().startswith('HF_TOKEN=')]
        # Add new HF_TOKEN
        env_lines.append(f"HF_TOKEN={tt_studio_hf}\n")
        updated = True
    
    # Write back if updated
    if updated:
        with open(inference_server_env, 'w') as f:
            f.writelines(env_lines)
        logger.info(f"Updated inference server .env file at {inference_server_env}")
        # Reload environment variables
        load_dotenv()
    else:
        logger.info("JWT_SECRET and HF_TOKEN are already synchronized")

@app.post("/run")
async def run_inference(request: RunRequest):
    deployment_log_handler = None
    deployment_log_path = None
    try:
        original_device = request.device
        normalized_device = normalize_device_alias(request.device)
        if normalized_device != original_device:
            logger.info(
                "Normalizing device alias from %s to %s",
                original_device,
                normalized_device,
            )
        # Generate a unique job ID for this deployment
        job_id = str(uuid.uuid4())[:8]
        
        # Create per-deployment log file
        deployment_log_handler, deployment_log_path = create_deployment_log_handler(
            job_id, request.model, request.device
        )
        
        # Attach deployment log handler to relevant loggers
        logger.addHandler(deployment_log_handler)
        run_logger = logging.getLogger("run_log")
        run_logger.addHandler(deployment_log_handler)
        
        # Initialize progress tracking
        with progress_lock:
            progress_store[job_id] = {
                "status": "starting",
                "stage": "initialization",
                "progress": 0,
                "message": "Starting deployment...",
                "last_updated": time.time()
            }
            log_store[job_id] = deque(maxlen=MAX_LOG_MESSAGES)
        
        # Sync tokens from TT Studio before setting environment variables
        try:
            sync_tokens_from_tt_studio()
        except Exception as e:
            logger.warning(f"Failed to sync tokens from TT Studio: {e}")
            # Continue anyway - tokens might be set via request or environment
        
        # Ensure we're in the correct working directory (use artifact directory if available)
        if artifact_path and os.path.exists(artifact_path):
            script_dir = Path(artifact_path).resolve()
        else:
            # Fallback: try to find artifact directory in standard location
            default_artifact_dir = Path(__file__).parent.parent / ".artifacts" / "tt-inference-server"
            if default_artifact_dir.exists():
                script_dir = default_artifact_dir.resolve()
                logger.info(f"Using default artifact directory: {script_dir}")
            else:
                script_dir = Path(__file__).parent.absolute()
                logger.warning(f"Artifact directory not found, using inference-api directory: {script_dir}")
        
        # Set required environment variables for automatic setup
        # Note: Since the FastAPI server now runs as the actual user (not root),
        # Path.home() in get_default_hf_home_path() will correctly return the user's home directory
        # (e.g., /home/username/.cache/huggingface instead of /root/.cache/huggingface)
        env_vars_to_set = {
            "AUTOMATIC_HOST_SETUP": "True",
            "TT_PROGRESS_DEBUG": "1",  # Enable structured progress emission
            "TT_PROGRESS_SSE": "1",     # Enable SSE endpoint for real-time progress
            "SERVICE_PORT": request.service_port or "7000"  # Use requested port (per-slot)
        }
        
        # Handle secrets - use from request if provided and not already in environment
        if request.jwt_secret and not os.getenv("JWT_SECRET"):
            logger.info("Setting JWT_SECRET from request")
            env_vars_to_set["JWT_SECRET"] = request.jwt_secret
        elif not os.getenv("JWT_SECRET"):
            logger.warning("JWT_SECRET not set - this may cause issues")
            
        if request.hf_token and not os.getenv("HF_TOKEN"):
            logger.info("Setting HF_TOKEN from request")
            env_vars_to_set["HF_TOKEN"] = request.hf_token
        elif not os.getenv("HF_TOKEN"):
            logger.warning("HF_TOKEN not set - this may cause issues with model downloads")
            
        # Set environment variables
        for key, value in env_vars_to_set.items():
            if key in ["JWT_SECRET", "HF_TOKEN"]:
                logger.info(f"Setting environment variable: {key}=[REDACTED]")
            else:
                logger.info(f"Setting environment variable: {key}={value}")
            os.environ[key] = value

        
        # Convert the request to command line arguments
        sys.argv = ["run.py"]  # Reset sys.argv
        
        # Add required arguments
        sys.argv.extend(["--model", request.model])
        sys.argv.extend(["--workflow", request.workflow])
        sys.argv.extend(["--device", normalized_device])
        sys.argv.extend(["--docker-server"])
         # Add dev-mode if requested (used for auto-retry on failure)
        if request.dev_mode:
            sys.argv.extend(["--dev-mode"])
        # Skip system software validation if requested (handles prerelease versions like '2.6.0-rc1')
        if request.skip_system_sw_validation:
            sys.argv.extend(["--skip-system-sw-validation"])
        sys.argv.extend(["--service-port", request.service_port or "7000"])
        
        # Add optional arguments if they are set
        if request.impl:
            sys.argv.extend(["--impl", request.impl])
        if request.local_server:
            sys.argv.append("--local-server")
        if request.interactive:
            sys.argv.append("--interactive")
        if request.workflow_args:
            sys.argv.extend(["--workflow-args", request.workflow_args])
        if request.disable_trace_capture:
            sys.argv.append("--disable-trace-capture")
        if request.override_docker_image:
            sys.argv.extend(["--override-docker-image", request.override_docker_image])
        if request.device_id:
            sys.argv.extend(["--device-id", request.device_id])
        if request.override_tt_config:
            sys.argv.extend(["--override-tt-config", request.override_tt_config])
        if request.vllm_override_args:
            sys.argv.extend(["--vllm-override-args", request.vllm_override_args])

        def _run_job_in_background():
            weights_stop_event = threading.Event()
            progress_handler = None
            # Save global state (best-effort; TT Studio typically runs one deployment at a time)
            prev_argv = list(sys.argv)
            prev_cwd = Path.cwd()
            prev_env = os.environ.copy()
            run_logger = logging.getLogger("run_log")
            try:
                # Apply env vars (including secrets if provided)
                for key, value in env_vars_to_set.items():
                    os.environ[key] = value

                # Start weights progress monitor (keeps progress moving during long hf downloads)
                threading.Thread(
                    target=_weights_progress_monitor,
                    args=(job_id, weights_stop_event),
                    daemon=True,
                ).start()

                # Forward run.py logs and parse TT_PROGRESS
                setup_run_logging_to_fastapi()
                progress_handler = ProgressHandler(job_id)
                run_logger.addHandler(progress_handler)

                # Switch cwd for tt-inference-server execution
                if prev_cwd != script_dir:
                    os.chdir(script_dir)

                def _execute_run(argv_for_attempt: list[str]) -> Tuple[int, Optional[Dict[str, Any]]]:
                    """Execute run_main() for one attempt and return (code, container_info)."""
                    sys.argv = argv_for_attempt
                    logger.info(
                        f"Job {job_id}: run.py command: python {' '.join(argv_for_attempt)}"
                    )
                    logger.info(f"Job {job_id}: Starting run_main(): {' '.join(argv_for_attempt)}")
                    run_result = run_main()
                    if isinstance(run_result, tuple):
                        attempt_return_code, attempt_container_info = run_result
                    else:
                        attempt_return_code = run_result
                        attempt_container_info = None
                    logger.info(f"Job {job_id}: run_main() return code: {attempt_return_code}")
                    logger.info(f"Job {job_id}: container_info:= {attempt_container_info}")
                    return attempt_return_code, attempt_container_info

                def _build_retry_argv_and_reason() -> Tuple[list[str], str]:
                    retry_argv = list(sys.argv)
                    retry_reason_parts: list[str] = []
                    if request.skip_system_sw_validation and "--skip-system-sw-validation" not in retry_argv:
                        retry_argv.append("--skip-system-sw-validation")
                        retry_reason_parts.append("--skip-system-sw-validation")
                    retry_reason = " and ".join(retry_reason_parts) if retry_reason_parts else "same options"
                    return retry_argv, retry_reason

                try:
                    return_code, container_info = _execute_run(sys.argv)
                except Exception as first_attempt_error:
                    # run_main() can raise directly (e.g. local setup validation errors)
                    # and bypass return-code based retry logic.
                    retry_argv, retry_reason = _build_retry_argv_and_reason()
                    logger.warning(
                        "Job %s: first run raised (%s), retrying once with %s",
                        job_id,
                        type(first_attempt_error).__name__,
                        retry_reason,
                    )
                    with progress_lock:
                        if job_id in progress_store:
                            current_progress = progress_store[job_id].get("progress", 0)
                            progress_store[job_id].update(
                                {
                                    "status": "retrying",
                                    "stage": "container_setup",
                                    "progress": max(current_progress, 70),
                                    "message": f"Retrying deployment with {retry_reason}...",
                                    "last_updated": time.time(),
                                }
                            )
                    return_code, container_info = _execute_run(retry_argv)

                # Retry once when the initial run fails.
                if return_code != 0:
                    retry_argv, retry_reason = _build_retry_argv_and_reason()
                    logger.warning(
                        "Job %s: first run failed (code %s), retrying once with %s",
                        job_id,
                        return_code,
                        retry_reason,
                    )
                    with progress_lock:
                        if job_id in progress_store:
                            current_progress = progress_store[job_id].get("progress", 0)
                            progress_store[job_id].update(
                                {
                                    "status": "retrying",
                                    "stage": "container_setup",
                                    "progress": max(current_progress, 70),
                                    "message": f"Retrying deployment with {retry_reason}...",
                                    "last_updated": time.time(),
                                }
                            )
                    return_code, container_info = _execute_run(retry_argv)

                if return_code == 0:
                    if not isinstance(container_info, dict) or not container_info.get("container_name"):
                        extracted = _extract_from_job_logs(job_id)
                        inferred_name = extracted.get("container_name")
                        if inferred_name:
                            container_info = {
                                "container_name": inferred_name,
                                "container_id": None,
                                "service_port": str(os.getenv("SERVICE_PORT") or ""),
                                "docker_log_file_path": extracted.get("docker_log_file_path"),
                                "run_log_file_path": extracted.get("run_log_file_path"),
                            }
                            logger.info(f"Job {job_id}: inferred container_name='{inferred_name}' from logs.")

                    container_name = container_info.get("container_name") if isinstance(container_info, dict) else None
                    container_id = container_info.get("container_id") if isinstance(container_info, dict) else None
                    docker_log_file_path = container_info.get("docker_log_file_path") if isinstance(container_info, dict) else None
                    run_log_file_path = container_info.get("run_log_file_path") if isinstance(container_info, dict) else None

                    response_data = {
                        "job_id": job_id,
                        "status": "completed",
                        "progress_url": f"/run/progress/{job_id}",
                        "logs_url": f"/run/logs/{job_id}",
                        "container_name": container_name,
                        "container_id": container_id,
                        "docker_log_file_path": docker_log_file_path,
                        "run_log_file_path": run_log_file_path,
                        "message": "Deployment completed successfully",
                    }

                    # Best-effort: connect to tt_studio_network and rename container
                    try:
                        client = docker.from_env()
                        target_container_name = container_name
                        target_container_id = container_id
                        service_port = (container_info or {}).get("service_port") if isinstance(container_info, dict) else None

                        max_retries = 10
                        retry_interval = 3
                        attempt = 0
                        new_container = None
                        while attempt < max_retries and not new_container:
                            all_containers = client.containers.list()
                            if target_container_id:
                                for c in all_containers:
                                    if c.id.startswith(target_container_id):
                                        new_container = c
                                        break
                            if not new_container and target_container_name:
                                for c in all_containers:
                                    if c.name == target_container_name:
                                        new_container = c
                                        break
                            if not new_container and service_port:
                                for c in all_containers:
                                    container_ports = c.attrs.get("NetworkSettings", {}).get("Ports", {})
                                    for port_config in container_ports.values():
                                        if port_config and port_config[0].get("HostPort") == str(service_port):
                                            new_container = c
                                            break
                                    if new_container:
                                        break
                            if not new_container:
                                attempt += 1
                                if attempt < max_retries:
                                    time.sleep(retry_interval)

                        if new_container:
                            original_name = new_container.name
                            if new_container.id:
                                response_data["container_id"] = new_container.id
                            try:
                                network = client.networks.get("tt_studio_network")
                                network.connect(new_container)
                            except Exception:
                                pass
                            # Rename for easier identification
                            model_name = request.model.replace("/", "-")
                            if original_name != model_name:
                                try:
                                    new_container.rename(model_name)
                                    response_data["container_name"] = model_name
                                except Exception:
                                    pass
                    except Exception as e:
                        logger.error(f"Job {job_id}: post-run docker ops failed: {e}")

                    with progress_lock:
                        if job_id in progress_store:
                            progress_store[job_id].update(
                                {
                                    "status": "completed",
                                    "stage": "complete",
                                    "progress": 100,
                                    "message": "Deployment completed successfully",
                                    "last_updated": time.time(),
                                    "container_name": response_data.get("container_name"),
                                    "container_id": response_data.get("container_id"),
                                    "docker_log_file_path": response_data.get("docker_log_file_path"),
                                    "run_log_file_path": response_data.get("run_log_file_path"),
                                }
                            )
                else:
                    # Scan recent logs for auth errors to surface a clear message
                    auth_patterns = ["401", "403", "token invalid", "access not granted", "gated repo", "unauthorized", "hf_token", "gatedrepoerror"]
                    auth_error_msg = None
                    for entry in reversed(list(log_store.get(job_id, []))):
                        msg = entry.get("message", "").lower()
                        if any(p in msg for p in auth_patterns) and any(p in msg for p in ["huggingface", "hugging face", "hf_token", "token"]):
                            auth_error_msg = "HF_TOKEN authentication failed: your Hugging Face token is invalid, expired, or does not have access to this model. Re-run 'python run.py' to update your token."
                            break
                    with progress_lock:
                        if job_id in progress_store:
                            progress_store[job_id].update(
                                {
                                    "status": "failed",
                                    "stage": "error",
                                    "progress": 0,
                                    "message": auth_error_msg or f"Deployment failed with return code: {return_code}",
                                    "last_updated": time.time(),
                                }
                            )
            except Exception as e:
                logger.error(f"Job {job_id}: error: {e}", exc_info=True)
                with progress_lock:
                    if job_id in progress_store:
                        progress_store[job_id].update(
                            {
                                "status": "error",
                                "stage": "error",
                                "progress": 0,
                                "message": f"Deployment error: {str(e)[:200]}",
                                "last_updated": time.time(),
                            }
                        )
            finally:
                # Stop weights monitor
                try:
                    weights_stop_event.set()
                except Exception:
                    pass

                # Remove handlers (progress handler + per-deployment log handler)
                try:
                    if progress_handler:
                        run_logger.removeHandler(progress_handler)
                except Exception:
                    pass
                try:
                    if deployment_log_handler:
                        logger.removeHandler(deployment_log_handler)
                        run_logger.removeHandler(deployment_log_handler)
                        deployment_log_handler.close()
                        with progress_lock:
                            if job_id in deployment_log_handlers:
                                del deployment_log_handlers[job_id]
                except Exception:
                    pass

                # Restore globals
                try:
                    sys.argv = prev_argv
                except Exception:
                    pass
                try:
                    if Path.cwd() != prev_cwd:
                        os.chdir(prev_cwd)
                except Exception:
                    pass
                try:
                    os.environ.clear()
                    os.environ.update(prev_env)
                except Exception:
                    pass

        threading.Thread(target=_run_job_in_background, daemon=True).start()

        # Return immediately so the frontend can poll progress while model weights download.
        return JSONResponse(
            status_code=202,
            content={
                "status": "success",
                "job_id": job_id,
                "message": "Deployment started",
                "progress_url": f"/run/progress/{job_id}",
                "logs_url": f"/run/logs/{job_id}",
            },
            headers={"Location": f"/run/progress/{job_id}"},
        )
            
    except Exception as e:
        logger.error(f"Error in run_inference: {str(e)}", exc_info=True)
        
        # Clean up per-deployment log handler if it was created
        if 'deployment_log_handler' in locals() and deployment_log_handler:
            try:
                logger.removeHandler(deployment_log_handler)
                run_logger = logging.getLogger("run_log")
                run_logger.removeHandler(deployment_log_handler)
                deployment_log_handler.close()
                if 'job_id' in locals():
                    with progress_lock:
                        if job_id in deployment_log_handlers:
                            del deployment_log_handlers[job_id]
            except Exception as cleanup_error:
                logger.error(f"Error cleaning up deployment log handler in exception handler: {cleanup_error}")
        
        # Update progress for exception
        if 'job_id' in locals():
            with progress_lock:
                if job_id in progress_store:
                    progress_store[job_id].update({
                        "status": "error",
                        "stage": "error",
                        "progress": 0,
                        "message": f"Deployment error: {str(e)[:200]}",
                        "last_updated": time.time()
                    })
        
        # Restore working directory in case of exception
        if 'original_cwd' in locals() and 'script_dir' in locals() and original_cwd != script_dir:
            os.chdir(original_cwd)
        
        # Return JSONResponse instead of raising HTTPException to include job_id
        if 'job_id' in locals():
            return JSONResponse(
                status_code=500,
                content={
                    "status": "error",
                    "job_id": job_id,
                    "message": f"Deployment error: {str(e)}",
                    "progress_url": f"/run/progress/{job_id}",
                    "logs_url": f"/run/logs/{job_id}"
                }
            )
        else:
            # If job_id wasn't created yet, raise HTTPException
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/models")
async def get_available_models():
    """Get list of available models"""
    return {"models": list(set(spec.model_name for _, spec in MODEL_SPECS.items()))}

@app.get("/workflows")
async def get_available_workflows():
    """Get list of available workflows"""
    return {"workflows": [w.name.lower() for w in WorkflowType]}

@app.get("/devices")
async def get_available_devices():
    """Get list of available devices"""
    return {"devices": [d.name.lower() for d in DeviceTypes]} 