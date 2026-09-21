# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import importlib
import sys
from types import ModuleType, SimpleNamespace

import pytest


def _load_views(monkeypatch):
    class _DummyResponse:
        def __init__(self, data=None, status=200, **_kwargs):
            self.data = data
            self.status_code = status

    class _DummyLogger:
        def exception(self, *_args, **_kwargs):
            pass

        def warning(self, *_args, **_kwargs):
            pass

        def info(self, *_args, **_kwargs):
            pass

    django_http = ModuleType("django.http")
    django_http.HttpResponse = _DummyResponse
    django_http.JsonResponse = _DummyResponse
    django_http.StreamingHttpResponse = _DummyResponse
    monkeypatch.setitem(sys.modules, "django.http", django_http)

    django_utils_decorators = ModuleType("django.utils.decorators")
    django_utils_decorators.method_decorator = (
        lambda *_args, **_kwargs: (lambda obj: obj)
    )
    monkeypatch.setitem(
        sys.modules, "django.utils.decorators", django_utils_decorators
    )

    django_views = ModuleType("django.views")
    django_views.View = type("View", (), {})
    monkeypatch.setitem(sys.modules, "django.views", django_views)

    django_views_csrf = ModuleType("django.views.decorators.csrf")
    django_views_csrf.csrf_exempt = lambda func: func
    monkeypatch.setitem(sys.modules, "django.views.decorators.csrf", django_views_csrf)

    model_utils = ModuleType("model_control.model_utils")
    model_utils.get_deploy_cache = lambda: {}
    monkeypatch.setitem(sys.modules, "model_control.model_utils", model_utils)

    backend_config = ModuleType("shared_config.backend_config")
    backend_config.backend_config = SimpleNamespace(
        persistent_storage_volume="/tmp/tt-studio-test"
    )
    monkeypatch.setitem(sys.modules, "shared_config.backend_config", backend_config)

    logger_config = ModuleType("shared_config.logger_config")
    logger_config.get_logger = lambda _name: _DummyLogger()
    monkeypatch.setitem(sys.modules, "shared_config.logger_config", logger_config)

    model_config = ModuleType("shared_config.model_config")
    model_config.model_implmentations = []
    monkeypatch.setitem(sys.modules, "shared_config.model_config", model_config)

    model_type_config = ModuleType("shared_config.model_type_config")
    model_type_config.ModelTypes = SimpleNamespace(TRAINING="TRAINING")
    monkeypatch.setitem(
        sys.modules, "shared_config.model_type_config", model_type_config
    )

    user_config = ModuleType("shared_config.user_config")
    user_config.get_tts_api_key = lambda: None
    monkeypatch.setitem(sys.modules, "shared_config.user_config", user_config)

    sys.modules.pop("training_control.views", None)
    package = sys.modules.get("training_control")
    if package is not None and hasattr(package, "views"):
        delattr(package, "views")
    return importlib.import_module("training_control.views")


@pytest.fixture
def views_module(monkeypatch):
    views = _load_views(monkeypatch)
    yield views
    sys.modules.pop("training_control.views", None)
    package = sys.modules.get("training_control")
    if package is not None and hasattr(package, "views"):
        delattr(package, "views")


class TestStageCustomDataset:
    def test_stages_dataset_into_training_volume(
        self, tmp_path, monkeypatch, views_module
    ):
        views = views_module
        datasets_dir = tmp_path / "datasets"
        volume_dir = tmp_path / "volume"
        datasets_dir.mkdir()
        volume_dir.mkdir()
        source = datasets_dir / "data.json"
        source.write_text('{"hello":"world"}', encoding="utf-8")

        monkeypatch.setattr(views, "_custom_datasets_dir", lambda: str(datasets_dir))
        monkeypatch.setattr(
            views, "_resolve_training_volume_dir", lambda impl: str(volume_dir)
        )
        monkeypatch.setattr(views.os, "chown", lambda *_args: None)

        container_path, error = views._stage_custom_dataset(
            SimpleNamespace(model_name="demo"), "data.json"
        )

        assert error is None
        assert container_path == f"{views.CONTAINER_CUSTOM_DATASETS_DIR}/data.json"
        assert (volume_dir / "custom_datasets" / "data.json").read_text(
            encoding="utf-8"
        ) == '{"hello":"world"}'

    def test_rejects_destination_symlink(self, tmp_path, monkeypatch, views_module):
        views = views_module
        datasets_dir = tmp_path / "datasets"
        volume_dir = tmp_path / "volume"
        dest_dir = volume_dir / "custom_datasets"
        datasets_dir.mkdir()
        dest_dir.mkdir(parents=True)
        source = datasets_dir / "data.json"
        source.write_text('{"hello":"world"}', encoding="utf-8")
        sensitive = tmp_path / "sensitive.txt"
        sensitive.write_text("do not overwrite", encoding="utf-8")
        (dest_dir / "data.json").symlink_to(sensitive)

        monkeypatch.setattr(views, "_custom_datasets_dir", lambda: str(datasets_dir))
        monkeypatch.setattr(
            views, "_resolve_training_volume_dir", lambda impl: str(volume_dir)
        )
        monkeypatch.setattr(views.os, "chown", lambda *_args: None)

        container_path, error = views._stage_custom_dataset(
            SimpleNamespace(model_name="demo"), "data.json"
        )

        assert container_path is None
        assert error.status_code == 500
        assert sensitive.read_text(encoding="utf-8") == "do not overwrite"
