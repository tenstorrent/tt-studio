# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, Iterable, Tuple
import sys
import os
import inspect
import logging
import time
import docker
import threading
import uuid
import re
import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime
import math
import shlex
import urllib.request
import urllib.error

# Add tt-inference-server root to sys.path so we can import workflows, run, etc.
# Prefer TT_INFERENCE_ARTIFACT_PATH if set; then .artifacts/tt-inference-server (default artifact location);
# otherwise fall back to tt-inference-server/ at repo root (manual local dev checkout).
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

    # workflows.utils.load_dotenv / write_dotenv freeze `default_dotenv_path` as a default
    # argument value at import time (Python evaluates defaults once, at definition time),
    # which resolved to the tt-studio repo root. Reassigning the module attribute above does
    # NOT rebind those already-frozen defaults, so the artifact's no-arg load_dotenv()/
    # write_dotenv() calls would still read/write a stray .env at the tt-studio repo root
    # (GitHub issue #820). Rebind the frozen `dotenv_path` default in place so every caller —
    # including the artifact's own run.py, which imports the same function objects — targets
    # the artifact's .env instead.
    _artifact_dotenv = Path(artifact_path) / ".env"
    for _fn_name in ("load_dotenv", "write_dotenv"):
        try:
            _fn = getattr(workflows_utils, _fn_name, None)
            if _fn is None or not getattr(_fn, "__defaults__", None):
                continue
            _params = list(inspect.signature(_fn).parameters.values())
            # Defaults align to the trailing parameters that have defaults.
            _defaulted = [p for p in _params if p.default is not inspect.Parameter.empty]
            _new_defaults = list(_fn.__defaults__)
            _rebound = False
            for _idx, _param in enumerate(_defaulted):
                if _param.name == "dotenv_path":
                    _new_defaults[_idx] = _artifact_dotenv
                    _rebound = True
            if _rebound:
                _fn.__defaults__ = tuple(_new_defaults)
            else:
                logging.warning(
                    "workflows.utils.%s has no 'dotenv_path' parameter to rebind; "
                    "a stray .env may still be written to the repo root.",
                    _fn_name,
                )
        except Exception as exc:  # pragma: no cover - defensive: never block import
            logging.warning("Could not rebind default dotenv path for %s: %s", _fn_name, exc)

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

# Isolate docker subprocess invocations from this uvicorn process's signal cascade.
# The artifact's run_docker_server.py uses `subprocess.Popen(["docker", "run", ...])`
# in foreground (no -d, with --rm), so when this FastAPI process gets killed/restarted
# by run.py (`--cleanup` or `--dev` re-entry on port 8001), the docker-run client
# inherits the signal and tears down its container. start_new_session=True puts the
# child in its own session/process group, immune to the parent's signal-group death.
# Media containers happen to survive today without this; LLM containers don't.
# See issue #825.
import subprocess as _subprocess  # noqa: E402
_orig_popen = _subprocess.Popen


def _isolated_popen(*args, **kwargs):
    argv = args[0] if args else kwargs.get("args")
    if isinstance(argv, (list, tuple)) and argv and argv[0] == "docker":
        kwargs.setdefault("start_new_session", True)
    return _orig_popen(*args, **kwargs)


_subprocess.Popen = _isolated_popen

# Import from tt-inference-server
try:
    from run import main as run_main, WorkflowType, DeviceTypes  # noqa: E402
    from workflows.model_spec import MODEL_SPECS, get_runtime_model_spec  # noqa: E402
except ImportError as e:
    raise ImportError(
        f"Failed to import from tt-inference-server: {e}\n"
        f"Ensure TT_INFERENCE_ARTIFACT_PATH or tt-inference-server/ provides run and workflows."
    ) from e

# Patch HostSetupManager.check_model_weights_dir to guard against partially-downloaded
# HF cache snapshots. The original method globs for any *.safetensors and returns True
# if found, but a prior interrupted download can leave some shards complete (as symlinks
# in the snapshot dir) while earlier shards are still in-progress .incomplete blobs two
# levels up in blobs/. Without this patch, setup skips the download and launches the
# container with missing shards → FileNotFoundError crash.
#
# Only overrides True → False (never the reverse). Fails open on any exception so a
# permission error or unexpected path layout never blocks a valid deploy.
import workflows.setup_host as _setup_host_module  # noqa: E402
_orig_check_model_weights_dir = _setup_host_module.HostSetupManager.check_model_weights_dir


def _patched_check_model_weights_dir(self, host_weights_dir):
    result = _orig_check_model_weights_dir(self, host_weights_dir)
    if not result or host_weights_dir is None:
        return result
    # Navigate to the HF cache blobs/ dir (two levels above the snapshot dir).
    # Layout: hub/models--<org>--<repo>/snapshots/<sha>/ → ../../blobs/
    try:
        blobs_dir = host_weights_dir.parent.parent / "blobs"
    except Exception:
        return result
    if not blobs_dir.is_dir():
        return result  # not an HF cache layout (host-volume, local dir, etc.)
    try:
        incomplete = list(blobs_dir.glob("*.incomplete"))
    except Exception as exc:
        _patched_check_model_weights_dir_logger = logging.getLogger(__name__)
        _patched_check_model_weights_dir_logger.warning(
            "check_model_weights_dir: cannot scan blobs dir %s: %s", blobs_dir, exc
        )
        return result
    if incomplete:
        logging.getLogger(__name__).warning(
            "check_model_weights_dir: %d incomplete blob(s) in %s — "
            "re-download required. Files: %s",
            len(incomplete), blobs_dir, [f.name for f in incomplete],
        )
        return False
    return True


_setup_host_module.HostSetupManager.check_model_weights_dir = _patched_check_model_weights_dir

# Set up logging
# DO NOT use basicConfig() - it interferes with file handlers
# Instead, configure logging manually
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)  # Set level on the logger itself
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")

# Configure FastAPI logger to also write to file
def setup_model_run_file_logging():
    """Set up file logging for FastAPI - writes to logs/model_run.log under TT Studio root"""
    try:
        # Put the log file under the consolidated logs/ directory:
        # <tt_studio_root>/logs/model_run.log
        tt_studio_root = Path(__file__).parent.parent.resolve()
        root_log_dir = tt_studio_root / "logs"
        root_log_dir.mkdir(parents=True, exist_ok=True)
        root_log_file = root_log_dir / "model_run.log"

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
            fallback_log = Path(__file__).parent / "model_run_setup_error.log"
            with open(fallback_log, "a") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - {error_msg}\n")
                f.write(traceback.format_exc())
        except Exception:
            pass  # If even fallback fails, just continue

# Initialize file logging
setup_model_run_file_logging()

