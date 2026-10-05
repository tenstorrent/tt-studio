# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import glob
import json
import os
import re
import shutil
import stat

import requests
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from model_control.model_utils import get_deploy_cache
from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from shared_config.model_type_config import ModelTypes
from shared_config.user_config import get_tts_api_key

logger = get_logger(__name__)

PROXY_TIMEOUT = 120

TRAINING_VOLUME_SUBDIR = "training_volume"
CUSTOM_DATASETS_SUBDIR = os.path.join(TRAINING_VOLUME_SUBDIR, "custom_datasets")
MAX_DATASET_UPLOAD_BYTES = 200 * 1024 * 1024
MAX_DATASET_PREVIEW_BYTES = 25 * 1024 * 1024
# Leading slice served for datasets over the preview limit.
DATASET_PREVIEW_SAMPLE_BYTES = 2 * 1024 * 1024

# tt-media-server authenticates with `Authorization: Bearer <API_KEY>`.
# Not the JWT used for vLLM/LLM inference endpoints. The key is resolved
# via get_tts_api_key(), so an unset TTS_API_KEY no longer means an empty token.

# Training job endpoints (e.g. /v1/jobs) also require a non-empty org header
# for multi-tenant scoping. TT Studio is single-tenant, so we send a fixed value.
ORG_ID_HEADER = "X-TT-Organization"
ORG_ID = "tenstorrent"

CUSTOM_DATASET_LOADER = "Custom"
DEFAULT_CUSTOM_FILE_TYPE = "json"
DEFAULT_CUSTOM_TEMPLATE = "alpaca"

# Per-template prompt fields the trainer reads from each row (mirrors
# blacksmith's custom_dataset_utils TEMPLATE_KEYS) and, for each field, the
# dataset column names it is commonly stored under, in preference order. When no
# column mapping is given for a field, the first alias present in the dataset is
# used so a prompt/completion file trains without hand-mapping columns.
TEMPLATE_FIELDS = {
    "alpaca": {
        "required": ("instruction", "output"),
        "optional": ("input",),
    },
}
TEMPLATE_COLUMN_ALIASES = {
    "alpaca": {
        "instruction": ("instruction", "prompt", "question", "query", "user", "text"),
        "input": ("input", "context"),
        "output": ("output", "completion", "response", "answer", "target", "assistant"),
    },
}
# How many leading rows to scan for column names when inferring a mapping.
MAX_ROWS_FOR_COLUMN_SCAN = 200
# Job fields expressed in optimizer steps; the trainer fires them only when
# `global_step % value == 0`, so a value above the run's total steps never fires.
STEP_FREQUENCY_FIELDS = ("steps_freq", "val_steps_freq", "save_interval")

# The container mounts its per-model volume (`volume_id_*`) here, so datasets
# staged into that host dir are readable at this path.
CONTAINER_CACHE_ROOT = "/home/container_app_user/cache_root"
CONTAINER_CUSTOM_DATASETS_DIR = f"{CONTAINER_CACHE_ROOT}/custom_datasets"

# UID the training container runs as (tt-inference-server's `--image-user`
# default, which TT Studio never overrides). Files the root backend stages for
# the container are handed to this user instead of being made world-readable.
TRAINING_CONTAINER_UID = 1000


def _find_training_container(deploy_id=None):
    """Look up a running training container from the deploy cache.

    If *deploy_id* is given the entry must exist and be a TRAINING container.
    Otherwise the first TRAINING container found is returned.

    Returns ``(deploy_entry, error_response)`` – exactly one is ``None``.
    """
    cache = get_deploy_cache()

    if deploy_id:
        entry = cache.get(deploy_id)
        if entry is None:
            return None, JsonResponse(
                {"error": f"deploy_id={deploy_id} not found in deploy cache."},
                status=404,
            )
        model_impl = entry.get("model_impl")
        if model_impl is None or getattr(model_impl, "model_type", None) != ModelTypes.TRAINING:
            return None, JsonResponse(
                {"error": f"deploy_id={deploy_id} is not a fine-tuning container."},
                status=400,
            )
        return entry, None

    for _cid, entry in cache.items():
        model_impl = entry.get("model_impl")
        if model_impl and getattr(model_impl, "model_type", None) == ModelTypes.TRAINING:
            return entry, None

    return None, JsonResponse(
        {"error": "No running fine-tuning container found."},
        status=404,
    )


