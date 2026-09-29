# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for image-generation dialect resolution.

The route shapes and job-status values here are taken from real servers:
tt-media-server's ``/enqueue`` + ``/v1/images/generations`` contracts, and
tt-metal's DiT server (``models/tt_dit/server/flux2/``), whose OpenAPI document
and ``JobStatus`` enum were read off a running FLUX.2-dev container.
"""

from model_control.image_dialects import (
    MEDIA,
    OPENAI,
    PREDICT,
    TT_DIT,
    dialect_from_openapi,
    resolve_dialect,
    split_route,
)

# The paths object served by a real FLUX.2-dev tt-dit container.
FLUX2_PATHS = [
    "/health",
    "/generate",
    "/jobs",
    "/jobs/{job_id}",
    "/jobs/{job_id}/image",
    "/jobs/{job_id}/cancel",
]


class TestResolveDialect:
    def test_tt_dit_generate_route(self):
        assert resolve_dialect("http://flux2:7010/generate") is TT_DIT

    def test_openai_images_route(self):
        assert resolve_dialect("http://sd:7000/v1/images/generations") is OPENAI

    def test_media_enqueue_route(self):
        assert resolve_dialect("http://media:7000/enqueue") is MEDIA

    def test_unrecognised_route_falls_back_to_media(self):
        # Back-compat: this code path was unconditionally the media contract
        # before other stacks existed.
        assert resolve_dialect("http://thing:7000/something-else") is MEDIA

    def test_resolves_without_a_scheme(self):
        # internal_url is stored as "<host>:<port><route>".
        assert resolve_dialect("flux2:7010/generate") is TT_DIT


class TestSplitRoute:
    def test_splits_root_from_route(self):
        root, path = split_route("http://flux2:7010/generate")
        assert root == "http://flux2:7010"
        assert path == "/generate"

    def test_job_templates_compose_onto_the_root(self):
        root, _ = split_route("http://flux2:7010/generate")
        assert root + TT_DIT.status_template.format(job_id="abc") == (
            "http://flux2:7010/jobs/abc"
        )
        assert root + TT_DIT.image_template.format(job_id="abc") == (
            "http://flux2:7010/jobs/abc/image"
        )


class TestDialectFromOpenapi:
    def test_identifies_tt_dit_from_served_routes(self):
        assert dialect_from_openapi(FLUX2_PATHS) is TT_DIT

    def test_identifies_openai_image_server(self):
        assert dialect_from_openapi(["/v1/images/generations", "/health"]) is OPENAI

    def test_identifies_community_predict_server(self):
        # changh95/qwen-image-2.1-p150 (tt-model package): /predict + a stub
        # /v1/models. The stub must not make it look like a chat server.
        paths = ["/predict", "/health", "/info", "/v1/models"]
        assert dialect_from_openapi(paths) is PREDICT
        assert resolve_dialect("http://qwen-image:20000/predict") is PREDICT
        assert PREDICT.mode == "sync"
        assert PREDICT.b64_fields == ("image",)

    def test_chat_server_is_not_an_image_dialect(self):
        # A vLLM container serves no image route: returning None is what keeps it
        # from being registered as an image model.
        assert dialect_from_openapi(["/v1/models", "/v1/chat/completions"]) is None

    def test_no_paths(self):
        assert dialect_from_openapi([]) is None
        assert dialect_from_openapi(None) is None


class TestJobStateVocabulary:
    def test_tt_dit_terminal_states_match_the_server_enum(self):
        # models/tt_dit/server/flux2/jobs.py: queued|running|done|error|cancelled
        assert "done" in TT_DIT.done_states
        assert {"error", "cancelled"} <= TT_DIT.error_states
        assert not ({"queued", "running"} & (TT_DIT.done_states | TT_DIT.error_states))

    def test_media_completed_state_is_matched_lowercased(self):
        # tt-media-server reports "Completed"; the view lowercases before comparing.
        assert "Completed".lower() in MEDIA.done_states

    def test_only_diffusion_native_dialects_forward_params(self):
        assert "num_inference_steps" in TT_DIT.extra_params
        # /predict spells the step count differently; the request field is the same.
        assert PREDICT.extra_params["num_inference_steps"] == "num_steps"
        assert not MEDIA.extra_params
        assert not OPENAI.extra_params