# Global progress store with thread-safe access
progress_store: Dict[str, Dict[str, Any]] = {}
log_store: Dict[str, deque] = {}
progress_lock = threading.Lock()
_run_main_lock = threading.Lock()

# Store per-deployment log handlers for cleanup
deployment_log_handlers: Dict[str, logging.FileHandler] = {}

# Maximum number of log messages to keep per job
MAX_LOG_MESSAGES = 100
# Deployment timeout: 5 hours to allow for large model downloads
DEPLOYMENT_TIMEOUT_SECONDS = 5 * 60 * 60  # 5 hours
# Mark a job as stalled when no run.py log/progress update arrives for this long.
# Set to 10 minutes: long enough to ride out legitimate quiet gaps (HF shard
# verification, between-batch pauses, slow HEAD requests, transient probe
# failures) without false-flagging a healthy download, yet short enough to
# surface a genuinely dead download (e.g. lost DNS/network) within ~10 min
# instead of waiting out the 5-hour hard timeout.
PULL_STALL_THRESHOLD_SECONDS = 600

# Regex pattern for structured progress signals
PROG_RE = re.compile(r"TT_PROGRESS stage=(\w+) pct=(\d{1,3}) msg=(.*)$")

_DOCKER_RUN_NAME_RE = re.compile(r"--name\s+(?P<name>[^\s]+)")
_RUN_LOG_PATH_RE = re.compile(r"This log file is saved on local machine at:\s*(?P<path>\S+)")
_DOCKER_WORKFLOW_LOG_PATH_RE = re.compile(r"Running docker container with log file:\s*(?P<path>\S+)")

# Host-setup / weights download hints (from tt-inference-server logs).
# setup_host.py emits "Downloading model to host volume: {repo}" or
# "Downloading model to host HF cache: {repo}" right before invoking `hf download`.
_HF_DOWNLOAD_REPO_RE = re.compile(
    r"Downloading model (?:to host (?:volume|HF cache)|from Hugging Face):\s*(?P<repo>[^\s]+)"
)
# setup_host.py:388 emits "✅ HF_HOME set to {path}" (no "HOST_" prefix).
_HOST_HF_HOME_RE = re.compile(r"HF_HOME set to\s*(?P<path>\S+)")
_HOST_VOLUME_WEIGHTS_MISSING_RE = re.compile(r"Weights directory does not exist for\s*(?P<model>.+?)\.")
# setup_host.py:582 emits "Weights already exist in host volume, skipping download" on cache hit.
_HF_CACHED_RE = re.compile(r"Weights already exist in host volume")
_PREFERRED_HOST_VOLUME_PATH = Path("~/data/tt-cache")
_HOST_VOLUME_MODELS_CONFIG_PATH = Path(__file__).with_name("host_volume_models.json")
_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST = {"qwen3-32b"}
_DEFAULT_HOST_VOLUME_DIRECTORY_OVERRIDES = {
    "qwen3-32b": "volume_id_tt_transformers-Qwen3-32B-vqb2_launch"
}
_HF_CACHE_MODELS_CONFIG_PATH = Path(__file__).with_name("hf_cache_models.json")
_DEFAULT_HF_CACHE_MODEL_ALLOWLIST = {
    "mochi-1-preview",
    "wan2.2-t2v-a14b-diffusers",
    "wan2.2-i2v-a14b-diffusers",
    "flux.1-dev",
    "flux.1-schnell",
    "motif-image-6b-preview",
    "stable-diffusion-3.5-large",
    "stable-diffusion-xl-1.0-inpainting-0.1",
    "stable-diffusion-xl-base-1.0",
    "stable-diffusion-xl-base-1.0-img-2-img",
    "qwen-image",
    "qwen-image-2512",
}