def _base_url(entry):
    """Derive the base ``http://host:port`` from a deploy-cache entry."""
    raw = entry["internal_url"]
    # internal_url may include a path (e.g. "container:7000/v1/jobs");
    # strip everything after host:port.
    host_port = raw.split("/")[0]
    return f"http://{host_port}"


def _auth_headers():
    return {
        "Authorization": f"Bearer {get_tts_api_key()}",
        ORG_ID_HEADER: ORG_ID,
    }


def _proxy_get(url, params=None, stream=False):
    """Issue a GET to the training container and return a Django response."""
    if params is not None:
        params = params.copy()
        params.pop("deploy_id", None)
    try:
        resp = requests.get(
            url,
            headers=_auth_headers(),
            params=params,
            timeout=None if stream else PROXY_TIMEOUT,
            stream=stream,
        )
        if stream:
            return StreamingHttpResponse(
                resp.iter_content(chunk_size=8192),
                content_type=resp.headers.get("Content-Type", "application/octet-stream"),
                status=resp.status_code,
            )
        return JsonResponse(resp.json(), status=resp.status_code, safe=False)
    except requests.ConnectionError:
        return JsonResponse(
            {"error": "Fine-tuning container is not reachable."}, status=502
        )
    except requests.Timeout:
        return JsonResponse(
            {"error": "Fine-tuning container request timed out."}, status=504
        )
    except Exception as e:
        logger.exception("Unexpected error proxying GET %s", url)
        return JsonResponse({"error": str(e)}, status=500)


def _proxy_post(url, body=None):
    """Issue a POST to the training container and return a Django response."""
    try:
        resp = requests.post(
            url,
            headers={**_auth_headers(), "Content-Type": "application/json"},
            json=body,
            timeout=PROXY_TIMEOUT,
        )
        return JsonResponse(resp.json(), status=resp.status_code, safe=False)
    except requests.ConnectionError:
        return JsonResponse(
            {"error": "Fine-tuning container is not reachable."}, status=502
        )
    except requests.Timeout:
        return JsonResponse(
            {"error": "Fine-tuning container request timed out."}, status=504
        )
    except Exception as e:
        logger.exception("Unexpected error proxying POST %s", url)
        return JsonResponse({"error": str(e)}, status=500)


def _custom_datasets_dir():
    """Container-internal path to the custom-datasets directory (created if absent).

    Only the backend touches this dir: uploads land here and are copied into the
    training volume by ``_stage_custom_dataset``. Neither the host user nor the
    training container reads it, so it stays owner-only.
    """
    internal_dir = os.path.join(
        backend_config.persistent_storage_volume, CUSTOM_DATASETS_SUBDIR
    )
    if not os.path.isdir(internal_dir):
        try:
            os.makedirs(internal_dir, exist_ok=True)
            os.chmod(internal_dir, stat.S_IRWXU)
        except OSError as e:
            logger.warning(
                "Could not create custom-datasets dir %s: %s", internal_dir, e
            )
    return internal_dir


def _safe_dataset_filename(name):
    """
    Strips any directory components to prevent path traversal and requires a
    ``.json``/``.jsonl`` extension.
    """
    if not name:
        return None
    base = os.path.basename(name.replace("\\", "/")).strip()
    if not base or base in (".", "..") or base.startswith("."):
        return None
    if not base.lower().endswith((".json", ".jsonl")):
        return None
    return base


def _resolve_dataset_path(directory, name):
    """Return the on-disk path for *name* inside *directory*, or ``None``.

    The datasets directory is world-writable + sticky (``01777``) so the training
    container can drop files into it. That also means a hostile symlink (e.g.
    ``leak.json`` → ``/app/secret.json``) could be planted there. Name-based
    validation alone is not enough: ``os.path.isfile``/``open`` follow symlinks,
    so we additionally reject symlinks and require the fully-resolved path to stay
    within the resolved datasets directory.
    """
    filename = _safe_dataset_filename(name)
    if filename is None:
        return None
    path = os.path.join(directory, filename)
    # Reject the final component being a symlink outright.
    if os.path.islink(path):
        return None
    # Defend against a symlinked directory / any traversal via resolution.
    real_dir = os.path.realpath(directory)
    real_path = os.path.realpath(path)
    if real_path != os.path.join(real_dir, filename):
        return None
    return path


