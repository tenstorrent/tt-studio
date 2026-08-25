# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import os

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

logger = get_logger(__name__)

PROXY_TIMEOUT = 120

CUSTOM_DATASETS_SUBDIR = os.path.join("training_volume", "custom_datasets")
MAX_DATASET_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_DATASET_PREVIEW_BYTES = 25 * 1024 * 1024

# tt-media-server authenticates with `Authorization: Bearer <API_KEY>`.
# Not the JWT used for vLLM/LLM inference endpoints.
TTS_API_KEY = os.environ.get("TTS_API_KEY", "")

# Training job endpoints (e.g. /v1/jobs) also require a non-empty org header
# for multi-tenant scoping. TT Studio is single-tenant, so we send a fixed value.
ORG_ID_HEADER = "X-TT-Organization"
ORG_ID = "tenstorrent"


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
                {"error": f"deploy_id={deploy_id} is not a training container."},
                status=400,
            )
        return entry, None

    for _cid, entry in cache.items():
        model_impl = entry.get("model_impl")
        if model_impl and getattr(model_impl, "model_type", None) == ModelTypes.TRAINING:
            return entry, None

    return None, JsonResponse(
        {"error": "No running training container found."},
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
        "Authorization": f"Bearer {TTS_API_KEY}",
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
            {"error": "Training container is not reachable."}, status=502
        )
    except requests.Timeout:
        return JsonResponse(
            {"error": "Training container request timed out."}, status=504
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
            {"error": "Training container is not reachable."}, status=502
        )
    except requests.Timeout:
        return JsonResponse(
            {"error": "Training container request timed out."}, status=504
        )
    except Exception as e:
        logger.exception("Unexpected error proxying POST %s", url)
        return JsonResponse({"error": str(e)}, status=500)


def _custom_datasets_dir():
    """Container-internal path to the custom-datasets directory (created if absent).

    Mirrors the world-writable sticky permissions used elsewhere on the training
    host volume so the non-root training container (uid 1000) and the host user
    running run.py can both read/write it.
    """
    internal_dir = os.path.join(
        backend_config.persistent_storage_volume, CUSTOM_DATASETS_SUBDIR
    )
    if not os.path.isdir(internal_dir):
        try:
            os.makedirs(internal_dir, exist_ok=True)
            os.chmod(internal_dir, 0o1777)
        except OSError as e:
            logger.warning(
                "Could not create custom-datasets dir %s: %s", internal_dir, e
            )
    return internal_dir


def _safe_dataset_filename(name):
    """
    Strips any directory components to prevent path traversal and requires a
    ``.json`` extension (the only format the preview/loader understands).
    """
    if not name:
        return None
    base = os.path.basename(name.replace("\\", "/")).strip()
    if not base or base in (".", "..") or base.startswith("."):
        return None
    if not base.lower().endswith(".json"):
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
                {"error": "Invalid filename. Only .json dataset files are accepted."},
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
            json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return JsonResponse(
                {"error": "File is not valid JSON."}, status=400
            )

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
                f.write(raw)
        except OSError as e:
            logger.exception("Could not save custom dataset to %s", dest)
            return JsonResponse({"error": str(e)}, status=500)

        try:
            stat = os.stat(dest)
            size_bytes = stat.st_size
            modified_at = int(stat.st_mtime)
        except OSError:
            size_bytes = len(raw)
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
                {"error": "Invalid dataset name. Only .json datasets are supported."},
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

        if size > MAX_DATASET_PREVIEW_BYTES:
            limit_mb = MAX_DATASET_PREVIEW_BYTES // (1024 * 1024)
            return JsonResponse(
                {
                    "error": (
                        f"Dataset is too large to preview. The limit is {limit_mb} MB."
                    )
                },
                status=413,
            )

        try:
            with open(path, "rb") as f:
                raw = f.read()
        except OSError as e:
            logger.exception("Could not read custom dataset %s", path)
            return JsonResponse({"error": str(e)}, status=500)

        return HttpResponse(raw, content_type="application/json")

    def delete(self, request, name, *args, **kwargs):
        filename = _safe_dataset_filename(name)
        if filename is None:
            return JsonResponse(
                {"error": "Invalid dataset name. Only .json datasets are supported."},
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