def _load_host_volume_model_config() -> Tuple[set[str], Dict[str, str]]:
    try:
        raw_config = json.loads(_HOST_VOLUME_MODELS_CONFIG_PATH.read_text())
    except FileNotFoundError:
        logging.getLogger(__name__).warning(
            "Host-volume models config not found at %s; using default allowlist %s",
            _HOST_VOLUME_MODELS_CONFIG_PATH,
            sorted(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
        )
        return (
            set(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
            dict(_DEFAULT_HOST_VOLUME_DIRECTORY_OVERRIDES),
        )
    except json.JSONDecodeError as exc:
        logging.getLogger(__name__).warning(
            "Host-volume models config at %s is invalid JSON (%s); using default allowlist %s",
            _HOST_VOLUME_MODELS_CONFIG_PATH,
            exc,
            sorted(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
        )
        return (
            set(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
            dict(_DEFAULT_HOST_VOLUME_DIRECTORY_OVERRIDES),
        )

    configured_models = raw_config.get("models")
    if not isinstance(configured_models, list):
        logging.getLogger(__name__).warning(
            "Host-volume models config at %s is missing a 'models' list; using default allowlist %s",
            _HOST_VOLUME_MODELS_CONFIG_PATH,
            sorted(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
        )
        return (
            set(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
            dict(_DEFAULT_HOST_VOLUME_DIRECTORY_OVERRIDES),
        )

    normalized_models = {
        str(model_name).strip().lower()
        for model_name in configured_models
        if str(model_name).strip()
    }
    if not normalized_models:
        logging.getLogger(__name__).warning(
            "Host-volume models config at %s did not contain any usable model names; using default allowlist %s",
            _HOST_VOLUME_MODELS_CONFIG_PATH,
            sorted(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
        )
        return (
            set(_DEFAULT_HOST_VOLUME_MODEL_ALLOWLIST),
            dict(_DEFAULT_HOST_VOLUME_DIRECTORY_OVERRIDES),
        )

    directory_overrides = dict(_DEFAULT_HOST_VOLUME_DIRECTORY_OVERRIDES)
    raw_overrides = raw_config.get("directory_overrides", {})
    if isinstance(raw_overrides, dict):
        for model_name, directory_name in raw_overrides.items():
            normalized_model_name = str(model_name).strip().lower()
            normalized_directory_name = str(directory_name).strip()
            if normalized_model_name and normalized_directory_name:
                directory_overrides[normalized_model_name] = normalized_directory_name

    logging.getLogger(__name__).info(
        "Loaded host-volume model allowlist from %s: %s",
        _HOST_VOLUME_MODELS_CONFIG_PATH,
        sorted(normalized_models),
    )
    logging.getLogger(__name__).info(
        "Loaded host-volume directory overrides from %s: %s",
        _HOST_VOLUME_MODELS_CONFIG_PATH,
        directory_overrides,
    )
    return normalized_models, directory_overrides


_HOST_VOLUME_MODEL_ALLOWLIST, _HOST_VOLUME_DIRECTORY_OVERRIDES = (
    _load_host_volume_model_config()
)


def _load_hf_cache_model_config() -> set[str]:
    try:
        raw_config = json.loads(_HF_CACHE_MODELS_CONFIG_PATH.read_text())
    except FileNotFoundError:
        logging.getLogger(__name__).warning(
            "HF-cache models config not found at %s; using default allowlist %s",
            _HF_CACHE_MODELS_CONFIG_PATH,
            sorted(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST),
        )
        return set(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST)
    except json.JSONDecodeError as exc:
        logging.getLogger(__name__).warning(
            "HF-cache models config at %s is invalid JSON (%s); using default allowlist %s",
            _HF_CACHE_MODELS_CONFIG_PATH,
            exc,
            sorted(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST),
        )
        return set(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST)

    configured_models = raw_config.get("models")
    if not isinstance(configured_models, list):
        logging.getLogger(__name__).warning(
            "HF-cache models config at %s is missing a 'models' list; using default allowlist %s",
            _HF_CACHE_MODELS_CONFIG_PATH,
            sorted(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST),
        )
        return set(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST)

    normalized_models = {
        str(model_name).strip().lower()
        for model_name in configured_models
        if str(model_name).strip()
    }
    if not normalized_models:
        logging.getLogger(__name__).warning(
            "HF-cache models config at %s did not contain any usable model names; using default allowlist %s",
            _HF_CACHE_MODELS_CONFIG_PATH,
            sorted(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST),
        )
        return set(_DEFAULT_HF_CACHE_MODEL_ALLOWLIST)

    logging.getLogger(__name__).info(
        "Loaded HF-cache model allowlist from %s: %s",
        _HF_CACHE_MODELS_CONFIG_PATH,
        sorted(normalized_models),
    )
    return normalized_models


_HF_CACHE_MODEL_ALLOWLIST = _load_hf_cache_model_config()


def _resolve_preferred_host_volume(
    model_name: str, device: str, impl: Optional[str]
) -> Tuple[Optional[str], Optional[Path], Optional[Path], Optional[Path], str]:
    """Resolve the preferred host-volume root for preloaded Qwen data."""
    candidate_root = _PREFERRED_HOST_VOLUME_PATH.expanduser()
    resolved_candidate_root = candidate_root.resolve(strict=False)

    try:
        model_spec, _, _ = get_runtime_model_spec(model_name, device, impl=impl)
    except Exception as exc:
        return (
            None,
            None,
            None,
            None,
            f"could not derive expected host-volume directory for {model_name} on {device}: {exc}",
        )

    normalized_model_name = (model_name or "").strip().lower()
    directory_override = _HOST_VOLUME_DIRECTORY_OVERRIDES.get(normalized_model_name)
    if directory_override:
        expected_volume_dir = resolved_candidate_root / directory_override
    else:
        expected_volume_dir = (
            resolved_candidate_root
            / f"volume_id_{model_spec.impl.impl_id}-{model_spec.model_name}-v{model_spec.version}"
        )
    expected_weights_dir = expected_volume_dir / "weights" / model_spec.model_name
    expected_tt_metal_cache_dir = expected_volume_dir / "tt_metal_cache"

    if candidate_root.exists() and not candidate_root.is_dir():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"preferred host-volume root {resolved_candidate_root} is not a directory",
        )
    if not expected_volume_dir.exists():
        # Fall back to scanning for any volume dir that matches the model name under the
        # candidate root — handles cases where the directory was prepared with a different
        # version/branch suffix (e.g. v0.10.1 instead of vqb2_launch).
        fallback_volume_dir = None
        if resolved_candidate_root.is_dir():
            model_name_lower = model_spec.model_name.lower()
            for candidate in sorted(resolved_candidate_root.iterdir()):
                if not candidate.is_dir():
                    continue
                cname = candidate.name.lower()
                if model_name_lower in cname and "volume_id_" in cname:
                    candidate_weights = candidate / "weights" / model_spec.model_name
                    candidate_cache = candidate / "tt_metal_cache"
                    if candidate_weights.is_dir() and candidate_cache.is_dir():
                        fallback_volume_dir = candidate
                        break
        if fallback_volume_dir is None:
            return (
                None,
                expected_volume_dir,
                expected_weights_dir,
                expected_tt_metal_cache_dir,
                f"expected preloaded host-volume directory is missing: {expected_volume_dir}",
            )
        logging.getLogger(__name__).warning(
            "Expected host-volume dir %s not found; using fuzzy-matched fallback %s",
            expected_volume_dir,
            fallback_volume_dir,
        )
        expected_volume_dir = fallback_volume_dir
        expected_weights_dir = expected_volume_dir / "weights" / model_spec.model_name
        expected_tt_metal_cache_dir = expected_volume_dir / "tt_metal_cache"
    if not expected_volume_dir.is_dir():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected preloaded host-volume path is not a directory: {expected_volume_dir}",
        )
    if not expected_weights_dir.exists():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected preloaded weights directory is missing: {expected_weights_dir}",
        )
    if not expected_weights_dir.is_dir():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected preloaded weights path is not a directory: {expected_weights_dir}",
        )
    if not expected_tt_metal_cache_dir.exists():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected tt_metal_cache directory is missing: {expected_tt_metal_cache_dir}",
        )
    if not expected_tt_metal_cache_dir.is_dir():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected tt_metal_cache path is not a directory: {expected_tt_metal_cache_dir}",
        )
    if not (expected_weights_dir / "config.json").exists():
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected config.json is missing from preloaded weights directory: {expected_weights_dir}",
        )
    if not (
        (expected_weights_dir / "tokenizer.json").exists()
        or (expected_weights_dir / "tokenizer_config.json").exists()
    ):
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected tokenizer.json or tokenizer_config.json is missing from preloaded weights directory: {expected_weights_dir}",
        )
    if not list(expected_weights_dir.glob("model*.safetensors")):
        return (
            None,
            expected_volume_dir,
            expected_weights_dir,
            expected_tt_metal_cache_dir,
            f"expected model*.safetensors files are missing from preloaded weights directory: {expected_weights_dir}",
        )

    return (
        str(resolved_candidate_root),
        expected_volume_dir,
        expected_weights_dir,
        expected_tt_metal_cache_dir,
        f"accepted expected preloaded host-volume layout: volume_dir={expected_volume_dir}, weights_dir={expected_weights_dir}, tt_metal_cache_dir={expected_tt_metal_cache_dir}",
    )


def _model_uses_preferred_host_volume(model_name: str) -> bool:
    return (model_name or "").strip().lower() in _HOST_VOLUME_MODEL_ALLOWLIST


def _model_uses_host_hf_cache(model_name: str) -> bool:
    return (model_name or "").strip().lower() in _HF_CACHE_MODEL_ALLOWLIST


