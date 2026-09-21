# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import importlib
import sys
from types import ModuleType, SimpleNamespace


def _install_view_import_stubs():
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
    sys.modules["django.http"] = django_http

    django_utils_decorators = ModuleType("django.utils.decorators")
    django_utils_decorators.method_decorator = (
        lambda *_args, **_kwargs: (lambda obj: obj)
    )
    sys.modules["django.utils.decorators"] = django_utils_decorators

    django_views = ModuleType("django.views")
    django_views.View = type("View", (), {})
    sys.modules["django.views"] = django_views

    django_views_csrf = ModuleType("django.views.decorators.csrf")
    django_views_csrf.csrf_exempt = lambda func: func
    sys.modules["django.views.decorators.csrf"] = django_views_csrf

    model_utils = ModuleType("model_control.model_utils")
    model_utils.get_deploy_cache = lambda: {}
    sys.modules["model_control.model_utils"] = model_utils

    backend_config = ModuleType("shared_config.backend_config")
    backend_config.backend_config = SimpleNamespace(
        persistent_storage_volume="/tmp/tt-studio-test"
    )
    sys.modules["shared_config.backend_config"] = backend_config

    logger_config = ModuleType("shared_config.logger_config")
    logger_config.get_logger = lambda _name: _DummyLogger()
    sys.modules["shared_config.logger_config"] = logger_config

    model_config = ModuleType("shared_config.model_config")
    model_config.model_implmentations = []
    sys.modules["shared_config.model_config"] = model_config

    model_type_config = ModuleType("shared_config.model_type_config")
    model_type_config.ModelTypes = SimpleNamespace(TRAINING="TRAINING")
    sys.modules["shared_config.model_type_config"] = model_type_config

    user_config = ModuleType("shared_config.user_config")
    user_config.get_tts_api_key = lambda: None
    sys.modules["shared_config.user_config"] = user_config


_install_view_import_stubs()
views = importlib.import_module("training_control.views")


class TestStageCustomDataset:
    def test_stages_dataset_into_training_volume(self, tmp_path, monkeypatch):
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

    def test_rejects_destination_symlink(self, tmp_path, monkeypatch):
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