def _parse_jsonl(text):
    """Parse JSON Lines (one object per line). Returns ``None`` if invalid."""
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            return None
        if not isinstance(obj, dict):
            return None
        rows.append(obj)
    return rows or None


def _looks_like_hf_datasets_server_export(obj):
    """Detect a raw HF ``datasets-server`` ``/rows`` export, whose real examples
    are nested under ``rows[i].row`` next to ``features``/``num_rows_total``."""
    if not isinstance(obj, dict):
        return False
    inner = obj.get("rows")
    if not isinstance(inner, list) or not inner:
        return False
    # Require each entry's `row` dict so a column named "rows" isn't a false hit.
    if not all(isinstance(r, dict) and isinstance(r.get("row"), dict) for r in inner):
        return False
    return any(k in obj for k in ("features", "num_rows_total", "num_rows_per_page"))


def _normalize_dataset_rows(text):
    """Normalize uploaded dataset *text* into the flat list of object rows the
    trainer expects. Accepts a JSON array of objects or JSON Lines (one object
    per line).

    Returns ``(rows, None)`` on success or ``(None, error_message)``.
    """
    stripped = text.strip()
    if not stripped:
        return None, "The file is empty."

    parsed = None
    parse_error = None
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as e:
        parse_error = e

    if parse_error is None:
        if isinstance(parsed, list):
            rows = parsed
        elif isinstance(parsed, dict):
            # A single JSON object is a valid one-row dataset (also covers a
            # one-line JSON Lines file, which parses as a bare object).
            rows = [parsed]
        else:
            return None, (
                "Expected a JSON array of objects or a JSON Lines file "
                "(one object per line)."
            )
    else:
        # Not a single JSON value; try JSON Lines.
        rows = _parse_jsonl(stripped)
        if rows is None:
            return None, f"File is not valid JSON or JSON Lines: {parse_error.msg}."

    if not rows:
        return None, "The dataset is empty."

    # A raw HF datasets-server export looks like a valid one-row dataset; reject
    # it upfront instead of letting the trainer fail on the wrapper's columns.
    if any(_looks_like_hf_datasets_server_export(row) for row in rows):
        return None, (
            "This looks like a raw Hugging Face datasets-server export "
            "(the examples are nested under \"rows\"[i].\"row\", alongside "
            "\"features\"/\"num_rows_total\" metadata). Please reformat it into "
            "a flat JSON array of example objects — e.g. extract each entry's "
            "\"row\" value into a top-level array like [{...}, {...}] — before "
            "uploading."
        )

    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            return None, (
                f"Every item must be an object. Item at index {i} is not an object."
            )
        # The trainer calls `.strip()` on field values, which crashes on a null
        # (common for optional fields like Alpaca `input`). Coerce top-level
        # nulls to "" — non-null and nested values are left untouched.
        for key, value in row.items():
            if value is None:
                row[key] = ""

    # `{}`, `[{}]` or rows whose values are all blank parse fine but give the
    # trainer nothing to learn from; reject them like an empty file.
    if not any(_row_has_content(row) for row in rows):
        return None, "The dataset is empty: no row contains a non-empty value."

    return rows, None


def _row_has_content(row):
    """True if any value in *row* is non-empty (blank strings don't count)."""
    for value in row.values():
        if isinstance(value, str):
            if value.strip():
                return True
        elif value is not None:
            return True
    return False