# ─── TEMP (QB2 workaround) — remove this fn + its call in the deploy path ──────
def _stage_preloaded_version_symlink(model, device, impl, override_dir, root, job_id):
    """Link volume_id_<impl>-<model>-v{model_spec.version} -> the preloaded
    -vqb2_launch override dir, so `--host-volume <root>` reuse lands on the
    preloaded data instead of re-downloading.

    The version is resolved with the SAME get_runtime_model_spec(model, device,
    impl) that run.py/setup_host use, so the symlink name matches what setup_host
    requests for any model/impl/device (the dir version is the per-model
    catalog-pinned model_spec.version, not the repo VERSION). Excise this fn +
    its call when the preloaded data is re-staged under the release name.
    """
    if not override_dir:
        return
    try:
        ms, _, _ = get_runtime_model_spec(model, device, impl=impl)
        target = Path(root) / f"volume_id_{ms.impl.impl_id}-{ms.model_name}-v{ms.version}"
        if target.exists() or target.is_symlink():  # never clobber; idempotent
            return
        os.symlink(Path(override_dir).resolve(), target)  # resolve() avoids symlink-to-symlink
        logger.info("Job %s: linked %s -> %s", job_id, target.name, Path(override_dir).name)
    except Exception as exc:
        logger.warning("Job %s: could not stage preloaded host-volume symlink: %s", job_id, exc)
# ─── end TEMP (QB2 workaround) ────────────────────────────────────────────────


def _strip_cli_option(argv: list[str], option: str) -> list[str]:
    """Return argv without a single `--option value` pair."""
    stripped_argv: list[str] = []
    idx = 0
    while idx < len(argv):
        if argv[idx] == option:
            idx += 2
            continue
        stripped_argv.append(argv[idx])
        idx += 1
    return stripped_argv


def _job_has_host_volume_weights_warning(job_id: str) -> bool:
    with progress_lock:
        entries = list(log_store.get(job_id, []))
    return any(
        _HOST_VOLUME_WEIGHTS_MISSING_RE.search(entry.get("message", ""))
        for entry in entries
    )


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


def _job_logs_contain(job_id: str, pattern: re.Pattern) -> bool:
    """True if any captured run.py log message for this job matches `pattern`."""
    with progress_lock:
        entries = list(log_store.get(job_id, []))
    for e in entries:
        if pattern.search(str(e.get("message", ""))):
            return True
    return False


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


def _dir_size_bytes_recursive(path: Path) -> int:
    """Recursive size sum (walks subdirs). Used for `hf download --local-dir` layouts."""
    try:
        if not path.exists() or not path.is_dir():
            return 0
        total = 0
        for root, _dirs, files in os.walk(path, followlinks=False):
            for fname in files:
                fp = os.path.join(root, fname)
                try:
                    total += os.stat(fp, follow_symlinks=False).st_size
                except FileNotFoundError:
                    continue
        return total
    except Exception:
        return 0


@dataclass
class WeightsLocation:
    """Where the weights-progress monitor should read downloaded bytes from.

    read_mode:
      - "host_fs": scan host_path directly (host bind-mount layout).
      - "docker_volume": exec `du -sb` inside an ephemeral container against
        a named Docker volume (the named-volume default path the user can't
        read directly because /var/lib/docker/volumes/ is root-only).
      - "hf_cache": legacy HF-hub layout under host_path/hub/models--<repo>/.
    """
    read_mode: str
    host_path: Optional[Path] = None
    volume_name: Optional[str] = None
    volume_subpath: Optional[str] = None  # path inside the mounted volume to scan


def _resolve_weights_location(
    model_name: str, device: str, impl: Optional[str]
) -> Optional[WeightsLocation]:
    """Pick the right read strategy for this deployment.

    The host-volume allowlist (currently just qwen3-32b) uses a host-readable
    bind mount. Everything else lands in a Docker named volume named
    `volume_id_{impl_id}-{model_name}` per generate_docker_volume_name() in
    tt-inference-server/workflows/run_docker_server.py.
    """
    # Host-volume allowlist path: weights live at a bind-mount we can read.
    if _model_uses_preferred_host_volume(model_name):
        (
            preferred_host_volume,
            _expected_volume_dir,
            expected_weights_dir,
            _expected_tt_metal_cache_dir,
            _reason,
        ) = _resolve_preferred_host_volume(model_name, device, impl)
        if preferred_host_volume and expected_weights_dir:
            return WeightsLocation(
                read_mode="host_fs",
                host_path=expected_weights_dir,
            )

    # Default path: Docker named volume.
    try:
        model_spec, _, _ = get_runtime_model_spec(model_name, device, impl=impl)
    except Exception as exc:
        logger.warning(
            "weights-monitor: could not resolve model spec for %s/%s/%s: %s",
            model_name, device, impl, exc,
        )
        return None
    volume_name = f"volume_id_{model_spec.impl.impl_id}-{model_spec.model_name}"
    # setup_host.setup_weights_huggingface writes to {host_model_volume_root}/weights/{model_name}/
    return WeightsLocation(
        read_mode="docker_volume",
        volume_name=volume_name,
        volume_subpath=f"weights/{model_spec.model_name}",
    )


_DU_HELPER_IMAGE = "alpine:3"


def _du_bytes_in_volume(volume_name: str, subpath: str) -> int:
    """Return recursive byte count of `subpath` inside a Docker named volume.

    Uses an ephemeral alpine container so the FastAPI process doesn't need
    root access to /var/lib/docker/volumes/. Returns 0 on any error (e.g.
    volume not yet populated, daemon hiccup) so the monitor keeps polling.
    """
    if not volume_name or not subpath:
        return 0
    safe_target = "/v/" + subpath.lstrip("/")
    cmd = ["sh", "-c", f"du -sb {shlex.quote(safe_target)} 2>/dev/null | cut -f1"]
    try:
        client = docker.from_env()
        out = client.containers.run(
            image=_DU_HELPER_IMAGE,
            command=cmd,
            volumes={volume_name: {"bind": "/v", "mode": "ro"}},
            remove=True,
            detach=False,
            network_disabled=True,
            stdout=True,
            stderr=False,
        )
        if isinstance(out, bytes):
            text = out.decode("utf-8", errors="ignore").strip()
        else:
            text = str(out).strip()
        if not text:
            return 0
        # `du` may emit multiple lines if the target is missing; take the first integer.
        first = text.splitlines()[0].strip()
        return int(first) if first.isdigit() else 0
    except docker.errors.ImageNotFound:
        logger.debug("weights-monitor: %s missing; will be pulled at startup", _DU_HELPER_IMAGE)
        return 0
    except Exception as exc:
        logger.debug("weights-monitor: du in volume %s failed: %s", volume_name, exc)
        return 0


