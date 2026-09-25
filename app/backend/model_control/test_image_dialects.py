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
    submit_url,
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


# The paths object of changh95/qwen-image-2.1-p150's server
# (models/experimental/qwen_image_2_1/server/app.py).
QWEN_IMAGE_PATHS = ["/health", "/info", "/v1/models", "/predict"]


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

    def test_only_tt_dit_forwards_diffusion_params(self):
        assert "num_inference_steps" in TT_DIT.extra_params
        assert not MEDIA.extra_params
        assert not OPENAI.extra_params


class TestServedRouteResolution:
    """A community tt-dit bundle registers no route; its OpenAPI names the contract."""

    def test_a_routeless_deployment_asks_the_container(self):
        assert resolve_dialect("http://qwen:7000", lambda: QWEN_IMAGE_PATHS) is PREDICT
        assert resolve_dialect("http://flux2:7000", lambda: FLUX2_PATHS) is TT_DIT

    def test_a_registered_route_needs_no_probe(self):
        def probe():
            raise AssertionError("probed despite a known route")

        assert resolve_dialect("http://flux2:7010/generate", probe) is TT_DIT

    def test_nothing_recognised_still_falls_back_to_media(self):
        assert resolve_dialect("http://thing:7000", lambda: {}) is MEDIA

    def test_predict_alone_does_not_identify_an_image_model(self):
        # Too generic a route: a detection server could serve it too.
        assert dialect_from_openapi(QWEN_IMAGE_PATHS) is None
        assert dialect_from_openapi(QWEN_IMAGE_PATHS, image_model=True) is PREDICT


class TestSubmitUrl:
    def test_a_registered_route_is_kept(self):
        url = "http://media:7000/api/enqueue"
        assert submit_url(url, MEDIA) == url

    def test_a_routeless_deployment_gets_the_dialect_route(self):
        assert submit_url("http://qwen:7000", PREDICT) == "http://qwen:7000/predict"
