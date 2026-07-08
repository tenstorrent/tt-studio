# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# model_control/views.py
import os
from pathlib import Path
from typing import Optional
import asyncio
import base64
import threading
import requests
from PIL import Image
import io
import time
import datetime
import json
import jwt

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import StreamingHttpResponse, HttpResponse, JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.renderers import JSONRenderer
from rest_framework.parsers import JSONParser
from rest_framework.negotiation import DefaultContentNegotiation
from django.views import View

# Add this renderer class for SSE support
class PlainTextRenderer(JSONRenderer):
    media_type = 'text/plain'
    format = 'txt'

class EventStreamRenderer(JSONRenderer):
    media_type = 'text/event-stream'
    format = 'txt'

# Add this negotiation class to bypass content type checks
class IgnoreClientContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix):
        # Force the first renderer without checking Accept headers
        return (renderers[0], renderers[0].media_type)

from .serializers import InferenceSerializer, ModelWeightsSerializer
from .log_classifier import classify_startup_phase


# Module-level latch: tracks the highest phase + cached state we've ever seen
# for each deploy_id. Without this, the classifier can briefly regress (e.g.
# Llama hits `device_init` then the tail rotates and only `container_starting`
# markers remain → bar jumps back to 2%). Also catches the "weights cached"
# flag during the brief window when the cached log line is in the tail, and
# remembers it across later polls when that line has scrolled out.
_phase_latch_lock = threading.Lock()
_phase_latch: dict[str, dict] = {}


def _apply_phase_latch(deploy_id: str, phase_dict: dict) -> dict:
    """Merge in the highest phase + sticky fields seen for this deploy.

    Phase ordering comes from `phase_dict["phases"]`. Three independent
    monotonic guarantees:
      1. `phase` can only advance forward (or stay).
      2. `progress` (numeric percent) can never regress, even within the same
         phase. This protects against substep-counter drops when an earlier
         marker scrolls out of the 200-line tail.
      3. `weights_cached` / `weights_repo` are sticky once seen.
    """
    phases = phase_dict.get("phases") or []
    current = phase_dict.get("phase")
    with _phase_latch_lock:
        prev = _phase_latch.get(deploy_id) or {}
        prev_phase = prev.get("phase")
        prev_max_progress = int(prev.get("max_progress", 0))

        # Resolve max phase by index in the (stable) phases list. If categories
        # changed mid-deploy we play it safe and skip the comparison.
        new_phase = current
        if prev_phase and current and prev_phase in phases and current in phases:
            if phases.index(prev_phase) > phases.index(current):
                new_phase = prev_phase
                labels = phase_dict.get("phase_labels") or {}
                base_pct = phase_dict.get("phase_base_pct") or {}
                phase_dict["phase"] = prev_phase
                phase_dict["phase_label"] = labels.get(prev_phase, prev_phase)
                phase_dict["progress"] = max(
                    phase_dict.get("progress", 0), base_pct.get(prev_phase, 0)
                )

        # Floor progress at the maximum ever recorded for this deploy so the
        # bar can never visually go backwards.
        cur_progress = int(phase_dict.get("progress", 0) or 0)
        if cur_progress < prev_max_progress:
            phase_dict["progress"] = prev_max_progress
        new_max_progress = max(prev_max_progress, int(phase_dict.get("progress", 0) or 0))

        # Sticky cached/repo so the badge persists across tail rotations.
        if prev.get("weights_cached") and not phase_dict.get("weights_cached"):
            phase_dict["weights_cached"] = True
        if prev.get("weights_repo") and not phase_dict.get("weights_repo"):
            phase_dict["weights_repo"] = prev["weights_repo"]

        _phase_latch[deploy_id] = {
            "phase": new_phase,
            "max_progress": new_max_progress,
            "weights_cached": bool(phase_dict.get("weights_cached") or prev.get("weights_cached")),
            "weights_repo": phase_dict.get("weights_repo") or prev.get("weights_repo"),
        }
    return phase_dict


def _drop_phase_latch(deploy_id: str) -> None:
    """Forget latched state for a deploy (e.g. when it becomes healthy or is removed)."""
    with _phase_latch_lock:
        _phase_latch.pop(deploy_id, None)
from model_control.model_utils import (
    encoded_jwt,
    _vllm_client,
    get_deploy_cache,
    get_model_name_from_container,
    get_max_tokens_limit,
    messages_to_prompt,
    stream_response_from_external_api,
    stream_openai_passthrough,
    stream_response_from_agent_api,
    health_check,
    stream_to_cloud_model,
)
from shared_config.model_config import model_implmentations
from shared_config.logger_config import get_logger
from shared_config.backend_config import backend_config

logger = get_logger(__name__)
logger.info(f"importing {__name__}")




TTS_API_KEY = os.environ.get("TTS_API_KEY", "")
CLOUD_CHAT_UI_URL =os.environ.get("CLOUD_CHAT_UI_URL")
CLOUD_YOLOV4_API_URL = os.environ.get("CLOUD_YOLOV4_API_URL")
CLOUD_YOLOV4_API_AUTH_TOKEN = os.environ.get("CLOUD_YOLOV4_API_AUTH_TOKEN")
CLOUD_SPEECH_RECOGNITION_URL = os.environ.get("CLOUD_SPEECH_RECOGNITION_URL")
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN = os.environ.get("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN")
CLOUD_STABLE_DIFFUSION_URL = os.environ.get("CLOUD_STABLE_DIFFUSION_URL")
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN = os.environ.get("CLOUD_STABLE_DIFFUSION_AUTH_TOKEN")
CLOUD_SPEECH_RECOGNITION_URL = os.environ.get("CLOUD_SPEECH_RECOGNITION_URL")
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN = os.environ.get("CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN")

@method_decorator(csrf_exempt, name="dispatch")
class InferenceCloudView(View):
    async def post(self, request, *args, **kwargs):
        data = json.loads(request.body)
        logger.info(f"InferenceCloudView data:={data}")

        async def generate():
            async for chunk in stream_to_cloud_model(CLOUD_CHAT_UI_URL, data):
                yield chunk

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