def _downloaded_bytes_for_location(
    hf_home: Optional[Path], repo_id: Optional[str], location: Optional[WeightsLocation]
) -> int:
    """Dispatch to the right reader for the resolved weights location.

    Falls back to the legacy HF-hub cache layout if no WeightsLocation was
    resolved (best-effort for unusual deployments that set HF_HOME via logs).
    """
    if location is not None:
        if location.read_mode == "host_fs" and location.host_path:
            return _dir_size_bytes_recursive(location.host_path)
        if location.read_mode == "docker_volume" and location.volume_name and location.volume_subpath:
            return _du_bytes_in_volume(location.volume_name, location.volume_subpath)
    # Legacy fallback (hf_home discovered via log scrape).
    if hf_home is not None and repo_id:
        return _get_downloaded_bytes_from_hf_cache(hf_home, repo_id)
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


def _fetch_hf_total_bytes(repo_id: str, hf_token: str) -> Optional[int]:
    """Fetch total expected bytes from Hugging Face repo tree (best-effort).

    The tree endpoint returns `{type, path, size, oid, lfs?}` per entry. For LFS
    files we prefer `lfs.size` (always the resolved blob size); historic API
    responses returned the LFS pointer size at the top-level `size` field.
    """
    if not repo_id or "/" not in repo_id:
        return None
    url = f"https://huggingface.co/api/models/{repo_id}/tree/main?recursive=true"
    headers = {"User-Agent": "tt-studio/weights-progress"}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        entries = json.loads(data.decode("utf-8"))
        if not isinstance(entries, list):
            return None
        total = 0
        for entry in entries:
            try:
                if entry.get("type") != "file":
                    continue
                lfs = entry.get("lfs")
                size: Optional[int] = None
                if isinstance(lfs, dict):
                    lfs_size = lfs.get("size")
                    if isinstance(lfs_size, int) and lfs_size > 0:
                        size = lfs_size
                if size is None:
                    top_size = entry.get("size")
                    if isinstance(top_size, int) and top_size > 0:
                        size = top_size
                if size is not None:
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


