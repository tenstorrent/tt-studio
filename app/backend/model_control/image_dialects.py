# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Image-generation API dialects.

TT Studio drives image models over three different HTTP contracts, because the
serving stacks below it were designed independently:

* ``openai`` — ``POST /v1/images/generations``, synchronous, base64 in the JSON
  response. What tt-media-server exposes for its OpenAI-compatible image models.
* ``media``  — ``POST /enqueue`` → poll ``/status/<id>`` → ``GET /fetch_image/<id>``.
  tt-media-server's older job API.
* ``tt_dit`` — ``POST /generate`` → poll ``/jobs/<id>`` → ``GET /jobs/<id>/image``.
  tt-metal's DiT models (``models.tt_dit.server.*``) serving HTTP directly,
  without tt-media-server in front. Diffusion on accelerators takes minutes per
  image, so this stack is job-based by design and exposes diffusion-native knobs
  (steps, guidance scale, seed, height, width) that the OpenAI image contract
  has no place for.

A dialect is data, not control flow: adding a fourth serving stack should mean
adding a row here, not another branch in the inference view. Keeping the job
polling in one place also means a new stack inherits the terminal-state and
error handling the existing ones already have.
"""

from dataclasses import dataclass, field
from typing import Mapping, Optional
from urllib.parse import urlsplit, urlunsplit

# Optional generation parameters we forward when the caller supplies them, keyed
# by the request field TT Studio accepts. Only the tt_dit contract models these;
# the others silently ignore anything beyond the prompt.
_DIT_PARAMS = {
    "num_inference_steps": "num_inference_steps",
    "guidance_scale": "guidance_scale",
    "seed": "seed",
    "height": "height",
    "width": "width",
}


@dataclass(frozen=True)
class ImageDialect:
    """One image-generation HTTP contract.

    ``mode`` is "sync" (the image comes back on the submit call) or "job" (submit
    returns an id, then poll for a terminal state and fetch the bytes). Templates
    are relative to the server root, so they compose with whatever host/port the
    deployment happens to be on.
    """

    name: str
    submit_route: str
    mode: str
    job_id_field: str = ""
    status_template: str = ""
    image_template: str = ""
    # Compared case-insensitively: tt-media-server says "Completed", tt_dit "done".
    done_states: frozenset = frozenset()
    error_states: frozenset = frozenset()
    extra_params: Mapping[str, str] = field(default_factory=dict)
    # Image media type to report when the server does not say (the sync dialect
    # hands us raw base64 with no content type of its own).
    default_content_type: str = "image/png"
    default_filename: str = "image.png"


OPENAI = ImageDialect(
    name="openai",
    submit_route="/v1/images/generations",
    mode="sync",
    # Historic behaviour: the base64 payload is re-served as JPEG.
    default_content_type="image/jpeg",
    default_filename="image.jpg",
)

MEDIA = ImageDialect(
    name="media",
    submit_route="/enqueue",
    mode="job",
    job_id_field="task_id",
    status_template="/status/{job_id}",
    image_template="/fetch_image/{job_id}",
    done_states=frozenset({"completed"}),
    error_states=frozenset({"failed", "error", "cancelled"}),
)

TT_DIT = ImageDialect(
    name="tt_dit",
    submit_route="/generate",
    mode="job",
    job_id_field="job_id",
    status_template="/jobs/{job_id}",
    image_template="/jobs/{job_id}/image",
    # models/tt_dit/server/flux2/jobs.py: JobStatus = queued|running|done|error|cancelled
    done_states=frozenset({"done"}),
    error_states=frozenset({"error", "cancelled"}),
    extra_params=_DIT_PARAMS,
)

# Longest submit_route first so "/v1/images/generations" is tested before any
# shorter route that could also appear as a suffix.
DIALECTS = tuple(sorted((OPENAI, MEDIA, TT_DIT), key=lambda d: -len(d.submit_route)))

# Routes we can recognise in a container's OpenAPI document, most specific first.
_ROUTE_TO_DIALECT = {d.submit_route: d for d in DIALECTS}


def split_route(internal_url: str) -> tuple[str, str]:
    """Split a stored internal_url into (server_root, route).

    ``internal_url`` is built as ``<host>:<port><service_route>``, so the route is
    just its path. Returns ("", url) when the url carries no path to speak of.
    """
    parts = urlsplit(internal_url)
    path = parts.path or ""
    root = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    return root, path


def resolve_dialect(internal_url: str) -> ImageDialect:
    """Pick the dialect for a deployment's stored internal_url.

    Matches on the route the deployment was registered with. Falls back to MEDIA,
    which is what this code path did unconditionally before other stacks existed —
    an unrecognised route is more likely an older media server than a new contract
    we would only guess at.
    """
    _, path = split_route(internal_url)
    for route, dialect in _ROUTE_TO_DIALECT.items():
        if path.endswith(route):
            return dialect
    return MEDIA


def dialect_from_openapi(paths) -> Optional[ImageDialect]:
    """Identify the dialect a live container serves from its OpenAPI paths.

    ``paths`` is the ``paths`` object of an OpenAPI document (any mapping of route
    -> operations). Returns None when the container serves no image route we know,
    which is a positive signal in its own right: there is no point registering it
    as an image model TT Studio can drive.
    """
    served = set(paths or ())
    for route, dialect in _ROUTE_TO_DIALECT.items():
        if route in served:
            return dialect
    return None
