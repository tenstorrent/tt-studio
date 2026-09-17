# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for the OCR endpoint.

No hardware and no deployed model: the upstream chat/completions call is mocked,
so what is under test is the part that belongs to TT-Studio -- turning uploaded
files into a valid vision request, preserving page order, bounding the pixels,
and mapping upstream failures onto sensible status codes.

The pixel bound is the one worth guarding. PaddleOCR-VL's processor caps an
image at 1280 merged tokens, and the vision tower compiles a fixed set of
buckets sized to that cap, so an oversized upload has to be scaled before it
reaches the model rather than after.
"""

import io
import os

import pytest
from PIL import Image

import django  # noqa: E402
from django.conf import settings as django_settings  # noqa: E402


def _bootstrap_django():
    """Configure Django for this module.

    If the caller has already chosen settings -- which is the case inside the
    backend container, where ``DJANGO_SETTINGS_MODULE=api.settings`` is set --
    use them. Otherwise configure the smallest settings that let DRF route a
    request, so these tests stay runnable outside the container: the project's
    INSTALLED_APPS pulls in vector_db_control and therefore chromadb, which has
    nothing to do with OCR.

    The choice is made before calling setup() rather than by trying the project
    settings and recovering, because a setup() that fails midway leaves the app
    registry loading and populate() is not reentrant.
    """
    if os.environ.get("DJANGO_SETTINGS_MODULE"):
        django.setup()
        return os.environ["DJANGO_SETTINGS_MODULE"]

    django_settings.configure(
        DEBUG=True,
        SECRET_KEY="test",
        ALLOWED_HOSTS=["*"],
        # The project apps reached transitively by importing the view; they
        # declare Django models, so they must be installed. vector_db_control is
        # deliberately absent -- it is the one that drags in chromadb.
        INSTALLED_APPS=[
            "django.contrib.contenttypes",
            "django.contrib.auth",
            "rest_framework",
            "board_control",
            "docker_control",
            "model_control",
        ],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
        ROOT_URLCONF="model_control.test_ocr_view",
    )
    django.setup()
    return "minimal"


DJANGO_MODE = _bootstrap_django()

from django.urls import path  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from model_control import views  # noqa: E402

# Used as ROOT_URLCONF in the fallback mode above, so the route under test is
# reachable without importing the project's whole URL tree.
urlpatterns = [path("models/ocr/", views.OcrInferenceView.as_view())]

OCR_URL = "/models/ocr/"
DEPLOY_ID = "deadbeefcafe"


def _png(width: int, height: int, colour=(240, 240, 240)) -> io.BytesIO:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(buf, format="PNG")
    buf.seek(0)
    buf.name = f"{width}x{height}.png"
    return buf


class _Resp:
    """Minimal stand-in for a requests.Response from the model server."""

    def __init__(self, text="TEXT", finish="stop", status_code=200):
        self.status_code = status_code
        self._text = text
        self._finish = finish

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [{"message": {"content": self._text}, "finish_reason": self._finish}],
            "usage": {"prompt_tokens": 269, "completion_tokens": 7, "total_tokens": 276},
        }


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def deployed(monkeypatch):
    """Pretend one OCR model is deployed, without touching Docker."""
    monkeypatch.setattr(
        views,
        "get_deploy_cache",
        lambda: {
            DEPLOY_ID: {
                "internal_url": "ocr-container:7000/v1/chat/completions",
                "cached_model_name": "PaddlePaddle/PaddleOCR-VL-1.6",
                "max_model_len": 8192,
            }
        },
    )
    monkeypatch.setattr(views, "auth_headers", lambda deploy: {"Authorization": "Bearer test"})
    return DEPLOY_ID


def test_requires_at_least_one_image(client, deployed):
    resp = client.post(OCR_URL, {"deploy_id": deployed}, format="multipart")
    assert resp.status_code == 400
    assert "image" in resp.json()["error"].lower()


def test_unknown_deploy_id_is_404(client, monkeypatch):
    monkeypatch.setattr(views, "get_deploy_cache", lambda: {})
    resp = client.post(OCR_URL, {"deploy_id": "nope", "images": _png(56, 56)}, format="multipart")
    assert resp.status_code == 404


def test_pages_come_back_in_upload_order(client, deployed, monkeypatch):
    seen = []

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.append(json)
        return _Resp(text=f"page-{len(seen)}")

    monkeypatch.setattr(views.requests, "post", fake_post)

    first, second = _png(56, 56), _png(84, 56)
    resp = client.post(
        OCR_URL, {"deploy_id": deployed, "images": [first, second]}, format="multipart"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [p["index"] for p in body["pages"]] == [0, 1]
    assert [p["text"] for p in body["pages"]] == ["page-1", "page-2"]
    # The concatenation is what a caller reads when they do not care about pages.
    assert body["text"] == "page-1\n\n---\n\npage-2"
    assert len(seen) == 2


def test_request_shape_is_a_vision_chat_completion(client, deployed, monkeypatch):
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["body"] = json
        captured["headers"] = headers
        return _Resp()

    monkeypatch.setattr(views.requests, "post", fake_post)
    client.post(OCR_URL, {"deploy_id": deployed, "images": _png(56, 56)}, format="multipart")

    assert captured["url"] == "http://ocr-container:7000/v1/chat/completions"
    body = captured["body"]
    # Greedy, so the same page always reads the same way.
    assert body["temperature"] == 0
    assert body["stream"] is False
    assert body["model"] == "PaddlePaddle/PaddleOCR-VL-1.6"
    content = body["messages"][0]["content"]
    # Image first, prompt second: the order the model card and the vLLM recipe use.
    assert content[0]["type"] == "image_url"
    assert content[0]["image_url"]["url"].startswith("data:image/")
    assert content[1] == {"type": "text", "text": "OCR:"}
    assert captured["headers"]["Authorization"] == "Bearer test"


def test_prompt_and_max_tokens_are_overridable(client, deployed, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        views.requests, "post", lambda url, json=None, **kw: (captured.update(body=json), _Resp())[1]
    )
    client.post(
        OCR_URL,
        {
            "deploy_id": deployed,
            "images": _png(56, 56),
            "prompt": "Table Recognition:",
            "max_tokens": "64",
        },
        format="multipart",
    )
    assert captured["body"]["messages"][0]["content"][1]["text"] == "Table Recognition:"
    assert captured["body"]["max_tokens"] == 64


def test_max_tokens_is_clamped_to_the_context_window(client, deployed, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        views.requests, "post", lambda url, json=None, **kw: (captured.update(body=json), _Resp())[1]
    )
    client.post(
        OCR_URL,
        {"deploy_id": deployed, "images": _png(56, 56), "max_tokens": "999999"},
        format="multipart",
    )
    # 75% of the deployment's max_model_len, matching InferenceView.
    assert captured["body"]["max_tokens"] == int(8192 * 0.75)


def _sent_images(captured) -> list:
    import base64

    out = []
    for body in captured:
        url = body["messages"][0]["content"][0]["image_url"]["url"]
        out.append(Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))))
    return out


def test_a_page_too_large_for_one_pass_is_read_in_strips(client, deployed, monkeypatch):
    """The cap is honoured per request, and a big page is split rather than shrunk.

    Shrinking a 9 MP page to fit costs about 3x linear resolution, which is
    enough to make small text unreadable before the model sees it. Strips keep
    each request inside the cap without throwing pixels away.
    """
    captured = []
    monkeypatch.setattr(
        views.requests, "post", lambda url, json=None, **kw: (captured.append(json), _Resp())[1]
    )
    client.post(OCR_URL, {"deploy_id": deployed, "images": _png(3000, 3000)}, format="multipart")

    sent = _sent_images(captured)
    assert len(sent) > 1, "a 9 MP page should not be read in a single pass"
    for img in sent:
        assert img.size[0] * img.size[1] <= views.OCR_MAX_PIXELS
    # Strips run the full width, so they are wider than they are tall.
    assert all(img.size[0] > img.size[1] for img in sent)


def test_an_image_that_fits_is_sent_whole_and_unstretched(client, deployed, monkeypatch):
    """Anything inside the cap goes in one request with its aspect ratio intact."""
    captured = []
    monkeypatch.setattr(
        views.requests, "post", lambda url, json=None, **kw: (captured.append(json), _Resp())[1]
    )
    client.post(OCR_URL, {"deploy_id": deployed, "images": _png(1000, 1000)}, format="multipart")

    sent = _sent_images(captured)
    assert len(sent) == 1
    assert sent[0].size[0] * sent[0].size[1] <= views.OCR_MAX_PIXELS
    assert abs(sent[0].size[0] / sent[0].size[1] - 1.0) < 0.05


def test_strip_count_is_reported_per_page(client, deployed, monkeypatch):
    """A caller can tell how a page was read, which explains an odd seam."""
    monkeypatch.setattr(views.requests, "post", lambda *a, **kw: _Resp(text="x"))
    resp = client.post(
        OCR_URL, {"deploy_id": deployed, "images": _png(3000, 3000)}, format="multipart"
    )
    assert resp.status_code == 200
    assert resp.json()["pages"][0]["tiles"] > 1


def test_undersized_image_is_left_alone(client, deployed, monkeypatch):
    import base64

    captured = {}
    monkeypatch.setattr(
        views.requests, "post", lambda url, json=None, **kw: (captured.update(body=json), _Resp())[1]
    )
    client.post(OCR_URL, {"deploy_id": deployed, "images": _png(448, 448)}, format="multipart")

    url = captured["body"]["messages"][0]["content"][0]["image_url"]["url"]
    sent = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
    assert sent.size == (448, 448)


def test_upstream_timeout_is_504(client, deployed, monkeypatch):
    def boom(*a, **kw):
        raise views.requests.exceptions.Timeout()

    monkeypatch.setattr(views.requests, "post", boom)
    resp = client.post(OCR_URL, {"deploy_id": deployed, "images": _png(56, 56)}, format="multipart")
    assert resp.status_code == 504


def test_unreachable_model_is_502(client, deployed, monkeypatch):
    def boom(*a, **kw):
        raise views.requests.exceptions.ConnectionError("refused")

    monkeypatch.setattr(views.requests, "post", boom)
    resp = client.post(OCR_URL, {"deploy_id": deployed, "images": _png(56, 56)}, format="multipart")
    assert resp.status_code == 502


def test_upstream_error_body_is_surfaced(client, deployed, monkeypatch):
    class Failing(_Resp):
        def raise_for_status(self):
            err = views.requests.exceptions.HTTPError("400")
            err.response = type(
                "R", (), {"text": "limit-mm-per-prompt exceeded", "status_code": 400}
            )()
            raise err

    monkeypatch.setattr(views.requests, "post", lambda *a, **kw: Failing())
    resp = client.post(OCR_URL, {"deploy_id": deployed, "images": _png(56, 56)}, format="multipart")
    assert resp.status_code == 400
    # The upstream message is what tells a caller which limit they hit.
    assert "limit-mm-per-prompt" in resp.json()["error"]


def test_no_deploy_id_without_cloud_url_is_503(client, monkeypatch):
    monkeypatch.setattr(views, "CLOUD_OCR_URL", None)
    resp = client.post(OCR_URL, {"images": _png(56, 56)}, format="multipart")
    assert resp.status_code == 503


def test_no_deploy_id_uses_the_cloud_endpoint(client, monkeypatch):
    captured = {}
    monkeypatch.setattr(views, "CLOUD_OCR_URL", "http://external:8100/v1/chat/completions")
    monkeypatch.setattr(views, "CLOUD_OCR_AUTH_TOKEN", "tok")
    monkeypatch.setattr(
        views.requests,
        "post",
        lambda url, json=None, headers=None, **kw: (
            captured.update(url=url, headers=headers),
            _Resp(text="external"),
        )[1],
    )
    resp = client.post(OCR_URL, {"images": _png(56, 56)}, format="multipart")
    assert resp.status_code == 200
    assert captured["url"] == "http://external:8100/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer tok"
    assert resp.json()["pages"][0]["text"] == "external"


def test_an_unreadable_upload_does_not_fail_the_batch(client, deployed, monkeypatch):
    monkeypatch.setattr(views.requests, "post", lambda *a, **kw: _Resp(text="good"))

    junk = io.BytesIO(b"this is not an image")
    junk.name = "junk.png"
    resp = client.post(
        OCR_URL, {"deploy_id": deployed, "images": [junk, _png(56, 56)]}, format="multipart"
    )
    assert resp.status_code == 200
    pages = resp.json()["pages"]
    assert "error" in pages[0]
    assert pages[1]["text"] == "good"