def _weights_progress_monitor(
    job_id: str,
    stop_event: threading.Event,
    model_name: Optional[str] = None,
    device: Optional[str] = None,
    impl: Optional[str] = None,
) -> None:
    """Background monitor: converts download progress into % + ETA and updates progress_store.

    This is designed to cover long-running `hf download <repo>` operations where tt-inference-server
    does not emit structured per-file progress events.

    Path resolution: when model_name/device are provided, we derive the exact
    Docker named volume (or host bind-mount path) the deployment writes to.
    Otherwise we fall back to log-scraped HF_HOME (legacy path).
    """
    last_bytes = 0
    last_t = time.time()
    ema_speed_bps: Optional[float] = None
    stable_speed_bps: Optional[float] = None
    stagnant_polls = 0
    MAX_STAGNANT_POLLS = 15  # 15s grace period
    MIN_SPEED_BPS = 64 * 1024  # Ignore tiny fluctuations under 64KB/s
    repo_id: Optional[str] = None
    hf_home: Optional[Path] = None
    total_bytes: Optional[int] = None
    total_bytes_attempted = False
    cached_announced_at: Optional[float] = None
    CACHED_LINGER_SECONDS = 1.8

    weights_location: Optional[WeightsLocation] = None
    if model_name and device:
        weights_location = _resolve_weights_location(model_name, device, impl)
        if weights_location:
            logger.info(
                "Job %s: weights-monitor resolved location: %s",
                job_id, weights_location,
            )

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

        # Cache-hit short-circuit: setup_host logs "Weights already exist in host volume..."
        # when nothing needs to be downloaded. Show a brief "cached" state then exit.
        if cached_announced_at is None and _job_logs_contain(job_id, _HF_CACHED_RE):
            cached_announced_at = time.time()
            with progress_lock:
                cur = progress_store.get(job_id)
                if cur and cur.get("stage") not in {"container_setup", "finalizing", "complete"}:
                    progress_val = max(cur.get("progress", 0) or 0, 39)
                    cur.update({
                        "status": "running",
                        "stage": "model_preparation",
                        "progress": progress_val,
                        "message": "Weights already cached — skipping download",
                        "downloaded_bytes": total_bytes,
                        "total_bytes": total_bytes,
                        "speed_bps": None,
                        "eta_seconds": 0,
                        "last_updated": time.time(),
                    })
        if cached_announced_at is not None and (time.time() - cached_announced_at) >= CACHED_LINGER_SECONDS:
            return

        if repo_id:
            if not total_bytes_attempted:
                total_bytes_attempted = True
                total_bytes = _fetch_hf_total_bytes(repo_id, os.getenv("HF_TOKEN") or "")
            downloaded = _downloaded_bytes_for_location(hf_home, repo_id, weights_location)
            now = time.time()
            dt = max(1e-3, now - last_t)
            delta = downloaded - last_bytes
           
            if delta > MIN_SPEED_BPS:
                stagnant_polls = 0

                inst_speed = delta / dt

                # Faster convergence early, slower later
                alpha = 0.35 if ema_speed_bps is None else 0.15

                if ema_speed_bps is None:
                    ema_speed_bps = inst_speed
                else:
                    ema_speed_bps = alpha * inst_speed + (1 - alpha) * ema_speed_bps

                stable_speed_bps = ema_speed_bps

                last_bytes = downloaded
                last_t = now
            else:
                stagnant_polls += 1

                # Hold previous speed briefly during shard verification/unpacking
                if stagnant_polls < MAX_STAGNANT_POLLS:
                    ema_speed_bps = stable_speed_bps
                else:
                    # Slowly decay speed instead of hard-dropping
                    if ema_speed_bps is not None:
                        ema_speed_bps *= 0.92

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
                    
                    if total_bytes and downloaded >= total_bytes:
                        msg = "Finalizing model weights and cache..."
                        eta_seconds = None
                    else:
                        msg = f"Downloading weights: {_format_bytes(downloaded)} / {_format_bytes(total_bytes) if total_bytes else '?'} • {speed_txt}"

                    eta_seconds: Optional[float] = None
                    if (
                        total_bytes is not None
                        and ema_speed_bps is not None
                        and ema_speed_bps > 0
                        and total_bytes > downloaded
                    ):
                        raw_eta = (total_bytes - downloaded) / ema_speed_bps
                        # Clamp unrealistic spikes/jitter
                        if eta_seconds is None:
                            eta_seconds = raw_eta
                        else:
                            eta_seconds = (0.7 * eta_seconds) + (0.3 * raw_eta)

                    cur.update(
                        {
                            "status": "running",
                            "stage": "model_preparation",
                            "progress": progress_val,
                            "message": msg[:200],
                            "last_updated": time.time(),
                            "weights_repo": repo_id,
                            "downloaded_bytes": int(downloaded),
                            "total_bytes": int(total_bytes) if total_bytes is not None else None,
                            "speed_bps": float(ema_speed_bps) if ema_speed_bps is not None else None,
                            "eta_seconds": float(eta_seconds) if eta_seconds is not None else None,
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
        # Record the thread that spawned this handler so we only capture
        # log records emitted by that thread.  Multiple concurrent jobs share
        # the same 'run_log' logger; without this filter every handler would
        # receive every other job's messages and _extract_from_job_logs()
        # would pick up the wrong container name.
        self._owner_thread = threading.current_thread().ident
        # Per-layer counters for docker pull so the bar/message advances
        # instead of sitting at a flat 50% during multi-GB image downloads.
        self._pull_layers_total = 0
        self._pull_layers_complete = 0

        # Initialize log store for this job
        with progress_lock:
            if job_id not in log_store:
                log_store[job_id] = deque(maxlen=MAX_LOG_MESSAGES)
        
    def emit(self, record):
        # Ignore records from other job threads to prevent cross-contamination
        # of log stores when multiple models are deployed concurrently.
        if record.thread != self._owner_thread:
            return
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
        
            # Based on the model_run.log patterns, parse deployment stages
            if any(keyword in message.lower() for keyword in ["validate_runtime_args", "handle_secrets", "validate_local_setup"]):
                stage = "initialization"
                progress = 5
            elif any(keyword in message.lower() for keyword in ["setup_host", "setting up python venv", "loaded environment"]):
                stage = "setup"
                progress = 15
            elif "setup already completed" in message.lower():
                stage = "setup"
                progress = 16
                message = "Environment ready..."
            elif any(keyword in message.lower() for keyword in ["downloading model", "huggingface-cli download"]):
                stage = "model_preparation"
                progress = 28
            # HF metadata/config file fetch (e.g. "Fetching 15 files:  47%|...")
            elif "fetching" in message.lower() and "files" in message.lower():
                stage = "model_preparation"
                progress = 20
                message = "Downloading model configuration files..."
            # Docker image layer pull (e.g. "abc123: Download complete", "Pulling from ...")
            elif any(keyword in message.lower() for keyword in [
                "pulling from",
                ": pulling fs layer",
                ": download complete",
                ": verifying checksum",
                ": pull complete",
                ": already exists",
            ]):
                stage = "container_setup"
                msg_l = message.lower()
                if ": pulling fs layer" in msg_l:
                    self._pull_layers_total += 1
                elif ": pull complete" in msg_l or ": already exists" in msg_l:
                    self._pull_layers_complete += 1
                if self._pull_layers_total > 0:
                    ratio = min(1.0, self._pull_layers_complete / self._pull_layers_total)
                    progress = 20 + int(ratio * 12)  # ramp 20 -> 32 during pull
                    message = (
                        f"Pulling container image layers "
                        f"({self._pull_layers_complete}/{self._pull_layers_total})..."
                    )
                else:
                    progress = 20
                    message = "Pulling container image layers..."
            elif any(keyword in message.lower() for keyword in ["docker image pulled successfully", "docker image available locally"]):
                stage = "image_ready"
                progress = 34
                message = "Container image ready."
            elif any(keyword in message.lower() for keyword in ["docker run command", "running docker container"]):
                stage = "container_setup"
                progress = 42
                message = "Creating and starting the container..."
            elif "created docker container id" in message.lower():
                stage = "container_started"
                progress = 60
                message = "Container is running..."
            elif any(keyword in message.lower() for keyword in ["searching for container", "looking for container"]):
                stage = "container_started"
                progress = 64
                message = "Locating the container..."
            elif any(keyword in message.lower() for keyword in ["connected container", "tt_studio_network"]):
                stage = "network_setup"
                progress = 84
                message = "Connecting to the network..."
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
                            update_payload = {
                                "status": status,
                                "stage": stage,
                                "progress": progress,
                                "message": message[:200],
                                "last_updated": time.time()
                            }
                            if self._pull_layers_total > 0:
                                update_payload["pull_layers_complete"] = self._pull_layers_complete
                                update_payload["pull_layers_total"] = self._pull_layers_total
                            progress_store[self.job_id].update(update_payload)
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


@app.on_event("startup")
def _prepull_weights_monitor_helper_image() -> None:
    """Pre-pull the alpine helper image used by _du_bytes_in_volume.

    Doing this once at boot avoids a multi-second stall on the first poll of
    the first deployment after a fresh install. Failures are non-fatal —
    the helper itself retries on each call.
    """
    try:
        client = docker.from_env()
        try:
            client.images.get(_DU_HELPER_IMAGE)
            logger.info("weights-monitor helper image already present: %s", _DU_HELPER_IMAGE)
            return
        except docker.errors.ImageNotFound:
            pass
        logger.info("weights-monitor: pulling helper image %s", _DU_HELPER_IMAGE)
        client.images.pull(_DU_HELPER_IMAGE)
        logger.info("weights-monitor: helper image ready")
    except Exception as exc:
        logger.warning(
            "weights-monitor: could not pre-pull %s (%s); the monitor will retry per poll.",
            _DU_HELPER_IMAGE, exc,
        )

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

def get_model_run_logs_dir():
    """Get the per-deployment model run logs directory under TT Studio root's logs/"""
    tt_studio_root = Path(__file__).parent.parent.resolve()
    model_run_logs_dir = tt_studio_root / "logs" / "model_run_logs"
    model_run_logs_dir.mkdir(parents=True, exist_ok=True)
    return model_run_logs_dir

def create_deployment_log_handler(job_id: str, model: str, device: str):
    """Create a per-deployment log file handler with model and device in filename"""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    model_run_logs_dir = get_model_run_logs_dir()

    # Create log file with pattern: model_run_YYYY-MM-DD_HH-MM-SS_ModelName_device_server.log
    log_filename = f"model_run_{timestamp}_{model}_{device}_server.log"
    log_file_path = model_run_logs_dir / log_filename
    
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

class _RunLogForwarder(logging.Handler):
    """Module-level singleton handler that forwards run_log records to the
    FastAPI logger.  Defined at module scope so isinstance() checks work
    correctly across calls and only one instance is ever installed."""

    def emit(self, record):
        logger.info(f"[RUN.PY] {record.getMessage()}")


_run_log_forwarder_installed: bool = False


def setup_run_logging_to_fastapi():
    """Install the run_log → FastAPI forwarder exactly once per process.

    Previous implementation defined FastAPIHandler inside the function body,
    which gave every call a *new* class object.  The isinstance-based dedup
    check therefore never matched, so a fresh handler was appended for every
    concurrent job — causing log lines to be emitted N times after N jobs.
    Using a module-level class fixes isinstance() and the global flag prevents
    any double-installation race.
    """
    global _run_log_forwarder_installed
    if _run_log_forwarder_installed:
        return
    run_logger = logging.getLogger("run_log")
    # Guard against duplicate installation even if the flag races
    if not any(isinstance(h, _RunLogForwarder) for h in run_logger.handlers):
        handler = _RunLogForwarder()
        handler.setLevel(logging.DEBUG)
        run_logger.addHandler(handler)
        logger.info("Added FastAPI logging handler to run_log logger")
    _run_log_forwarder_installed = True

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
        "check": "model_run.log file for log messages",
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
        
        # Add stalled detection (no progress for PULL_STALL_THRESHOLD_SECONDS)
        if progress["status"] == "running" and "last_updated" in progress:
            time_since_update = time.time() - progress["last_updated"]
            if time_since_update > PULL_STALL_THRESHOLD_SECONDS:
                progress = progress.copy()  # Don't modify the stored version
                progress["status"] = "stalled"
                progress["message"] = f"No progress updates for {int(time_since_update)}s - deployment may be stalled"
                progress["stale_seconds"] = int(time_since_update)
                
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
    tt_studio_env = Path(tt_studio_root) / ".env"

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
            "SERVICE_PORT": request.service_port or "7000",  # Use requested port (per-slot)
            "HF_HUB_DISABLE_XET": "1",  # force synchronous HTTPS download; XET exits 0 before blobs finish
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
            
        # Convert the request to command line arguments
        base_argv = ["run.py"]
        
        # Add required arguments
        base_argv.extend(["--model", request.model])
        base_argv.extend(["--workflow", request.workflow])
        base_argv.extend(["--device", normalized_device])
        base_argv.extend(["--docker-server"])
         # Add dev-mode if requested (used for auto-retry on failure)
        if request.dev_mode:
            base_argv.extend(["--dev-mode"])
        # Skip system software validation if requested (handles prerelease versions like '2.6.0-rc1')
        if request.skip_system_sw_validation:
            base_argv.extend(["--skip-system-sw-validation"])
        base_argv.extend(["--service-port", request.service_port or "7000"])
        
        # Add optional arguments if they are set
        if request.impl:
            base_argv.extend(["--impl", request.impl])
        if request.local_server:
            base_argv.append("--local-server")
        if request.interactive:
            base_argv.append("--interactive")
        if request.workflow_args:
            base_argv.extend(["--workflow-args", request.workflow_args])
        if request.disable_trace_capture:
            base_argv.append("--disable-trace-capture")
        if request.override_docker_image:
            base_argv.extend(["--override-docker-image", request.override_docker_image])
        if request.device_id:
            base_argv.extend(["--device-id", request.device_id])
        if request.override_tt_config:
            base_argv.extend(["--override-tt-config", request.override_tt_config])
        if request.vllm_override_args:
            base_argv.extend(["--vllm-override-args", request.vllm_override_args])

        preferred_host_volume = None
        expected_host_volume_dir: Optional[Path] = None
        expected_host_weights_dir: Optional[Path] = None
        expected_host_tt_metal_cache_dir: Optional[Path] = None
        host_volume_resolution_reason = "model not in host-volume allowlist"
        if _model_uses_preferred_host_volume(request.model):
            (
                preferred_host_volume,
                expected_host_volume_dir,
                expected_host_weights_dir,
                expected_host_tt_metal_cache_dir,
                host_volume_resolution_reason,
            ) = _resolve_preferred_host_volume(
                request.model, normalized_device, request.impl
            )
        initial_argv = list(base_argv)
        if expected_host_volume_dir is not None:
            logger.info(
                "Job %s: checking Qwen preloaded host-volume layout: volume_dir=%s, weights_dir=%s, tt_metal_cache_dir=%s",
                job_id,
                expected_host_volume_dir,
                expected_host_weights_dir,
                expected_host_tt_metal_cache_dir,
            )
        if preferred_host_volume:
            initial_argv.extend(["--host-volume", preferred_host_volume])
            # ─── TEMP (QB2 workaround) — remove with _stage_preloaded_version_symlink ──
            _stage_preloaded_version_symlink(
                request.model,
                normalized_device,
                request.impl,
                expected_host_volume_dir,
                preferred_host_volume,
                job_id,
            )
            # ─── end TEMP (QB2 workaround) ────────────────────────────────────────────
            logger.info(
                "Job %s: Qwen preloaded host-volume directory accepted: %s; using --host-volume %s (%s)",
                job_id,
                expected_host_volume_dir,
                preferred_host_volume,
                host_volume_resolution_reason,
            )
        else:
            logger.info(
                "Job %s: using baseline startup without host-volume (%s)",
                job_id,
                host_volume_resolution_reason,
            )
        # Media (DiT) models reuse the host's already-downloaded HF weights via
        # --host-hf-cache. This is mutually exclusive with the Qwen --host-volume
        # path: Qwen uses host-volume, media uses hf-cache; they shouldn't combine.
        if _model_uses_host_hf_cache(request.model) and "--host-volume" not in initial_argv:
            host_hf_cache_path = str(_default_hf_home())
            # Ensure the HF cache dir exists. tt-inference-server's
            # validate_bind_mount_permissions() ValueErrors on a non-existent
            # --host-hf-cache path, which forces a baseline (in-container XET)
            # fallback that stalls on large media weights. setup_host() will
            # populate this dir via `hf download` once the mount validates.
            try:
                Path(host_hf_cache_path).mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                logger.warning(
                    "Job %s: could not create HF cache dir %s (%s); "
                    "deploy may fall back to baseline startup",
                    job_id,
                    host_hf_cache_path,
                    exc,
                )
            initial_argv.extend(["--host-hf-cache", host_hf_cache_path])
            logger.info(
                "Job %s: media model %s accepted for HF-cache reuse; using --host-hf-cache %s",
                job_id,
                request.model,
                host_hf_cache_path,
            )
        else:
            if not _model_uses_host_hf_cache(request.model):
                host_hf_cache_skip_reason = "model not in HF-cache allowlist"
            else:
                host_hf_cache_skip_reason = "--host-volume already selected"
            logger.info(
                "Job %s: using baseline startup without host-hf-cache (%s)",
                job_id,
                host_hf_cache_skip_reason,
            )
        def _run_job_in_background():
            weights_stop_event = threading.Event()
            progress_handler = None
            run_logger = logging.getLogger("run_log")
            try:
                # Start weights progress monitor (keeps progress moving during long hf downloads)
                threading.Thread(
                    target=_weights_progress_monitor,
                    args=(job_id, weights_stop_event, request.model, normalized_device, request.impl),
                    daemon=True,
                ).start()

                # Forward run.py logs and parse TT_PROGRESS
                setup_run_logging_to_fastapi()
                progress_handler = ProgressHandler(job_id)
                run_logger.addHandler(progress_handler)

                # run_main() relies on process globals (sys.argv, os.environ, cwd), so
                # serialize this setup/execution phase across concurrent /run requests.
                with _run_main_lock:
                    prev_argv = list(sys.argv)
                    prev_cwd = Path.cwd()
                    prev_env = os.environ.copy()
                    try:
                        # Apply env vars (including secrets if provided)
                        for key, value in env_vars_to_set.items():
                            if key in ["JWT_SECRET", "HF_TOKEN"]:
                                logger.info(f"Setting environment variable: {key}=[REDACTED]")
                            else:
                                logger.info(f"Setting environment variable: {key}={value}")
                            os.environ[key] = value

                        # Switch cwd for tt-inference-server execution
                        if prev_cwd != script_dir:
                            os.chdir(script_dir)

                        sys.argv = list(initial_argv)

                        def _execute_run(argv_for_attempt: list[str]) -> Tuple[int, Optional[Dict[str, Any]]]:
                            """Execute run_main() for one attempt and return (code, container_info)."""
                            attempt_mode = "host-volume" if "--host-volume" in argv_for_attempt else "baseline"
                            sys.argv = argv_for_attempt
                            logger.info(
                                f"Job {job_id}: run.py command: python {' '.join(argv_for_attempt)}"
                            )
                            logger.info(
                                "Job %s: Starting run_main() in %s mode: %s",
                                job_id,
                                attempt_mode,
                                " ".join(argv_for_attempt),
                            )
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
                            if "--host-volume" in retry_argv:
                                retry_argv = _strip_cli_option(retry_argv, "--host-volume")
                                retry_reason_parts.append("baseline startup without --host-volume")
                            if "--host-hf-cache" in retry_argv:
                                retry_argv = _strip_cli_option(retry_argv, "--host-hf-cache")
                                retry_reason_parts.append("baseline startup without --host-hf-cache")
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
                            #
                            # PermissionError on the log directory means the workflow_logs dir is
                            # root-owned (leftover from a previous sudo-based startup). Retrying
                            # with different Docker args won't help — re-raise immediately so the
                            # caller gets a clear error instead of a misleading retry.
                            if isinstance(first_attempt_error, PermissionError) and "workflow_logs" in str(first_attempt_error):
                                logger.error(
                                    "Job %s: PermissionError on workflow_logs directory — directory is likely "
                                    "root-owned from a previous sudo-based startup. Fix with: "
                                    "sudo chown -R $USER: %s/workflow_logs",
                                    job_id,
                                    script_dir,
                                )
                                raise
                            retry_argv, retry_reason = _build_retry_argv_and_reason()
                            if "--host-volume" in sys.argv and _job_has_host_volume_weights_warning(job_id):
                                logger.warning(
                                    "Job %s: host-volume attempt for %s logged a missing weights directory warning before the retry. Expected weights under %s",
                                    job_id,
                                    expected_host_volume_dir,
                                    expected_host_weights_dir,
                                )
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
                            if "--host-volume" in sys.argv and _job_has_host_volume_weights_warning(job_id):
                                logger.warning(
                                    "Job %s: host-volume attempt for %s logged a missing weights directory warning before the retry. Expected weights under %s",
                                    job_id,
                                    expected_host_volume_dir,
                                    expected_host_weights_dir,
                                )
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
                    finally:
                        # Restore globals while still holding lock so the next run
                        # starts from a consistent process state.
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

                if return_code == 0:
                    # Always extract from captured job logs — provides docker_log_file_path
                    # even when run_main() returned a bare int (no container_info dict).
                    extracted = _extract_from_job_logs(job_id)
                    logger.info(
                        f"Job {job_id}: _extract_from_job_logs result: "
                        f"container_name={extracted.get('container_name')!r} "
                        f"docker_log_file_path={extracted.get('docker_log_file_path')!r} "
                        f"run_log_file_path={extracted.get('run_log_file_path')!r}"
                    )

                    if not isinstance(container_info, dict) or not container_info.get("container_name"):
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
                    # Prefer container_info value; fall back to log-extracted value so that
                    # docker_log_file_path is never lost when container name extraction fails.
                    docker_log_file_path = (
                        (container_info.get("docker_log_file_path") if isinstance(container_info, dict) else None)
                        or extracted.get("docker_log_file_path")
                    )
                    run_log_file_path = (
                        (container_info.get("run_log_file_path") if isinstance(container_info, dict) else None)
                        or extracted.get("run_log_file_path")
                    )

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

                    # Advance the deploy-progress bar through the post-run milestones
                    # (locate container → connect network → rename). Monotonic: never
                    # lowers progress, never overrides a terminal status.
                    def _advance(stage_name: str, pct: int, msg: str) -> None:
                        with progress_lock:
                            cur = progress_store.get(job_id)
                            if not cur or cur.get("status") in ("completed", "failed", "cancelled", "error"):
                                return
                            cur.update({
                                "status": "running",
                                "stage": stage_name,
                                "progress": max(cur.get("progress", 0), pct),
                                "message": msg,
                                "last_updated": time.time(),
                            })

                    # Container process is up; we're now locating it to wire up networking.
                    _advance("container_started", 60, "Container started, locating it...")

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
                            _advance("network_setup", 72, "Connecting to the network...")
                            try:
                                network = client.networks.get("tt_studio_network")
                                network.connect(new_container)
                            except Exception:
                                pass
                            _advance("network_setup", 84, "Network connected, finalizing...")
                            # Rename for easier identification
                            model_name = request.model.replace("/", "-")
                            if original_name != model_name:
                                try:
                                    new_container.rename(model_name)
                                    response_data["container_name"] = model_name
                                except Exception:
                                    pass
                            _advance("finalizing", 95, "Finalizing the deployment...")
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

@app.get("/resolve-image")
async def resolve_image(model: str, device: str, impl: Optional[str] = None):
    """Return the exact Docker image this server would deploy for (model, device).

    The deployed image comes from the server's own model_spec (and may differ from
    any image ref a client has cached), so callers that want to pre-pull the image
    must resolve it here with the same device /run uses.
    """
    try:
        model_spec, _, _ = get_runtime_model_spec(model, device, impl=impl)
        return {"status": "success", "model": model, "device": device, "docker_image": model_spec.docker_image}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Could not resolve image for model={model}, device={device}: {e}")


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