def _inspect_custom_dataset(name):
    """Return ``(columns, row_count)`` for an uploaded dataset, or ``(None, None)``
    if it can't be read. Uploads are stored as a normalized JSON array of
    objects (see ``CustomDatasetsView.post``); column names come from the first
    :data:`MAX_ROWS_FOR_COLUMN_SCAN` rows.
    """
    path = _resolve_dataset_path(_custom_datasets_dir(), name)
    if path is None or not os.path.isfile(path):
        return None, None
    try:
        with open(path, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return None, None
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        return None, None
    columns = set()
    for row in rows[:MAX_ROWS_FOR_COLUMN_SCAN]:
        if isinstance(row, dict):
            columns.update(row.keys())
    return columns, len(rows)


def _resolve_column_mapping(template, column_mapping, columns):
    """Fill in the template fields the request didn't map.

    For each template field without an explicit mapping, pick the first alias
    from :data:`TEMPLATE_COLUMN_ALIASES` present in *columns* (identity first,
    so an existing same-named column always wins). Explicit mappings are kept
    as-is.

    Returns ``(mapping, error_message)``; *error_message* is set when a required
    field still can't be resolved or an explicit mapping names a column the
    dataset doesn't have. Unknown templates are passed through untouched.
    """
    fields = TEMPLATE_FIELDS.get(template)
    if fields is None:
        return column_mapping, None

    mapping = dict(column_mapping) if isinstance(column_mapping, dict) else {}
    aliases = TEMPLATE_COLUMN_ALIASES.get(template, {})
    available = sorted(columns)

    for field, column in mapping.items():
        if column not in columns:
            return None, (
                f"Column {column!r} (mapped to {field!r}) was not found in the "
                f"dataset. Available columns: {available}."
            )

    for field in fields["required"] + fields["optional"]:
        if field in mapping:
            continue
        for candidate in aliases.get(field, (field,)):
            if candidate in columns:
                # Identity needs no entry; the trainer falls back to it itself.
                if candidate != field:
                    mapping[field] = candidate
                break

    missing = [
        f
        for f in fields["required"]
        if f not in mapping and f not in columns
    ]
    if missing:
        return None, (
            f"Could not find a dataset column for the required template "
            f"field(s) {missing}. Available columns: {available}. Set "
            f"column_mapping to tell the trainer which column holds each field."
        )
    return mapping or None, None


def _estimate_total_steps(body, row_count):
    """Conservative optimizer-step count for a job over *row_count* examples:
    ``floor(rows / batch_size) * num_epochs``, capped by a positive
    ``max_steps``. At least 1."""

    def _positive_int(key, default):
        value = body.get(key, default)
        try:
            value = int(value)
        except (TypeError, ValueError):
            return default
        return value if value > 0 else default

    batch_size = _positive_int("batch_size", 1)
    num_epochs = _positive_int("num_epochs", 1)
    steps = max(1, row_count // batch_size) * num_epochs
    max_steps = _positive_int("max_steps", 0)
    if max_steps:
        steps = min(steps, max_steps)
    return max(1, steps)


def _clamp_step_frequencies(body, row_count):
    """Lower any step-based frequency above the run's estimated total steps.

    The trainer records metrics, runs validation and saves checkpoints only on
    steps divisible by these values, so a small dataset trained with the default
    frequencies (10/25/25) finishes with no metrics and no checkpoint. Clamping
    to the estimated step count keeps every enabled feature firing at least
    once; ``0`` (disabled) values are left alone.
    """
    total = _estimate_total_steps(body, row_count)
    for key in STEP_FREQUENCY_FIELDS:
        value = body.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        if value > total:
            logger.info(
                "Lowering %s from %s to %s: the job only runs ~%s steps",
                key, value, total, total,
            )
            body[key] = total
    return total


def _resolve_training_volume_dir(impl):
    """Host path of the ``volume_id_*`` dir the training container mounts at
    :data:`CONTAINER_CACHE_ROOT`.

    ``impl.volume_name`` names the deploy's exact per-version dir, so prefer it
    when present — it disambiguates multiple versions of the same model. Fall back
    to a heuristic (name match, then most recently modified) otherwise. ``None``
    if no training volume exists yet.
    """
    internal_root = os.path.join(
        backend_config.persistent_storage_volume, TRAINING_VOLUME_SUBDIR
    )

    # A candidate volume dir must be a real directory whose resolved path stays
    # inside internal_root — a symlink could otherwise redirect staged datasets
    # outside the training volume.
    real_root = os.path.realpath(internal_root)

    def _is_safe_volume_dir(path):
        if os.path.islink(path) or not os.path.isdir(path):
            return False
        real_path = os.path.realpath(path)
        return real_path == real_root or real_path.startswith(real_root + os.sep)

    # Exact, version-aware match: impl.volume_name is `volume_id_<impl>-<name>-v<ver>`.
    volume_name = getattr(impl, "volume_name", None)
    if volume_name:
        exact = os.path.join(internal_root, volume_name)
        if _is_safe_volume_dir(exact):
            return exact

    candidates = [
        d
        for d in glob.glob(os.path.join(internal_root, "volume_id_*"))
        if _is_safe_volume_dir(d)
    ]
    if not candidates:
        return None

    model_name = getattr(impl, "model_name", None)
    if model_name:
        matched = [d for d in candidates if model_name in os.path.basename(d)]
        if matched:
            candidates = matched

    return max(candidates, key=os.path.getmtime)


def _copyfile_nofollow(src, dest):
    """Copy *src* to *dest* without ever following a destination symlink."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(dest, flags, stat.S_IRUSR | stat.S_IWUSR)
    with open(src, "rb") as src_handle, os.fdopen(fd, "wb") as dest_handle:
        shutil.copyfileobj(src_handle, dest_handle)


def _stage_custom_dataset(impl, name):
    """Copy an uploaded dataset into the container's mounted volume and return
    its container-side path.

    The upload isn't in a mounted dir, so it's copied into
    ``<volume_id_*>/custom_datasets/`` where the container can read it.

    Returns ``(container_path, error_response)`` – exactly one is ``None``.
    """
    directory = _custom_datasets_dir()
    src = _resolve_dataset_path(directory, name)
    if src is None or not os.path.isfile(src):
        return None, JsonResponse(
            {"error": f"Custom dataset {name!r} not found."}, status=404
        )

    volume_dir = _resolve_training_volume_dir(impl)
    if volume_dir is None:
        return None, JsonResponse(
            {
                "error": (
                    "Could not locate the fine-tuning container's data volume to "
                    "stage the custom dataset. Is a fine-tuning model deployed?"
                )
            },
            status=502,
        )

    base = os.path.basename(src)
    dest_dir = os.path.join(volume_dir, "custom_datasets")
    dest = os.path.join(dest_dir, base)
    try:
        os.makedirs(dest_dir, exist_ok=True)
        # Backend runs as root, the container as TRAINING_CONTAINER_UID: hand the
        # staged copy to the container user instead of making it world-readable.
        os.chown(dest_dir, TRAINING_CONTAINER_UID, -1)
        os.chmod(dest_dir, stat.S_IRWXU)
        _copyfile_nofollow(src, dest)
        os.chown(dest, TRAINING_CONTAINER_UID, -1)
        os.chmod(dest, stat.S_IRUSR | stat.S_IWUSR)
    except OSError as e:
        logger.exception("Could not stage custom dataset %s into %s", src, dest_dir)
        return None, JsonResponse({"error": str(e)}, status=500)

    return f"{CONTAINER_CUSTOM_DATASETS_DIR}/{base}", None


def _remove_staged_copies(filename):
    """Best-effort removal of a dataset's staged copies from every training
    volume, so deleting a dataset doesn't leave large orphans behind.

    Note: a job actively training on the file would lose it; in practice the
    trainer reads the dataset at job start, so this is safe between runs.
    """
    internal_root = os.path.join(
        backend_config.persistent_storage_volume, TRAINING_VOLUME_SUBDIR
    )
    pattern = os.path.join(internal_root, "volume_id_*", "custom_datasets", filename)
    for staged in glob.glob(pattern):
        try:
            if os.path.isfile(staged) and not os.path.islink(staged):
                os.remove(staged)
        except OSError as e:
            logger.warning("Could not remove staged dataset copy %s: %s", staged, e)


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


@method_decorator(csrf_exempt, name="dispatch")
class CustomDatasetsView(View):
    """Manage user-uploaded custom datasets on the shared training volume.

    GET  /training/datasets/custom/  → list uploaded datasets
    POST /training/datasets/custom/  → upload a dataset JSON file (multipart)
    """

    def get(self, request, *args, **kwargs):
        directory = _custom_datasets_dir()
        datasets = []
        try:
            for entry in sorted(os.listdir(directory)):
                path = _resolve_dataset_path(directory, entry)
                if path is None or not os.path.isfile(path):
                    continue
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                datasets.append(
                    {
                        "id": entry,
                        "name": entry,
                        "size_bytes": stat.st_size,
                        "modified_at": int(stat.st_mtime),
                    }
                )
        except OSError as e:
            logger.exception("Could not list custom datasets in %s", directory)
            return JsonResponse({"error": str(e)}, status=500)
        return JsonResponse({"datasets": datasets}, status=200)

    def post(self, request, *args, **kwargs):
        upload = request.FILES.get("file")
        if upload is None:
            return JsonResponse(
                {"error": "No file provided. Send a multipart 'file' field."},
                status=400,
            )

        filename = _safe_dataset_filename(upload.name)
        if filename is None:
            return JsonResponse(
                {"error": "Invalid filename. Only .json/.jsonl dataset files are accepted."},
                status=400,
            )

        if upload.size and upload.size > MAX_DATASET_UPLOAD_BYTES:
            limit_mb = MAX_DATASET_UPLOAD_BYTES // (1024 * 1024)
            return JsonResponse(
                {"error": f"File is too large. The limit is {limit_mb} MB."},
                status=400,
            )

        raw = upload.read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return JsonResponse(
                {"error": "File is not valid UTF-8 text."}, status=400
            )

        # Store the normalized flat array the trainer consumes.
        rows, norm_err = _normalize_dataset_rows(text)
        if norm_err is not None:
            return JsonResponse({"error": norm_err}, status=400)
        normalized = json.dumps(rows, ensure_ascii=False).encode("utf-8")

        directory = _custom_datasets_dir()
        dest = os.path.join(directory, filename)
        if os.path.exists(dest):
            return JsonResponse(
                {
                    "error": (
                        f'A dataset named "{filename}" already exists. '
                        "Rename the file or delete the existing dataset first."
                    )
                },
                status=409,
            )
        try:
            with open(dest, "wb") as f:
                f.write(normalized)
        except OSError as e:
            logger.exception("Could not save custom dataset to %s", dest)
            return JsonResponse({"error": str(e)}, status=500)

        try:
            stat = os.stat(dest)
            size_bytes = stat.st_size
            modified_at = int(stat.st_mtime)
        except OSError:
            size_bytes = len(normalized)
            modified_at = None

        return JsonResponse(
            {
                "id": filename,
                "name": filename,
                "size_bytes": size_bytes,
                "modified_at": modified_at,
            },
            status=201,
        )


@method_decorator(csrf_exempt, name="dispatch")
class CustomDatasetDetailView(View):
    """Read back or delete a single user-uploaded custom dataset.

    GET    /training/datasets/custom/<name>/ → raw JSON contents of the dataset
    DELETE /training/datasets/custom/<name>/ → remove the dataset from the volume

    GET returns the file's raw bytes with an ``application/json`` content type so
    the frontend can parse and preview it the same way it previews a freshly
    selected local file.
    """

    def get(self, request, name, *args, **kwargs):
        if _safe_dataset_filename(name) is None:
            return JsonResponse(
                {"error": "Invalid dataset name. Only .json/.jsonl datasets are supported."},
                status=400,
            )

        directory = _custom_datasets_dir()
        path = _resolve_dataset_path(directory, name)
        if path is None or not os.path.isfile(path):
            return JsonResponse({"error": "Dataset not found."}, status=404)

        try:
            size = os.path.getsize(path)
        except OSError as e:
            logger.exception("Could not stat custom dataset %s", path)
            return JsonResponse({"error": str(e)}, status=500)

        # Oversized datasets are served as a leading slice (sampled preview)
        # rather than rejected; smaller files are returned whole.
        sampled = size > MAX_DATASET_PREVIEW_BYTES
        read_bytes = DATASET_PREVIEW_SAMPLE_BYTES if sampled else size

        try:
            with open(path, "rb") as f:
                raw = f.read(read_bytes)
        except OSError as e:
            logger.exception("Could not read custom dataset %s", path)
            return JsonResponse({"error": str(e)}, status=500)

        response = HttpResponse(raw, content_type="application/json")
        if sampled:
            # Tell the frontend to sample-parse the partial body (exposed via CORS).
            response["X-Dataset-Sampled"] = "true"
            response["Access-Control-Expose-Headers"] = "X-Dataset-Sampled"
        return response

    def delete(self, request, name, *args, **kwargs):
        filename = _safe_dataset_filename(name)
        if filename is None:
            return JsonResponse(
                {"error": "Invalid dataset name. Only .json/.jsonl datasets are supported."},
                status=400,
            )

        directory = _custom_datasets_dir()
        path = _resolve_dataset_path(directory, name)
        if path is None or not os.path.isfile(path):
            return JsonResponse({"error": "Dataset not found."}, status=404)

        try:
            os.remove(path)
        except OSError as e:
            logger.exception("Could not delete custom dataset %s", path)
            return JsonResponse({"error": str(e)}, status=500)

        _remove_staged_copies(filename)

        return JsonResponse({"id": filename, "name": filename, "deleted": True}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingCatalogView(View):
    """GET /training/catalog/ → Container /v1/catalog"""

    def get(self, request, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/catalog"
        return _proxy_get(url, params=request.GET)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingJobsListView(View):
    """GET  /training/jobs/ → Container /v1/jobs
    POST /training/jobs/ → Container /v1/jobs  (create a new job)
    """

    def get(self, request, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs"
        return _proxy_get(url, params=request.GET)

    def post(self, request, *args, **kwargs):
        try:
            body = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON body."}, status=400)

        deploy_id = body.pop("deploy_id", None)
        entry, err = _find_training_container(deploy_id)
        if err:
            return err

        # Stage the named upload(s) and rewrite them into the server's custom-dataset
        # fields. Popped unconditionally so the helper fields never reach the server.
        custom_name = body.pop("custom_dataset", None)
        custom_eval_name = body.pop("custom_eval_dataset", None)
        if body.get("dataset_loader") == CUSTOM_DATASET_LOADER:
            if not custom_name or not isinstance(custom_name, str):
                return JsonResponse(
                    {
                        "error": "custom_dataset (a dataset name) is required when dataset_loader is 'Custom'."
                    },
                    status=400,
                )
            container_path, stage_err = _stage_custom_dataset(
                entry.get("model_impl"), custom_name
            )
            if stage_err:
                return stage_err
            body["train_dataset_path"] = container_path
            body.setdefault("file_type", DEFAULT_CUSTOM_FILE_TYPE)
            body.setdefault("template", DEFAULT_CUSTOM_TEMPLATE)

            columns, row_count = _inspect_custom_dataset(custom_name)
            if columns is not None:
                mapping, mapping_err = _resolve_column_mapping(
                    body["template"], body.get("column_mapping"), columns
                )
                if mapping_err:
                    return JsonResponse({"error": mapping_err}, status=400)
                if mapping:
                    body["column_mapping"] = mapping
                _clamp_step_frequencies(body, row_count)

            # Optional: reject any non-string value up front (truthy or falsy, so
            # e.g. [] or 0 aren't silently ignored); None/"" simply means "no eval".
            if custom_eval_name is not None and not isinstance(custom_eval_name, str):
                return JsonResponse(
                    {"error": "custom_eval_dataset must be a dataset name."},
                    status=400,
                )
            if custom_eval_name:
                eval_path, eval_stage_err = _stage_custom_dataset(
                    entry.get("model_impl"), custom_eval_name
                )
                if eval_stage_err:
                    return eval_stage_err
                body["val_dataset_path"] = eval_path

        url = f"{_base_url(entry)}/v1/jobs"
        return _proxy_post(url, body=body)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingJobDetailView(View):
    """GET /training/jobs/<job_id>/ → Container /v1/jobs/{job_id}"""

    def get(self, request, job_id, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}"
        return _proxy_get(url, params=request.GET)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingJobMetricsView(View):
    """GET /training/jobs/<job_id>/metrics/ → Container /v1/jobs/{job_id}/metrics"""

    def get(self, request, job_id, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}/metrics"
        return _proxy_get(url, params=request.GET)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingJobLogsView(View):
    """GET /training/jobs/<job_id>/logs/ → Container /v1/jobs/{job_id}/logs"""

    def get(self, request, job_id, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}/logs"
        return _proxy_get(url, params=request.GET)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingJobCheckpointsView(View):
    """GET /training/jobs/<job_id>/checkpoints/ → Container /v1/jobs/{job_id}/checkpoints"""

    def get(self, request, job_id, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}/checkpoints"
        return _proxy_get(url, params=request.GET)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingJobCancelView(View):
    """POST /training/jobs/<job_id>/cancel/ → Container /v1/jobs/{job_id}/cancel"""

    def post(self, request, job_id, *args, **kwargs):
        try:
            body = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            body = {}

        deploy_id = body.pop("deploy_id", None) or request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}/cancel"
        return _proxy_post(url, body=body)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingCheckpointDownloadView(View):
    """GET /training/jobs/<job_id>/checkpoints/<ckpt_id>/ → Container download (streamed)"""

    def get(self, request, job_id, ckpt_id, *args, **kwargs):
        deploy_id = request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}/checkpoints/{ckpt_id}"
        return _proxy_get(url, params=request.GET, stream=True)


@method_decorator(csrf_exempt, name="dispatch")
class TrainingCheckpointMergeView(View):
    """POST /training/jobs/<job_id>/checkpoints/<ckpt_id>/merge/ → Container merge.

    Promotes a LoRA adapter checkpoint into a full HF checkpoint the inference
    container can serve. 
    """

    def post(self, request, job_id, ckpt_id, *args, **kwargs):
        try:
            body = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            body = {}
        deploy_id = body.pop("deploy_id", None) or request.GET.get("deploy_id")
        entry, err = _find_training_container(deploy_id)
        if err:
            return err
        url = f"{_base_url(entry)}/v1/jobs/{job_id}/checkpoints/{ckpt_id}/merge"
        return _proxy_post(url, body=body)


# merge_id is a UUID job id; restrict the charset so it can't inject glob/path tokens.
_MERGE_ID_RE = re.compile(r"[A-Za-z0-9_.-]+")


def _chmod_merged_dir_readable(merged_dir):
    """Recursively make one merged-checkpoint dir readable (``chmod -R a+rX``:
    +r on files, +rx on dirs, never +x on files). Best-effort; failures logged."""
    for dirpath, _dirnames, filenames in os.walk(merged_dir):
        paths = [(dirpath, True)] + [
            (os.path.join(dirpath, fn), False) for fn in filenames
        ]
        for path, is_dir in paths:
            try:
                mode = os.stat(path).st_mode
                # +rx on dirs (traversable), +r on files (a+rX: no +x on files).
                extra = 0o055 if is_dir else 0o044
                if mode & extra != extra:
                    os.chmod(path, mode | extra)
            except OSError as e:
                logger.warning(
                    "Could not normalize perms on merged checkpoint %s: %s",
                    path,
                    e,
                )


def _normalize_merged_checkpoint_perms(merge_id=None):
    """Fix the 0600 perms the merge writes (under the training container's uid) so
    the host-side inference server can read the weights. Runs as root in the
    backend, once after a promote completes. With *merge_id*, only that merge's dir
    (``<model>-<merge_id>``) is fixed; otherwise all merged checkpoints.
    """
    internal_root = os.path.join(
        backend_config.persistent_storage_volume, TRAINING_VOLUME_SUBDIR
    )
    dir_glob = f"*{merge_id}" if merge_id else "*"
    pattern = os.path.join(internal_root, "volume_id_*", "merged_models", dir_glob)
    for merged_dir in glob.glob(pattern):
        if os.path.isdir(merged_dir):
            _chmod_merged_dir_readable(merged_dir)


@method_decorator(csrf_exempt, name="dispatch")
class NormalizeMergedCheckpointView(View):
    """POST /training/merged-checkpoints/<merge_id>/normalize/

    Called once after a promote completes to make the merged checkpoint readable
    by the host-side inference server. See _normalize_merged_checkpoint_perms.
    """

    def post(self, request, merge_id, *args, **kwargs):
        if not _MERGE_ID_RE.fullmatch(merge_id):
            return JsonResponse({"error": "Invalid merge_id."}, status=400)
        _normalize_merged_checkpoint_perms(merge_id)
        return JsonResponse({"status": "ok", "merge_id": merge_id}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class MergedCheckpointsView(View):
    """GET /training/merged-checkpoints/?model_id=<id> → inference-api scan.

    Discovers merged LoRA checkpoints by scanning the shared training host volume
    on disk 
    """

    def get(self, request, *args, **kwargs):
        model_id = request.GET.get("model_id")
        impl = model_implmentations.get(model_id) if model_id else None
        if model_id and impl is None:
            return JsonResponse(
                {"error": f"Unknown model_id={model_id}."}, status=404
            )

        if impl is not None and getattr(impl, "model_type", None) == ModelTypes.TRAINING:
            return JsonResponse({"merged_checkpoints": []}, status=200)

        from docker_control.docker_utils import get_training_host_volume

        params = {"host_volume": get_training_host_volume()}
        hf_model_id = getattr(impl, "hf_model_id", None) if impl else None
        if hf_model_id:
            params["hf_model_id"] = hf_model_id

        url = f"{backend_config.tt_inference_api_url}/merged_checkpoints"
        try:
            resp = requests.get(url, params=params, timeout=PROXY_TIMEOUT)
            return JsonResponse(resp.json(), status=resp.status_code, safe=False)
        except requests.ConnectionError:
            return JsonResponse(
                {"error": "Inference server is not reachable."}, status=502
            )
        except requests.Timeout:
            return JsonResponse(
                {"error": "Inference server request timed out."}, status=504
            )
        except Exception as e:
            logger.exception("Unexpected error scanning merged checkpoints via %s", url)
            return JsonResponse({"error": str(e)}, status=500)
