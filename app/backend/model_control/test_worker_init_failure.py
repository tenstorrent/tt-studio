# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for reporting a media/forge deploy whose worker died during startup.

tt-media-server never restarts a worker that dies during device init, and its
/health keeps answering "Model is not ready", which TT-Studio showed as
"Starting" forever. The log lines below are verbatim from v0.23.0 containers.
"""

import os
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from rest_framework.test import APIRequestFactory

from model_control import views
from model_control.log_classifier import classify_startup_phase, find_worker_init_failure
from shared_config.model_type_config import ModelTypes

MOCHI_DEAD = [
    "2026-10-07 02:20:51,805 - ERROR - Device 0,1,2,3: Mochi pipeline creation failed",
    "2026-10-07 02:20:51,806 - ERROR - Device 0,1,2,3: Exception during model loading",
    "2026-10-07 02:20:51,809 - ERROR - Failed to get device runner: Mochi has only been successfully tested on 2x2",
    "2026-10-07 02:20:51,809 - WARNING - Worker 0,1,2,3 error count is : 1",
    "2026-10-07 02:20:51,810 - ERROR - Error in worker -1: Mochi has only been successfully tested on 2x2",
]
FALCON_DEAD = [
    "2026-10-06 19:07:21,782 - ERROR - [warmup] async failed after 0.2357 seconds. Error: PermissionError at /home/container_app_user/cache_root/huggingface when downloading tiiuae/Falcon3-7B-Instruct.",
    "2026-10-06 19:07:21,783 - ERROR - Worker 0 device init failed: PermissionError at /home/container_app_user/cache_root/huggingface when downloading tiiuae/Falcon3-7B-Instruct.",
    "2026-10-06 19:07:21,784 - ERROR - Error in worker -1: PermissionError at /home/container_app_user/cache_root/huggingface when downloading tiiuae/Falcon3-7B-Instruct.",
]
# A healthy media server: a per-request worker error (real worker id) and the
# /health access lines must not read as an init failure.
HEALTHY = [
    "2026-10-07 00:12:01,100 - INFO - Worker 0 is ready",
    "2026-10-07 00:13:40,200 - ERROR - Error in worker 2: prompt too long",
    'INFO:     172.17.0.1:43490 - "GET /health HTTP/1.1" 200 OK',
]


def test_finds_the_failure_line():
    assert find_worker_init_failure(MOCHI_DEAD) == (
        "Failed to get device runner: Mochi has only been successfully tested on 2x2"
    )
    assert find_worker_init_failure(FALCON_DEAD).startswith(
        "Worker 0 device init failed: PermissionError"
    )


def test_ignores_healthy_media_logs():
    assert find_worker_init_failure(HEALTHY) is None
    assert find_worker_init_failure([]) is None


def test_classifier_reports_failure_for_any_template():
    # Falcon3 is a chat model served by the forge media server, so this must not
    # depend on the media phase template.
    for model_type in ("chat", "image_generation"):
        phase = classify_startup_phase(iter(FALCON_DEAD), model_type=model_type)
        assert phase["worker_init_failure"].startswith("Worker 0 device init failed")
    assert classify_startup_phase(HEALTHY, model_type="chat")["worker_init_failure"] is None


def test_failure_stays_latched_after_it_scrolls_out_of_the_tail():
    deploy_id = "latched-deploy"
    try:
        first = classify_startup_phase(MOCHI_DEAD, model_type="video_generation")
        views._apply_phase_latch(deploy_id, first)
        later = classify_startup_phase(
            ['INFO:     172.17.0.1:43490 - "GET /health HTTP/1.1" 500 Internal Server Error'] * 200,
            model_type="video_generation",
        )
        assert views._apply_phase_latch(deploy_id, later)["worker_init_failure"] == (
            "Failed to get device runner: Mochi has only been successfully tested on 2x2"
        )
    finally:
        views._drop_phase_latch(deploy_id)


def _health(phase):
    deploy = {
        "health_url": "mochi:7000/tt-liveness",
        "model_impl": SimpleNamespace(model_type=ModelTypes.VIDEO),
        "jwt_secret": None,
    }
    request = APIRequestFactory().get("/models/health/", {"deploy_id": "abc"})
    with patch("model_control.views.get_deploy_cache", return_value={"abc": deploy}), patch(
        "model_control.serializers.get_deploy_cache", return_value={"abc": deploy}
    ), patch(
        "model_control.views.health_check", return_value=(None, "Model is not ready")
    ), patch("model_control.views._get_startup_phase", return_value=phase):
        return views.ModelHealthView.as_view()(request)


def test_dead_worker_is_reported_unavailable_with_the_reason():
    response = _health(classify_startup_phase(MOCHI_DEAD, model_type="video_generation"))
    assert response.status_code == 503
    assert response.data["message"] == "Unavailable"
    assert "Mochi has only been successfully tested on 2x2" in response.data["details"]


def test_a_warming_model_is_still_starting():
    response = _health(classify_startup_phase(HEALTHY[:1], model_type="video_generation"))
    assert response.status_code == 202
    assert response.data["message"] == "Starting"
