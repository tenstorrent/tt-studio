# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Generating one image on a deployed image model, whatever stack serves it.

Shared by TT-Studio's own image page and the OpenAI-compatible
/v1/images/generations route companion apps (Open WebUI) call, so both drive every
serving stack through the same dialect handling (see image_dialects).
"""

import base64
import time
from typing import Mapping, Optional, Tuple

import requests

from model_control.image_dialects import resolve_dialect, split_route, submit_url
from shared_config.logger_config import get_logger
from shared_config.user_config import get_tts_api_key

logger = get_logger(__name__)

# Upper bound on a single image-generation job. FLUX.2 at 1024x1024/50 steps is
# minutes of work, so this is a stuck-job backstop, not a performance budget.
IMAGE_JOB_TIMEOUT_SECONDS = 30 * 60


class ImageGenerationError(Exception):
    """A generation that failed, with the HTTP status to report it as."""

    def __init__(self, status_code: int, message: Optional[str] = None):
        super().__init__(message or f"image generation failed ({status_code})")
        self.status_code = status_code
        self.message = message


def _openapi_paths(server_root: str, headers: dict) -> dict:
    """The routes a container's OpenAPI document lists, or {} when it has none."""
    try:
        resp = requests.get(f"{server_root}/openapi.json", headers=headers, timeout=5)
        resp.raise_for_status()
        return resp.json().get("paths") or {}
    except (requests.RequestException, ValueError):
        return {}


def generate_image(
    deploy: dict, prompt: str, params: Optional[Mapping] = None
) -> Tuple[bytes, str]:
    """Generate one image; returns ``(image_bytes, content_type)``.

    ``params`` supplies the optional diffusion knobs a job dialect forwards
    (steps, guidance, seed, size). Raises ImageGenerationError on failure.
    """
    params = params or {}
    internal_url = "http://" + deploy["internal_url"]
    headers = {"Authorization": f"Bearer {get_tts_api_key() or ''}"}
    server_root, _ = split_route(internal_url)
    dialect = resolve_dialect(
        internal_url, served_paths=lambda: _openapi_paths(server_root, headers)
    )
    submit = submit_url(internal_url, dialect)
    logger.info(f"image generation via '{dialect.name}' dialect at {submit}")

    try:
        if dialect.mode == "sync":
            # The image comes back on the submit call as base64 JSON.
            response = requests.post(
                submit, json={"prompt": prompt}, headers=headers, timeout=2000
            )
            response.raise_for_status()
            body = response.json()
            if "images" in body:
                b64_image = body["images"][0]
            elif "image" in body:
                b64_image = body["image"]
            else:
                b64_image = body["data"][0]["b64_json"]
            return base64.b64decode(b64_image), dialect.default_content_type

        # Job dialects: submit -> poll for a terminal state -> fetch bytes.
        payload = {"prompt": prompt}
        for req_field, server_field in dialect.extra_params.items():
            value = params.get(req_field)
            if value is not None:
                payload[server_field] = value

        response = requests.post(submit, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        job_id = response.json().get(dialect.job_id_field)
        if not job_id:
            logger.error(
                f"{dialect.name}: submit response carried no "
                f"'{dialect.job_id_field}'; cannot track the job"
            )
            raise ImageGenerationError(502)

        status_url = server_root + dialect.status_template.format(job_id=job_id)
        image_url = server_root + dialect.image_template.format(job_id=job_id)

        # Diffusion on accelerators runs for minutes, so this poll is bounded
        # generously; it exists to stop a wedged job from hanging the request
        # forever, not to second-guess a slow-but-healthy generation.
        deadline = time.time() + IMAGE_JOB_TIMEOUT_SECONDS
        while True:
            if time.time() > deadline:
                logger.error(
                    f"{dialect.name}: job {job_id} did not finish within "
                    f"{IMAGE_JOB_TIMEOUT_SECONDS}s"
                )
                raise ImageGenerationError(504)

            poll = requests.get(status_url, headers=headers, timeout=30)
            # A job id can briefly 404 before the server registers it.
            if poll.status_code != 404:
                poll.raise_for_status()
                job_state = str(poll.json().get("status", "")).lower()
                if job_state in dialect.done_states:
                    break
                if job_state in dialect.error_states:
                    detail = poll.json().get("error")
                    logger.error(
                        f"{dialect.name}: job {job_id} ended as '{job_state}': {detail}"
                    )
                    raise ImageGenerationError(
                        502, detail or f"Generation {job_state}."
                    )
            time.sleep(1)

        image = requests.get(image_url, headers=headers, stream=True, timeout=120)
        image.raise_for_status()
        return image.content, image.headers.get(
            "Content-Type", dialect.default_content_type
        )
    except requests.exceptions.HTTPError as e:
        code = e.response.status_code if e.response is not None else None
        raise ImageGenerationError(code if code in (401, 503) else 500) from e