@method_decorator(csrf_exempt, name="dispatch")
class InferenceView(View):
    async def post(self, request, *args, **kwargs):
        data = json.loads(request.body)
        logger.info(f"InferenceView data:={data}")
        serializer = InferenceSerializer(data=data)
        if not serializer.is_valid():
            return JsonResponse(serializer.errors, status=400)

        deploy_id = data.pop("deploy_id")
        deploy = get_deploy_cache()[deploy_id]
        internal_url = "http://" + deploy["internal_url"]
        logger.info(f"internal_url:= {internal_url}")
        logger.info(f"using vllm model:= {deploy['model_impl'].model_name}")
        data["model"] = deploy.get("cached_model_name") or get_model_name_from_container(
            deploy["internal_url"], fallback=deploy["model_impl"].hf_model_id
        )

        # Clamp max_tokens to 75% of the model's context window so there is
        # always headroom for input tokens (conversation history, system prompt, etc).
        # Falls back to a param_count-based estimate when max_model_len is not yet cached.
        raw_limit = deploy.get("max_model_len") or get_max_tokens_limit(deploy["model_impl"].param_count)
        max_tokens_limit = max(1, raw_limit * 3 // 4)
        if data.get("max_tokens"):
            data["max_tokens"] = min(int(data["max_tokens"]), max_tokens_limit)

        # Route base/completion models to /v1/completions with a plain prompt
        service_route = deploy["model_impl"].service_route
        logger.info(f"service_route:= {service_route}")
        if service_route == "/v1/completions":
            messages = data.pop("messages", [])
            data["prompt"] = messages_to_prompt(messages)
            data.pop("stream_options", None)

        async def generate():
            try:
                async for chunk in stream_response_from_external_api(internal_url, data):
                    yield chunk
            except Exception as e:
                logger.error(f"Error in stream: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

@method_decorator(csrf_exempt, name="dispatch")
class AgentView(View):
    async def post(self, request, *args, **kwargs):
        logger.info('[TRACE_FLOW_STEP_2_BACKEND_AGENT_ENTRY] AgentView.post called')
        data = json.loads(request.body)
        logger.info(f"AgentView data:={data}")

        deploy_id = data.get("deploy_id", "")
        logger.info(f"Deploy ID: {deploy_id}")

        deploy_cache = get_deploy_cache()
        if deploy_id and deploy_id in deploy_cache:
            deploy = deploy_cache[deploy_id]
            logger.info(f"using vllm model:= {deploy['model_impl'].model_name}")
            data["model"] = deploy.get("cached_model_name") or get_model_name_from_container(
                deploy["internal_url"], fallback=deploy["model_impl"].hf_model_id
            )
        else:
            logger.info("No valid deployment found, proceeding with agent-only mode (cloud LLM)")
            data.pop("deploy_id", None)

        agent_url = "http://tt_studio_agent:8080/poll_requests"
        logger.info(f"agent_url:= {agent_url}")

        if not deploy_id:
            data["use_agent_discovery"] = True
            logger.info("Enabling agent auto-discovery mode")

        async def generate():
            async for chunk in stream_response_from_agent_api(agent_url, data):
                yield chunk

        response = StreamingHttpResponse(generate(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class AgentStatusView(APIView):
    def get(self, request, *args, **kwargs):
        """Get agent status and discovery information"""
        try:
            import time
            # Get agent status directly from the agent service
            agent_status_url = "http://tt_studio_agent:8080/status"
            response = requests.get(agent_status_url, timeout=10)
            
            if response.status_code == 200:
                agent_status = response.json()
                
                # Add backend-specific information
                backend_info = {
                    "backend_status": "running",
                    "deployed_models_count": len(get_deploy_cache()),
                    "agent_integration": "enhanced",
                    "discovery_enabled": True
                }
                
                # Merge agent and backend status
                full_status = {
                    "agent": agent_status,
                    "backend": backend_info,
                    "timestamp": time.time()
                }
                
                return Response(full_status, status=status.HTTP_200_OK)
            else:
                return Response(
                    {"error": "Agent service unavailable", "status_code": response.status_code},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to get agent status: {e}")
            return Response(
                {"error": "Failed to connect to agent service", "details": str(e)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        except Exception as e:
            logger.error(f"Unexpected error in AgentStatusView: {e}")
            return Response(
                {"error": "Internal server error", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ModelHealthView(APIView):
    def get(self, request, *args, **kwargs):
        data = request.query_params
        logger.info(f"HealthView data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            deploy = get_deploy_cache()[deploy_id]
            health_url = "http://" + deploy["health_url"]
            check_passed, health_content = health_check(health_url, json_data=None)
            if check_passed is True:
                ret_status = status.HTTP_200_OK
                content = {"message": "Healthy", "details": health_content}
                # Container is healthy — release the latched startup state.
                _drop_phase_latch(deploy_id)
            elif check_passed is None:
                ret_status = status.HTTP_202_ACCEPTED
                content = {"message": "Starting", "details": health_content}
                # Enrich the "starting" response with real phase info parsed from
                # the container's stdout. Best-effort: if anything fails we still
                # return the basic 202 so the badge logic is unaffected.
                content["phase"] = _get_startup_phase(deploy_id)
            else:
                ret_status = status.HTTP_503_SERVICE_UNAVAILABLE
                content = {"message": "Unavailable", "details": health_content}
                # Permanently unavailable — release the latch so a fresh deploy
                # with the same id doesn't inherit stale phase state.
                _drop_phase_latch(deploy_id)
            return Response(content, status=ret_status)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def _resolve_model_identity(deploy_id: str) -> tuple[Optional[str], Optional[str]]:
    """Look up (model_type, model_name) for a deploy_id from the deploy cache.

    Used by `_get_startup_phase` so the classifier can pick the right phase
    template (LLM vs MEDIA). Returns (None, None) if the cache miss — the
    classifier then falls back to name-regex routing or defaults to LLM.
    """
    try:
        cache = get_deploy_cache() or {}
        entry = cache.get(deploy_id) or {}
        model_impl = entry.get("model_impl")
        if model_impl is None:
            return (None, None)
        mtype = getattr(getattr(model_impl, "model_type", None), "value", None)
        mname = getattr(model_impl, "model_name", None)
        return (mtype, mname)
    except Exception as e:
        logger.debug(f"_resolve_model_identity({deploy_id[:12]}) failed: {e}")
        return (None, None)


def _refine_download_progress(phase_dict: dict, dl: dict) -> None:
    """Mutate phase_dict in-place: layer byte-ratio refinement on top of the
    coarse base_pct, using whichever phase template is in effect."""
    base_pct = phase_dict.get("phase_base_pct") or {}
    phases = phase_dict.get("phases") or []
    dl_start = base_pct.get("downloading_weights")
    if dl_start is None:
        return
    # Find the next phase to bound the download band. Leave a 2-pct gap so
    # the boundary nudges visibly when phase advances.
    try:
        idx = phases.index("downloading_weights")
        next_key = phases[idx + 1] if idx + 1 < len(phases) else None
    except ValueError:
        next_key = None
    next_pct = base_pct.get(next_key) if next_key else None
    band_end = (next_pct - 2) if next_pct is not None else (dl_start + 20)
    band_end = max(band_end, dl_start)

    total = dl.get("total_bytes")
    downloaded = dl.get("downloaded_bytes")
    if total and downloaded is not None and total > 0:
        ratio = min(1.0, max(0.0, downloaded / total))
        phase_dict["progress"] = int(round(dl_start + ratio * (band_end - dl_start)))
    elif dl.get("weights_cached"):
        # No total_bytes available but we know it's cached — pin to the top
        # of the band so the bar doesn't read as "starting from scratch".
        phase_dict["progress"] = max(phase_dict.get("progress", 0), band_end)


def _get_startup_phase(deploy_id: str) -> dict | None:
    """Tail the container's recent logs and run the phase classifier.

    Picks the LLM or MEDIA phase template based on the deploy's model_type.
    When the classifier reports `downloading_weights`, also reads byte counts
    from the container via the docker-control-service dir-size endpoint and
    merges byte / speed / ETA fields into the response so the Preparing banner
    can render a live progress bar — see download_progress.py.

    Returns None if the tail fails — callers should treat None as "no phase
    info available", not as an error.
    """
    model_type, model_name = _resolve_model_identity(deploy_id)

    try:
        from docker_control.docker_control_client import get_docker_client
        client = get_docker_client()
        lines = client.tail_logs(deploy_id, tail=200, timeout=3.0)
        # Even if `lines` is empty (container hasn't logged yet, or the tail
        # was all noise upstream), still run the classifier — it'll default to
        # phases[0], and `_apply_phase_latch` promotes that to the previously
        # latched maximum so the bar never reports null mid-warmup.
        phase_dict = classify_startup_phase(
            lines or [], model_type=model_type, model_name=model_name,
        )
        phase_dict = _apply_phase_latch(deploy_id, phase_dict)
    except Exception as e:
        logger.warning(f"startup phase classify failed for {deploy_id[:12]}: {e}")
        return None

    try:
        if phase_dict.get("phase") == "downloading_weights":
            from .download_progress import compute_download_progress
            dl = compute_download_progress(
                deploy_id=deploy_id,
                repo=phase_dict.get("weights_repo"),
                container_path=phase_dict.get("weights_target_path"),
                cached=bool(phase_dict.get("weights_cached")),
            )
            phase_dict.update(dl)
            _refine_download_progress(phase_dict, dl)
            # Surface a richer message when we have a repo to name.
            repo = dl.get("weights_repo")
            downloaded = dl.get("downloaded_bytes")
            total = dl.get("total_bytes")
            if dl.get("weights_cached"):
                phase_dict["message"] = (
                    f"Weights cached — skipping download ({repo})" if repo
                    else "Weights cached — skipping download"
                )
            elif repo:
                from_b = _format_bytes(downloaded) if downloaded is not None else "—"
                to_b = _format_bytes(total) if total else "?"
                phase_dict["message"] = f"Downloading {repo}: {from_b} / {to_b}"
    except Exception as e:
        logger.debug(f"download_progress merge failed for {deploy_id[:12]}: {e}")

    return phase_dict


def _format_bytes(n: int | float | None) -> str:
    """Compact human-readable byte size (matches the frontend formatter)."""
    if n is None or n < 0:
        return "—"
    if n == 0:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB", "PB")
    v = float(n)
    u = 0
    while v >= 1024 and u < len(units) - 1:
        v /= 1024
        u += 1
    if v >= 100 or u == 0:
        return f"{int(v)} {units[u]}"
    if v >= 10:
        return f"{v:.1f} {units[u]}"
    return f"{v:.2f} {units[u]}"


class DeployedModelsView(APIView):
    """Thin shim over get_canonical_deployments() preserving the existing
    response shape: dict keyed by container_id, every entry has a serialized
    model_impl (asdict, enums rendered as .value), env_vars and docker_config stripped for security.

    Filters to fully-deployed managed containers only (source="managed" and not is_pending) — matches the historical behaviour where this endpoint only surfaced models that had reached the running state.
    """

    def get(self, request, *args, **kwargs):
        from docker_control.docker_utils import (
            get_canonical_deployments,
            serialize_canonical_entry_for_http,
        )

        canonical = get_canonical_deployments()
        deployed_data = {}
        for con_id, entry in canonical.items():
            if entry.get("source") != "managed":
                continue
            if entry.get("is_pending"):
                continue
            if entry.get("model_impl") is None:
                continue
            serialized = serialize_canonical_entry_for_http(entry)
            # Existing consumers don't expect these internal markers.
            serialized.pop("source", None)
            serialized.pop("is_pending", None)
            serialized.pop("deployment_id", None)
            serialized.pop("deployment_model_name", None)
            deployed_data[con_id] = serialized

        logger.info(f"deployed_data:={deployed_data}")
        return Response(deployed_data, status=status.HTTP_200_OK)


class ModelWeightsView(APIView):
    def get(self, request, *args, **kwargs):
        data = request.query_params
        logger.info(f"request.query_params:={data}")
        serializer = ModelWeightsSerializer(data=data)
        if serializer.is_valid():
            model_id = data.get("model_id")
            impl = model_implmentations[model_id]
            weights_dir = impl.backend_weights_dir
            assert weights_dir.exists(), f"weights_dir:={weights_dir} does not exist. Check models API initiliazation."
            weights = [
                {"weights_id": f"id_{w.name}", "name": w.name}
                for w in weights_dir.iterdir()
            ]
            return Response(weights, status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ObjectDetectionInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            image = data.get("image").file  # we should only receive 1 file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            # construct file to send
            pil_image = Image.open(image)
            pil_image = pil_image.resize((320, 320))  # Resize to target dimensions
            buf = io.BytesIO()
            pil_image.save(
                buf,
                format="JPEG",
            )
            byte_im = buf.getvalue()
            file = {"file": byte_im}
            try:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response(inference_data.json(), status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ObjectDetectionInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        
        # Get image directly instead of using serializer
        image = data.get("image")
        if not image:
            return Response({"error": "image is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        image = image.file  # we should only receive 1 file
        
        # Get deploy_id and handle the case where it's the string "null" or empty
        deploy_id = data.get("deploy_id")
        if deploy_id == "null" or not deploy_id:
            # Use cloud URL when deploy_id is "null" or empty
            internal_url = CLOUD_YOLOV4_API_URL
            logger.info(f"Using cloud URL: {internal_url}")
            headers = {"Authorization": f"Bearer {CLOUD_YOLOV4_API_AUTH_TOKEN}"}
            logger.info(f"Using cloud auth token: {CLOUD_YOLOV4_API_AUTH_TOKEN}")
        else:
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            headers = {"Authorization": f"Bearer {CLOUD_YOLOV4_API_AUTH_TOKEN}"}
            
        # construct file to send
        pil_image = Image.open(image)
        pil_image = pil_image.resize((320, 320))  # Resize to target dimensions
        buf = io.BytesIO()
        pil_image.save(
            buf,
            format="JPEG",
        )
        byte_im = buf.getvalue()
        file = {"file": byte_im}
        
        try:
            # log request
            logger.info(f"internal_url:={internal_url}")
            logger.info(f"headers:={headers}")
            # logger.info(f"file:={file}")
            inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
            inference_data.raise_for_status()
        except requests.exceptions.HTTPError as http_err:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)


class ImageGenerationInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special image generation inference view that performs special file handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            prompt = data.get("prompt")  # we should only receive 1 prompt
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            try:
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}

                if "/v1/images/generations" in internal_url:
                    # Synchronous OpenAI-compatible API — returns base64 JSON immediately
                    inference_data = requests.post(
                        internal_url,
                        json={"prompt": prompt},
                        headers=headers,
                        timeout=2000,
                    )
                    inference_data.raise_for_status()
                    resp_json = inference_data.json()
                    if "images" in resp_json:
                        b64_image = resp_json["images"][0]
                    else:
                        b64_image = resp_json["data"][0]["b64_json"]
                    image_bytes = base64.b64decode(b64_image)
                    django_response = HttpResponse(image_bytes, content_type="image/jpeg")
                    django_response["Content-Disposition"] = "attachment; filename=image.jpg"
                    return django_response
                else:
                    # Legacy enqueue/poll/fetch API
                    inference_data = requests.post(
                        internal_url, json={"prompt": prompt}, headers=headers, timeout=5
                    )
                    inference_data.raise_for_status()

                    ready_latest = False
                    task_id = inference_data.json().get("task_id")
                    get_status_url = internal_url.replace("/enqueue", f"/status/{task_id}")
                    while not ready_latest:
                        latest_prompt = requests.get(get_status_url, headers=headers)
                        if latest_prompt.status_code != status.HTTP_404_NOT_FOUND:
                            latest_prompt.raise_for_status()
                            if latest_prompt.json()["status"] == "Completed":
                                ready_latest = True
                        time.sleep(1)

                    get_image_url = internal_url.replace("/enqueue", f"/fetch_image/{task_id}")
                    latest_image = requests.get(get_image_url, headers=headers, stream=True)
                    latest_image.raise_for_status()
                    content_type = latest_image.headers.get("Content-Type", "application/octet-stream")
                    django_response = HttpResponse(latest_image.content, content_type=content_type)
                    django_response["Content-Disposition"] = "attachment; filename=image.png"
                    return django_response

            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                    return Response(status=status.HTTP_503_SERVICE_UNAVAILABLE)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class VideoGenerationInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """Video generation inference view for tt-media-server T2V API."""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        deploy_id = data.get("deploy_id")
        prompt = data.get("prompt")
        if not prompt:
            return Response({"error": "prompt is required"}, status=status.HTTP_400_BAD_REQUEST)

        deploy = get_deploy_cache()[deploy_id]
        internal_url = "http://" + deploy["internal_url"]
        headers = {"Authorization": f"Bearer {TTS_API_KEY}"}

        payload = {"prompt": prompt}
        if data.get("seed") is not None:
            try:
                payload["seed"] = int(data["seed"])
            except (TypeError, ValueError):
                pass
        if data.get("num_inference_steps") is not None:
            try:
                payload["num_inference_steps"] = int(data["num_inference_steps"])
            except (TypeError, ValueError):
                pass

        try:
            init_resp = requests.post(internal_url, json=payload, headers=headers, timeout=30)
            init_resp.raise_for_status()

            # Sync mode: server returned video bytes directly (use_async_video=False)
            if init_resp.status_code == status.HTTP_200_OK:
                content_type = init_resp.headers.get("Content-Type", "video/mp4")
                django_response = HttpResponse(init_resp.content, content_type=content_type)
                django_response["Content-Disposition"] = "attachment; filename=video.mp4"
                return django_response

            # Async mode: server returned 202 with job_id — return it immediately so the
            # frontend can poll status (see VideoGenerationStatusView) and then download
            # (VideoGenerationDownloadView). The blocking poll loop used to live here.
            job_data = init_resp.json()
            job_id = job_data.get("job_id") or job_data.get("id")
            if not job_id:
                logger.error(f"No job_id in async response: {job_data}")
                return Response({"error": "No job_id in response"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response({"job_id": job_id}, status=status.HTTP_202_ACCEPTED)

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"VideoGenerationInferenceView HTTP error: {http_err}")
            try:
                err_status = http_err.response.status_code
            except AttributeError:
                err_status = 0
            if err_status == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif err_status == status.HTTP_503_SERVICE_UNAVAILABLE:
                return Response(status=status.HTTP_503_SERVICE_UNAVAILABLE)
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as exc:
            logger.error(f"VideoGenerationInferenceView unexpected error: {exc}")
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _video_base_url(deploy_id):
    """Resolve the tt-media-server base URL for a deployed video model."""
    deploy = get_deploy_cache()[deploy_id]
    internal_url = "http://" + deploy["internal_url"]
    return internal_url.replace("/v1/videos/generations", "").rstrip("/")


def _normalize_video_phase(raw_status):
    """Map the tt-media-server status string to a coarse phase for the frontend."""
    s = (raw_status or "").lower()
    if s in ("completed", "complete", "done", "success"):
        return "completed"
    if s in ("failed", "error"):
        return "failed"
    if s in ("cancelled", "canceled", "cancelling", "canceling"):
        return "cancelled"
    if s in ("in_progress", "running", "processing"):
        return "in_progress"
    return "queued"


class VideoGenerationStatusView(APIView):
    """Proxy the tt-media-server video job status so the frontend can poll progress."""

    def get(self, request, job_id, *args, **kwargs):
        deploy_id = request.query_params.get("deploy_id")
        if not deploy_id:
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            base_url = _video_base_url(deploy_id)
            headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            poll_url = f"{base_url}/v1/videos/generations/{job_id}"
            poll_resp = requests.get(poll_url, headers=headers, timeout=30)
            poll_resp.raise_for_status()

            phase = _normalize_video_phase(poll_resp.json().get("status"))
            return Response({"phase": phase}, status=status.HTTP_200_OK)

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"VideoGenerationStatusView HTTP error: {http_err}")
            try:
                err_status = http_err.response.status_code
            except AttributeError:
                err_status = status.HTTP_500_INTERNAL_SERVER_ERROR
            return Response(status=err_status or status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as exc:
            logger.error(f"VideoGenerationStatusView unexpected error: {exc}")
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class VideoGenerationDownloadView(APIView):
    """Proxy the finished video file from the tt-media-server."""

    def get(self, request, job_id, *args, **kwargs):
        deploy_id = request.query_params.get("deploy_id")
        if not deploy_id:
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            base_url = _video_base_url(deploy_id)
            headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            download_url = f"{base_url}/v1/videos/generations/{job_id}/download"
            dl_resp = requests.get(download_url, headers=headers, timeout=60)
            dl_resp.raise_for_status()

            content_type = dl_resp.headers.get("Content-Type", "video/mp4")
            django_response = HttpResponse(dl_resp.content, content_type=content_type)
            django_response["Content-Disposition"] = "attachment; filename=video.mp4"
            return django_response

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"VideoGenerationDownloadView HTTP error: {http_err}")
            try:
                err_status = http_err.response.status_code
            except AttributeError:
                err_status = status.HTTP_500_INTERNAL_SERVER_ERROR
            return Response(status=err_status or status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as exc:
            logger.error(f"VideoGenerationDownloadView unexpected error: {exc}")
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SpeechRecognitionInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special automatic speec recognition inference view"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            audio_file = data.get("file")  # we should only receive 1 file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
            file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
            try:
                inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response(inference_data.json(), status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class SpeechRecognitionInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling for cloud speech recognition"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        
        # Get audio file directly instead of using serializer
        audio_file = data.get("file")
        if not audio_file:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        # Get deploy_id and handle the case where it's the string "null"
        deploy_id = data.get("deploy_id")
        if deploy_id == "null" or not deploy_id:
            # Use cloud URL when deploy_id is "null" or empty
            internal_url = CLOUD_SPEECH_RECOGNITION_URL
            if not internal_url:
                return Response(
                    {"error": "Cloud speech recognition URL not configured"}, 
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            logger.info(f"Using cloud URL: {internal_url}")
            headers = {"Authorization": f"Bearer {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}"}
            logger.info(f"Using cloud auth token: {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}")
        else:
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
            
        file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
        
        try:
            # log request
            logger.info(f"internal_url:={internal_url}")
            logger.info(f"headers:={headers}")
            inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
            inference_data.raise_for_status()
        except requests.exceptions.HTTPError as http_err:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)

class FaceRecognitionRecognizeView(APIView):
    """Proxy view for face recognition - recognize faces in an image"""
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")

        deploy_id = data.get("deploy_id")
        image = data.get("image")
        if not image:
            return Response({"error": "image is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/recognize-face"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            files = {"image": (image.name, image.file, image.content_type)}
            inference_data = requests.post(internal_url, files=files, headers=headers, timeout=30)
            inference_data.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                return Response({"error": "Models not loaded"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face recognition error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)


class FaceRecognitionRegisterView(APIView):
    """Proxy view for face recognition - register a new face"""
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")

        deploy_id = data.get("deploy_id")
        image = data.get("image")
        name = data.get("name")

        if not image:
            return Response({"error": "image is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not name:
            return Response({"error": "name is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/register-face"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            files = {"image": (image.name, image.file, image.content_type)}
            form_data = {"name": name}
            inference_data = requests.post(internal_url, files=files, data=form_data, headers=headers, timeout=30)
            inference_data.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif inference_data.status_code == status.HTTP_409_CONFLICT:
                return Response({"error": "Identity already exists"}, status=status.HTTP_409_CONFLICT)
            elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                return Response({"error": "Models not loaded"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face registration error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)


class FaceRecognitionListView(APIView):
    """Proxy view for face recognition - list registered faces"""
    def get(self, request, *args, **kwargs):
        deploy_id = request.query_params.get("deploy_id")
        logger.info(f"{self.__class__.__name__} deploy_id:={deploy_id}")

        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/registered-faces"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            response = requests.get(internal_url, headers=headers, timeout=10)
            response.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face list error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(response.json(), status=status.HTTP_200_OK)


class FaceRecognitionDeleteView(APIView):
    """Proxy view for face recognition - delete a registered face"""
    def delete(self, request, name, *args, **kwargs):
        deploy_id = request.query_params.get("deploy_id")
        logger.info(f"{self.__class__.__name__} deploy_id:={deploy_id} name:={name}")

        if not deploy_id or deploy_id == "null":
            return Response({"error": "deploy_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not name:
            return Response({"error": "name is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            deploy = get_deploy_cache()[deploy_id]
            base_url = "http://" + deploy["internal_url"].rsplit('/', 1)[0]
            internal_url = f"{base_url}/registered-faces/{name}"
        except KeyError:
            return Response({"error": f"No deployment found for {deploy_id}"}, status=status.HTTP_404_NOT_FOUND)

        try:
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            response = requests.delete(internal_url, headers=headers, timeout=10)
            response.raise_for_status()
        except requests.exceptions.Timeout:
            return Response({"error": "Request timeout"}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except requests.exceptions.HTTPError:
            if response.status_code == status.HTTP_404_NOT_FOUND:
                return Response({"error": f"Identity '{name}' not found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as e:
            logger.error(f"Face delete error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(response.json(), status=status.HTTP_200_OK)


class ImageGenerationInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special image generation inference view that performs special file handling"""
        data = request.data
        logger.info(f"{self.__class__.__name__} received request data: {data}")
        
        # Get prompt directly since we don't need deploy_id validation for cloud
        prompt = data.get("prompt")
        if not prompt:
            logger.error("No prompt provided in request")
            return Response({"error": "prompt is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        logger.info(f"Processing prompt: {prompt}")
        base_url = CLOUD_STABLE_DIFFUSION_URL
        if not base_url:
            logger.error("Cloud stable diffusion URL not configured")
            return Response(
                {"error": "Cloud stable diffusion URL not configured"}, 
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        try:
            headers = {"Authorization": f"Bearer {CLOUD_STABLE_DIFFUSION_AUTH_TOKEN}"}
            data = {"prompt": prompt}
            
            # Use /enqueue endpoint for initial request
            enqueue_url = f"{base_url}/enqueue"
            logger.info(f"Making request to cloud endpoint: {enqueue_url}")
            logger.info(f"Request headers: {headers}")
            logger.info(f"Request data: {data}")
            
            inference_data = requests.post(enqueue_url, json=data, headers=headers, timeout=5)
            inference_data.raise_for_status()
            logger.info(f"Initial request successful, response: {inference_data.json()}")

            # begin fetch status loop
            ready_latest = False
            task_id = inference_data.json().get("task_id")
            logger.info(f"Got task_id: {task_id}")
            status_url = f"{base_url}/status/{task_id}"
            logger.info(f"Status check URL: {status_url}")
            
            while (not ready_latest):
                logger.info(f"Checking status for task {task_id}")
                latest_prompt = requests.get(status_url, headers=headers)
                if latest_prompt.status_code != status.HTTP_404_NOT_FOUND:
                    latest_prompt.raise_for_status()
                    status_data = latest_prompt.json()
                    logger.info(f"Status response: {status_data}")
                    if status_data["status"] == "Completed":
                        ready_latest = True
                        logger.info("Task completed successfully")
                time.sleep(1)

            # call get_image to get image
            image_url = f"{base_url}/fetch_image/{task_id}"
            logger.info(f"Fetching image from: {image_url}")
            latest_image = requests.get(image_url, headers=headers, stream=True)
            latest_image.raise_for_status()
            logger.info("Successfully retrieved image")
            
            content_type = latest_image.headers.get('Content-Type', 'application/octet-stream')
            content_disposition = f'attachment; filename=image.png'
            
            # Create a Django HttpResponse with the content of the file from Flask
            django_response = HttpResponse(latest_image.content, content_type=content_type)
            django_response['Content-Disposition'] = content_disposition
            logger.info("Returning image response")
            return django_response

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"HTTP Error occurred: {str(http_err)}")
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                logger.error("Unauthorized access to cloud endpoint")
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            elif inference_data.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                logger.error("Cloud service unavailable")
                return Response(status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                logger.error(f"Unexpected error: {str(http_err)}")
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class SpeechRecognitionInferenceView(APIView):
    def post(self, request, *args, **kwargs):
        """special automatic speec recognition inference view"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            audio_file = data.get("file")  # we should only receive 1 file
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
            file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
            try:
                inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
                inference_data.raise_for_status()
            except requests.exceptions.HTTPError as http_err:
                if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                    return Response(status=status.HTTP_401_UNAUTHORIZED)
                else:
                    return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            return Response(inference_data.json(), status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class SpeechRecognitionInferenceCloudView(APIView):
    def post(self, request, *args, **kwargs):
        """special inference view that performs special handling for cloud speech recognition"""
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        
        # Get audio file directly instead of using serializer
        audio_file = data.get("file")
        if not audio_file:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        # Get deploy_id and handle the case where it's the string "null"
        deploy_id = data.get("deploy_id")
        if deploy_id == "null" or not deploy_id:
            # Use cloud URL when deploy_id is "null" or empty
            internal_url = CLOUD_SPEECH_RECOGNITION_URL
            if not internal_url:
                return Response(
                    {"error": "Cloud speech recognition URL not configured"}, 
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            logger.info(f"Using cloud URL: {internal_url}")
            headers = {"Authorization": f"Bearer {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}"}
            logger.info(f"Using cloud auth token: {CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN}")
        else:
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
            
        file = {"file": (audio_file.name, audio_file, audio_file.content_type)}
        
        try:
            # log request
            logger.info(f"internal_url:={internal_url}")
            logger.info(f"headers:={headers}")
            inference_data = requests.post(internal_url, files=file, headers=headers, timeout=5)
            inference_data.raise_for_status()
        except requests.exceptions.HTTPError as http_err:
            if inference_data.status_code == status.HTTP_401_UNAUTHORIZED:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(inference_data.json(), status=status.HTTP_200_OK)

class TtsInferenceView(APIView):
    """Text-to-speech inference: supports both OpenAI-style and enqueue-style endpoints."""
    def post(self, request, *args, **kwargs):
        data = request.data
        logger.info(f"{self.__class__.__name__} data:={data}")
        serializer = InferenceSerializer(data=data)
        if serializer.is_valid():
            deploy_id = data.get("deploy_id")
            text = data.get("text") or data.get("prompt")
            if not text:
                return Response({"error": "text is required"}, status=status.HTTP_400_BAD_REQUEST)
            deploy = get_deploy_cache()[deploy_id]
            internal_url = "http://" + deploy["internal_url"]
            try:
                model_impl = deploy.get("model_impl")
                model_name = getattr(model_impl, "model_name", None) if model_impl else None
                inference_engine = getattr(model_impl, "inference_engine", None)
                
                if inference_engine == "media":
                    headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
                    payload = {"model": model_name, "text": text, "voice": "default"}
                else:
                    headers = {"Authorization": f"Bearer {encoded_jwt}"}
                    payload = {"model": model_name, "input": text, "voice": "default"}
                
                audio_resp = requests.post(internal_url, json=payload, headers=headers, timeout=120)
                
                # If 404 on /enqueue for TTS media model, retry with /v1/audio/speech
                if audio_resp.status_code == 404 and inference_engine == "media" and "/enqueue" in internal_url:
                    logger.info(f"TTS 404 on {internal_url}, retrying with /v1/audio/speech")
                    fallback_url = internal_url.replace("/enqueue", "/v1/audio/speech")
                    audio_resp = requests.post(fallback_url, json=payload, headers=headers, timeout=120)
                
                audio_resp.raise_for_status()

                content_type = audio_resp.headers.get("Content-Type", "audio/wav")
                django_response = HttpResponse(audio_resp.content, content_type=content_type)
                django_response["Content-Disposition"] = "attachment; filename=tts_output.wav"
                django_response["Cache-Control"] = "no-cache, no-store, must-revalidate"
                return django_response

            except requests.exceptions.HTTPError as http_err:
                logger.error(f"TTS HTTP error: {http_err}")
                return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class OpenAIAudioSpeechView(APIView):
    """OpenAI-compatible POST /v1/audio/speech — looks up deployed TTS model by name."""
    def post(self, request, *args, **kwargs):
        data = request.data
        model_name = data.get("model")
        text = data.get("input") or data.get("text")
        if not model_name:
            return Response({"error": "model is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not text:
            return Response({"error": "input is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Find a running TTS deployment matching the requested model name
        deploy = None
        for entry in get_deploy_cache().values():
            impl = entry.get("model_impl")
            if impl and getattr(impl, "model_name", None) == model_name:
                deploy = entry
                break
        if deploy is None:
            return Response(
                {"error": f"No running deployment found for model '{model_name}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        internal_url = "http://" + deploy["internal_url"]
        try:
            model_impl = deploy.get("model_impl")
            inference_engine = getattr(model_impl, "inference_engine", None)
            
            if inference_engine == "media":
                headers = {"Authorization": f"Bearer {TTS_API_KEY}"}
                payload = {"model": model_name, "text": text, "voice": data.get("voice", "default")}
            else:
                headers = {"Authorization": f"Bearer {encoded_jwt}"}
                payload = {"model": model_name, "input": text, "voice": data.get("voice", "default")}
            
            audio_resp = requests.post(internal_url, json=payload, headers=headers, timeout=120)
            
            # If 404 on /enqueue for TTS media model, retry with /v1/audio/speech
            if audio_resp.status_code == 404 and inference_engine == "media" and "/enqueue" in internal_url:
                logger.info(f"OpenAI audio/speech 404 on {internal_url}, retrying with /v1/audio/speech")
                fallback_url = internal_url.replace("/enqueue", "/v1/audio/speech")
                audio_resp = requests.post(fallback_url, json=payload, headers=headers, timeout=120)
            
            audio_resp.raise_for_status()

            content_type = audio_resp.headers.get("Content-Type", "audio/wav")
            django_response = HttpResponse(audio_resp.content, content_type=content_type)
            django_response["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return django_response

        except requests.exceptions.HTTPError as http_err:
            logger.error(f"OpenAI audio/speech HTTP error: {http_err}")
            return Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ContainerLogsView(View):
    # Define event detection configuration before the get method
    SIMPLE_EVENT_KEYWORDS = [
        '[ERROR]', '[FATAL]', '[CRITICAL]',
        '[WARN]', '[WARNING]',
        'RESPONSE_Q OUT OF SYNC',
        'ABORTED', 'CORE DUMPED',
        'TERMINATED', 'EXCEPTION',
        'DESTINATION UNREACHABLE',
        'CLUSTER GENERATION FAILED',
        'APPLICATION STARTUP COMPLETE',
        'UVICORN RUNNING ON',
        'STARTED SERVER PROCESS',
        'WAITING FOR APPLICATION STARTUP',
        'WH_ARCH_YAML:',
        'PLATFORM LINUX',
        'PYTEST-',
        'ROOTDIR:',
        'PLUGINS:'
    ]
    
    @staticmethod
    def _is_complex_event(line_upper):
        """
        Check for event patterns that require multiple keyword combinations.
        
        Args:
            line_upper: Uppercase version of the log line
            
        Returns:
            bool: True if line matches a complex event pattern
        """
        if 'DEVICE |' in line_upper and 'OPENING USER MODE DEVICE DRIVER' in line_upper:
            return True

        if 'SILICONDRIVER' in line_upper and ('OPENED PCI DEVICE' in line_upper or 'DETECTED PCI' in line_upper):
            return True
        
        if 'SOFTWARE VERSION' in line_upper and 'ETHERNET FW VERSION' in line_upper:
            return True
        
        if 'COLLECTED' in line_upper and 'ITEM' in line_upper:
            return True
        
        return False
    
    @classmethod
    def _determine_message_type(cls, line):
        """
        Determine if a log line should be classified as an event or regular log.
        
        Args:
            line: The log line to classify
            
        Returns:
            str: Either "event" or "log"
        """
        line_upper = line.upper()
        
        # Check simple keyword patterns
        if any(keyword in line_upper for keyword in cls.SIMPLE_EVENT_KEYWORDS):
            return "event"
        
        # Check complex multi-keyword patterns
        if cls._is_complex_event(line_upper):
            return "event"
        
        return "log"
    
    async def get(self, request, container_id, *args, **kwargs):
        """Stream logs from a Docker container using Server-Sent Events via docker-control-service"""
        logger.info(f"ContainerLogsView received request for container_id: {container_id}")

        try:
            logger.info("Getting docker-control-service client")
            from docker_control.docker_control_client import get_docker_client
            client = get_docker_client()

            logger.info(f"Setting up log stream for container: {container_id}")

            async def generate_container_data():
                queue: asyncio.Queue = asyncio.Queue()
                loop = asyncio.get_running_loop()

                def sync_stream():
                    try:
                        for log_line in client.get_logs_stream(container_id, follow=True, tail=100):
                            loop.call_soon_threadsafe(queue.put_nowait, log_line)

                    except requests.exceptions.ConnectionError as e:
                        logger.error(f"docker-control-service unreachable: {str(e)}")
                        error_data = {
                            "type": "service_unavailable",
                            "message": "Cannot reach the docker-control-service (port 8002). Make sure it is running on the host.",
                            "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        }
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            f"data: {json.dumps(error_data)}\n\n".encode('utf-8')
                        )

                    except Exception as e:
                        logger.error(f"Error in data stream: {str(e)}")
                        error_data = {
                            "type": "error",
                            "message": f"Error streaming data: {str(e)}",
                            "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        }
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            f"data: {json.dumps(error_data)}\n\n".encode('utf-8')
                        )

                    finally:
                        loop.call_soon_threadsafe(queue.put_nowait, None)

                thread = threading.Thread(target=sync_stream, daemon=True)
                thread.start()

                while True:
                    chunk = await queue.get()
                    if chunk is None:
                        break
                    yield chunk

            response = StreamingHttpResponse(
                generate_container_data(),
                content_type='text/event-stream'
            )

            # Set required headers for SSE
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'

            return response

        except Exception as e:
            logger.error(f"Error streaming container data: {str(e)}")

            async def error_stream():
                error_data = {
                    "type": "service_unavailable",
                    "message": f"Failed to initialize log stream: {str(e)}",
                    "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                yield f"data: {json.dumps(error_data)}\n\n".encode('utf-8')

            response = StreamingHttpResponse(error_stream(), content_type='text/event-stream')
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'
            return response


class ModelAPIInfoView(APIView):
    """Get API endpoint information for deployed models"""
    def get(self, request, *args, **kwargs):
        """Return API endpoint details for all deployed models"""
        try:
            deployed_data = get_deploy_cache()
            api_info = {}
            
            for deploy_id, deploy_info in deployed_data.items():
                # Get the base URL from the request
                base_url = request.build_absolute_uri('/').rstrip('/')
                
                # Extract model information
                model_impl = deploy_info.get("model_impl", {})
                model_name = getattr(model_impl, "model_name", "Unknown") if model_impl else "Unknown"
                model_type_obj = getattr(model_impl, "model_type", None) if model_impl else None
                model_type = getattr(model_type_obj, "value", "ChatModel") if model_type_obj else "ChatModel"
                
                # Get internal URL and port bindings for external URL construction
                internal_url = deploy_info.get("internal_url", "")
                health_url = deploy_info.get("health_url", "")
                port_bindings = deploy_info.get("port_bindings", {})
                
                # Construct external URLs using port bindings
                chat_completions_url = ""
                completions_url = ""
                health_endpoint_url = ""
                
                if internal_url and port_bindings:
                    # Extract the service port from internal_url (e.g., "container_name:7000/v1/chat/completions" -> "7000")
                    service_port = None
                    if ":" in internal_url:
                        service_port = internal_url.split(":")[1].split("/")[0]
                    
                    # Find the external port mapping for this service port
                    external_host = "localhost"  # Default to localhost for external access
                    external_port = None
                    
                    # Look for the port binding that matches the service port
                    for container_port, host_bindings in port_bindings.items():
                        if container_port and host_bindings:
                            # container_port format: "7000/tcp"
                            container_port_num = container_port.split("/")[0]
                            if container_port_num == service_port:
                                # host_bindings format: [{"HostIp": "0.0.0.0", "HostPort": "8013"}]
                                if host_bindings and len(host_bindings) > 0:
                                    external_port = host_bindings[0].get("HostPort")
                                    host_ip = host_bindings[0].get("HostIp", "0.0.0.0")
                                    # Use localhost for external access instead of 0.0.0.0
                                    if host_ip == "0.0.0.0":
                                        external_host = "localhost"
                                    else:
                                        external_host = host_ip
                                break
                    
                    # Construct external URLs if we found the port mapping
                    if external_port:
                        base_external_url = f"http://{external_host}:{external_port}"
                        chat_completions_url = f"{base_external_url}/v1/chat/completions"
                        completions_url = f"{base_external_url}/v1/completions"
                        health_endpoint_url = f"{base_external_url}/health"
                    else:
                        # Fallback to internal URL if no port mapping found
                        logger.warning(f"No port mapping found for service port {service_port} in {deploy_id}")
                        if internal_url:
                            # Extract hostname:port from internal_url
                            if "/v1/chat/completions" in internal_url:
                                base_internal_url = internal_url.replace("/v1/chat/completions", "")
                            elif "/v1/completions" in internal_url:
                                base_internal_url = internal_url.replace("/v1/completions", "")
                            else:
                                base_internal_url = internal_url
                            
                            chat_completions_url = f"http://{base_internal_url}/v1/chat/completions"
                            completions_url = f"http://{base_internal_url}/v1/completions"
                            health_endpoint_url = f"http://{health_url}" if health_url else f"http://{base_internal_url}/health"
                
                # Generate JWT token for this model
                team_id = os.getenv("TEAM_ID", "tenstorrent")
                token_id = os.getenv("TOKEN_ID", "debug-test")
                json_payload = {"team_id": team_id, "token_id": token_id}
                jwt_secret = backend_config.jwt_secret
                encoded_jwt = jwt.encode(json_payload, jwt_secret, algorithm="HS256")
                
                # Create example payload based on model type
                example_payload = self._get_example_payload(model_type, deploy_info)
                
                # Create curl examples for both chat completions and completions APIs
                chat_curl_example = self._get_chat_curl_example(chat_completions_url, encoded_jwt, deploy_info)
                completions_curl_example = self._get_completions_curl_example(completions_url, encoded_jwt, deploy_info)

                # For non-LLM models the container does not serve /v1/chat/completions,
                # so expose the matching TT-Studio backend proxy route instead. The route
                # is relative (the frontend prepends its own origin) because behind the
                # proxy the backend cannot resolve a host-reachable absolute URL.
                proxy_path = self._get_endpoint_path(model_type)
                inference_route = f"/models-api{proxy_path}" if proxy_path else None

                api_info[deploy_id] = {
                    "model_name": model_name,
                    "model_type": model_type,
                    "hf_model_id": getattr(model_impl, "hf_model_id", None) if model_impl else None,
                    "jwt_secret": jwt_secret,
                    "jwt_token": encoded_jwt,
                    "example_payload": example_payload,
                    "chat_curl_example": chat_curl_example,
                    "completions_curl_example": completions_curl_example,
                    "internal_url": internal_url,
                    "health_url": health_url,
                    "endpoints": {
                        "chat_completions": chat_completions_url,
                        "completions": completions_url,
                        "health": health_endpoint_url,
                        "tt_studio_backend": f"{base_url}/models-api/inference/"
                    },
                    "inference_route": inference_route,
                    "deploy_info": {
                        "model_impl": {
                            "model_name": getattr(model_impl, "model_name", None) if model_impl else None,
                            "hf_model_id": getattr(model_impl, "hf_model_id", None) if model_impl else None,
                            "model_type": model_type,  # Use the string value instead of the enum object
                        } if model_impl else {},
                        "internal_url": internal_url,
                        "health_url": health_url
                    }
                }
            
            return Response(api_info, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error getting API info: {str(e)}")
            return Response(
                {"error": "Failed to get API information", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def _get_endpoint_path(self, model_type):
        """Get the backend proxy route for a non-LLM model type.

        Keys are ModelTypes enum values. Returns None for chat-like models
        (chat/vlm/mock), which keep the direct-container chat/completions flow.
        """
        endpoint_map = {
            "image_generation": "/image-generation/",
            "object_detection": "/object-detection/",
            "speech_recognition": "/speech-recognition/",
            "tts": "/tts/",
        }
        return endpoint_map.get(model_type)

    def _get_example_payload(self, model_type, deploy_info):
        """Get example payload based on model type"""
        # Get the actual deploy_id for this specific model
        deploy_id = None
        current_model_impl = deploy_info.get("model_impl", {})
        current_model_name = getattr(current_model_impl, "model_name", None) if current_model_impl else None
        
        for did, dinfo in get_deploy_cache().items():
            dinfo_model_impl = dinfo.get("model_impl", {})
            dinfo_model_name = getattr(dinfo_model_impl, "model_name", None) if dinfo_model_impl else None
            if dinfo_model_name == current_model_name:
                deploy_id = did
                break
        
        # Get the HF model ID for the model
        hf_model_id = getattr(current_model_impl, "hf_model_id", "meta-llama/Llama-3.2-1B-Instruct") if current_model_impl else "meta-llama/Llama-3.2-1B-Instruct"
        
        if model_type == "ChatModel":
            # Return OpenAI-compatible format for direct model testing
            return {
                "model": hf_model_id,
                "messages": [
                    {
                        "role": "user",
                        "content": "What is Tenstorrent?"
                    }
                ],
                "temperature": 0.7,
                "max_tokens": 100,
                "stream": False
            }
        elif model_type == "ImageGeneration":
            return {
                "deploy_id": deploy_id or "your_deploy_id",
                "prompt": "A beautiful sunset over mountains"
            }
        elif model_type == "ObjectDetectionModel":
            return {
                "deploy_id": deploy_id or "your_deploy_id",
                "image": "base64_encoded_image_or_file_upload"
            }
        elif model_type == "SpeechRecognitionModel":
            return {
                "deploy_id": deploy_id or "your_deploy_id",
                "file": "audio_file_upload"
            }
        
        # Fallback for unknown model types
        return {
            "deploy_id": deploy_id or "your_deploy_id",
            "prompt": "What is Tenstorrent?",
            "temperature": 1.0,
            "top_k": 20,
            "top_p": 0.9,
            "max_tokens": 128,
            "stream": True,
            "stop": ["<|eot_id|>"]
        }
    
    def _get_chat_curl_example(self, chat_url, jwt_token, deploy_info):
        """Generate curl example for chat completions API"""
        if not chat_url:
            return "# Chat completions endpoint not available"
        
        model_impl = deploy_info.get("model_impl", {})
        hf_model_id = getattr(model_impl, "hf_model_id", "your-model-name") if model_impl else "your-model-name"
        
        return f"""curl -X POST "{chat_url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -d '{{
    "model": "{hf_model_id}",
    "messages": [
      {{
        "role": "user",
        "content": "What is Tenstorrent?"
      }}
    ],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": false
  }}'"""
    
    def _get_completions_curl_example(self, completions_url, jwt_token, deploy_info):
        """Generate curl example for completions API"""
        if not completions_url:
            return "# Completions endpoint not available"
        
        model_impl = deploy_info.get("model_impl", {})
        hf_model_id = getattr(model_impl, "hf_model_id", "your-model-name") if model_impl else "your-model-name"
        
        return f"""curl -X POST "{completions_url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -d '{{
    "model": "{hf_model_id}",
    "prompt": "What is Tenstorrent?",
    "temperature": 0.9,
    "top_k": 20,
    "top_p": 0.9,
    "max_tokens": 128,
    "stream": false,
    "stop": ["<|eot_id|>"]
  }}'"""
    
    def _get_curl_example(self, api_url, jwt_token, payload, model_type):
        """Generate curl example for the API endpoint (legacy method)"""
        if model_type == "ObjectDetectionModel":
            return f"""curl -X POST "{api_url}" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -H "Content-Type: multipart/form-data" \\
  -F "deploy_id=your_deploy_id" \\
  -F "image=@your_image.jpg"
"""
        elif model_type == "SpeechRecognitionModel":
            return f"""curl -X POST "{api_url}" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -H "Content-Type: multipart/form-data" \\
  -F "deploy_id=your_deploy_id" \\
  -F "file=@your_audio.wav"
"""
        else:
            # For JSON payloads (Chat models)
            json_payload = json.dumps(payload, indent=2)
            return f"""curl -X POST "{api_url}" \\
  -H "Authorization: Bearer {jwt_token}" \\
  -H "Content-Type: application/json" \\
  -d '{json_payload}'
"""


# Coding-agent gateway support (LiteLLM). Eligibility (the model allowlist + rule)
# is the SSOT in shared_config.coding_agent_config.
from shared_config.coding_agent_config import (  # noqa: E402
    is_coding_agent_eligible,
    get_gateway_model_names,
    resolve_thinking_variant,
)

LITELLM_UPSTREAM_KEY = os.environ.get("LITELLM_UPSTREAM_KEY", "")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
LITELLM_PORT = int(os.environ.get("LITELLM_PORT", "4000"))
LITELLM_INTERNAL_URL = os.environ.get("LITELLM_INTERNAL_URL", "http://tt-studio-litellm:4000")

# Round-robin cursor per model_name for multi-chip / duplicate deployments
_rr_lock = threading.Lock()
_rr_counters: dict[str, int] = {}


def _running_coding_agent_deploys() -> list[tuple[str, dict]]:
    """Return [(deploy_id, entry), ...] for running, coding-agent-eligible deployments.

    Eligibility is decided by is_coding_agent_eligible (shared_config SSOT).
    Resilient to deploy-cache failures (e.g. docker-control-service down): logs
    and returns an empty list so callers degrade gracefully instead of 500ing.
    """
    out = []
    try:
        cache = get_deploy_cache()
    except Exception as e:
        logger.warning(f"coding-agents: deploy cache unavailable: {e}")
        return out
    for deploy_id, entry in cache.items():
        impl = entry.get("model_impl")
        if not entry.get("internal_url") or not is_coding_agent_eligible(impl):
            continue
        out.append((deploy_id, entry))
    return out


def _resolve_deploy_by_model_name(model_name: str):
    """Find a running CHAT/VLM deployment whose friendly model_name matches.

    Matches the catalog `model_impl.model_name` (what the UI shows and the user
    types), falling back to `cached_model_name`/`hf_model_id`. Round-robins
    across duplicates (e.g. the same model deployed on multiple chips).
    """
    matches = [
        entry
        for _, entry in _running_coding_agent_deploys()
        if model_name
        in (
            getattr(entry.get("model_impl"), "model_name", None),
            entry.get("cached_model_name"),
            getattr(entry.get("model_impl"), "hf_model_id", None),
        )
    ]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    with _rr_lock:
        idx = _rr_counters.get(model_name, 0)
        _rr_counters[model_name] = (idx + 1) % len(matches)
    return matches[idx % len(matches)]


def _check_upstream_auth(request) -> bool:
    """Validate the LiteLLM -> backend shared secret. True if authorized."""
    if not LITELLM_UPSTREAM_KEY:
        return True
    auth = request.headers.get("Authorization", "")
    token = auth[len("Bearer "):].strip() if auth.startswith("Bearer ") else ""
    return token == LITELLM_UPSTREAM_KEY


@method_decorator(csrf_exempt, name="dispatch")
class OpenAIChatCompletionsView(View):
    """OpenAI-compatible /v1/chat/completions upstream for the LiteLLM gateway.

    Resolves the OpenAI `model` field (a friendly catalog name) to a running
    deployment and proxies to its vLLM container, reusing the same streaming
    machinery as the in-app chat (`stream_response_from_external_api`).
    """

    async def post(self, request, *args, **kwargs):
        if not _check_upstream_auth(request):
            return JsonResponse({"error": {"message": "Unauthorized"}}, status=401)

        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": {"message": "Invalid JSON"}}, status=400)

        # Reasoning models are exposed as both "<name>" and "<name>-thinking";
        # both resolve to the same deployment but flip vLLM's enable_thinking flag.
        base_model, enable_thinking = resolve_thinking_variant(data.get("model"))
        deploy = await asyncio.to_thread(_resolve_deploy_by_model_name, base_model)
        if deploy is None:
            return JsonResponse(
                {"error": {"message": f"No running model named '{base_model}'.",
                           "type": "model_not_found"}},
                status=404,
            )
        if enable_thinking is not None:
            ctk_raw = data.get("chat_template_kwargs")
            ctk = ctk_raw if isinstance(ctk_raw, dict) else {}
            ctk["enable_thinking"] = enable_thinking
            data["chat_template_kwargs"] = ctk

        internal_url = "http://" + deploy["internal_url"]
        data["model"] = deploy.get("cached_model_name") or get_model_name_from_container(
            deploy["internal_url"], fallback=deploy["model_impl"].hf_model_id
        )

        # Clamp max_tokens to 75% of the context window (same policy as InferenceView).
        raw_limit = deploy.get("max_model_len") or get_max_tokens_limit(
            deploy["model_impl"].param_count
        )
        max_tokens_limit = max(1, raw_limit * 3 // 4)
        if data.get("max_tokens"):
            data["max_tokens"] = min(int(data["max_tokens"]), max_tokens_limit)

        # Base/completion models: convert messages -> prompt and route accordingly.
        service_route = deploy["model_impl"].service_route
        if service_route == "/v1/completions":
            messages = data.pop("messages", [])
            data["prompt"] = messages_to_prompt(messages)
            data.pop("stream_options", None)

        stream = bool(data.get("stream", False))

        if stream:
            async def generate():
                try:
                    # Clean OpenAI SSE passthrough (no injected stream_options /
                    # stats trailer) so the gateway emits spec-compliant chunks.
                    async for chunk in stream_openai_passthrough(internal_url, data):
                        yield chunk
                except Exception as e:
                    logger.error(f"OpenAIChatCompletionsView stream error: {e}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"

            response = StreamingHttpResponse(generate(), content_type="text/event-stream")
            response["Cache-Control"] = "no-cache"
            response["X-Accel-Buffering"] = "no"
            return response

        # Non-streaming: proxy the JSON response from vLLM verbatim via the shared
        # pooled client (avoids a fresh connection pool per request).
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        try:
            upstream = await _vllm_client.post(internal_url, json=data, headers=headers)
            return JsonResponse(upstream.json(), status=upstream.status_code, safe=False)
        except Exception as e:
            logger.error(f"OpenAIChatCompletionsView non-stream error: {e}")
            return JsonResponse({"error": {"message": str(e)}}, status=502)


class OpenAIModelsView(APIView):
    """OpenAI-compatible /v1/models listing of deployed chat models.

    Powers LiteLLM `check_provider_endpoint` discovery (and therefore Claude
    Code's `/model` picker via CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).
    """

    def get(self, request, *args, **kwargs):
        if not _check_upstream_auth(request):
            return Response({"error": {"message": "Unauthorized"}},
                            status=status.HTTP_401_UNAUTHORIZED)
        seen = set()
        data = []
        for _, entry in _running_coding_agent_deploys():
            name = getattr(entry.get("model_impl"), "model_name", None)
            if not name:
                continue
            for exposed in get_gateway_model_names(name):
                if exposed in seen:
                    continue
                seen.add(exposed)
                data.append({"id": exposed, "object": "model", "owned_by": "tt-studio"})
        return Response({"object": "list", "data": data}, status=status.HTTP_200_OK)


class CodingAgentsView(APIView):
    """Info for the frontend 'Coding Agents' page: gateway health, key, models.

    Returns host-relative info only; the frontend builds absolute URLs from
    window.location.hostname so remote / port-forwarded access works.
    """

    def get(self, request, *args, **kwargs):
        health = "disabled"
        if LITELLM_MASTER_KEY:
            try:
                resp = requests.get(f"{LITELLM_INTERNAL_URL}/health/liveliness", timeout=2)
                health = "healthy" if resp.status_code == 200 else "unreachable"
            except requests.RequestException:
                health = "unreachable"

        models = []
        seen = set()
        for _, entry in _running_coding_agent_deploys():
            impl = entry.get("model_impl")
            name = getattr(impl, "model_name", None)
            if not name:
                continue
            mtype = getattr(getattr(impl, "model_type", None), "value", "chat")
            for exposed in get_gateway_model_names(name):
                if exposed in seen:
                    continue
                seen.add(exposed)
                models.append({"name": exposed, "type": mtype})

        return Response(
            {
                "litellm_enabled": bool(LITELLM_MASTER_KEY),
                "health": health,
                "gateway_port": LITELLM_PORT,
                "openai_base_path": "/v1",
                "master_key": LITELLM_MASTER_KEY,
                "models": models,
            },
            status=status.HTTP_200_OK,
        )
