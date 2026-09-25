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

    def test_stages_eval_dataset_alongside_train(
        self, tmp_path, monkeypatch, views_module
    ):
        views = views_module
        datasets_dir = tmp_path / "datasets"
        volume_dir = tmp_path / "volume"
        datasets_dir.mkdir()
        volume_dir.mkdir()
        (datasets_dir / "train.json").write_text('[{"a":1}]', encoding="utf-8")
        (datasets_dir / "eval.json").write_text('[{"a":2}]', encoding="utf-8")

        monkeypatch.setattr(views, "_custom_datasets_dir", lambda: str(datasets_dir))
        monkeypatch.setattr(
            views, "_resolve_training_volume_dir", lambda impl: str(volume_dir)
        )
        monkeypatch.setattr(views.os, "chown", lambda *_args: None)

        impl = SimpleNamespace(model_name="demo")
        train_path, train_err = views._stage_custom_dataset(impl, "train.json")
        eval_path, eval_err = views._stage_custom_dataset(impl, "eval.json")

        assert train_err is None and eval_err is None
        assert train_path == f"{views.CONTAINER_CUSTOM_DATASETS_DIR}/train.json"
        assert eval_path == f"{views.CONTAINER_CUSTOM_DATASETS_DIR}/eval.json"
        assert (volume_dir / "custom_datasets" / "train.json").read_text(
            encoding="utf-8"
        ) == '[{"a":1}]'
        assert (volume_dir / "custom_datasets" / "eval.json").read_text(
            encoding="utf-8"
        ) == '[{"a":2}]'

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


class TestNormalizeDatasetRows:
    @pytest.mark.parametrize(
        "text",
        ["{}", "[{}]", '[{"prompt": "", "completion": ""}]', '[{"prompt": null}]'],
    )
    def test_rejects_datasets_without_content(self, text, views_module):
        rows, err = views_module._normalize_dataset_rows(text)
        assert rows is None
        assert "empty" in err

    def test_accepts_rows_with_content(self, views_module):
        rows, err = views_module._normalize_dataset_rows(
            '[{"prompt": "hi", "completion": ""}, {"prompt": "", "completion": ""}]'
        )
        assert err is None
        assert len(rows) == 2


class TestResolveColumnMapping:
    def test_infers_prompt_completion_for_alpaca(self, views_module):
        mapping, err = views_module._resolve_column_mapping(
            "alpaca", None, {"prompt", "completion"}
        )
        assert err is None
        assert mapping == {"instruction": "prompt", "output": "completion"}

    def test_identity_columns_need_no_mapping(self, views_module):
        mapping, err = views_module._resolve_column_mapping(
            "alpaca", None, {"instruction", "input", "output"}
        )
        assert err is None
        assert mapping is None

    def test_keeps_explicit_mapping_and_fills_the_rest(self, views_module):
        mapping, err = views_module._resolve_column_mapping(
            "alpaca", {"instruction": "question"}, {"question", "answer", "context"}
        )
        assert err is None
        assert mapping == {
            "instruction": "question",
            "output": "answer",
            "input": "context",
        }

    def test_rejects_when_required_field_unresolvable(self, views_module):
        mapping, err = views_module._resolve_column_mapping(
            "alpaca", None, {"foo", "bar"}
        )
        assert mapping is None
        assert "['instruction', 'output']" in err
        assert "['bar', 'foo']" in err

    def test_rejects_explicit_mapping_to_missing_column(self, views_module):
        mapping, err = views_module._resolve_column_mapping(
            "alpaca", {"output": "nope"}, {"prompt", "completion"}
        )
        assert mapping is None
        assert "'nope'" in err

    def test_unknown_template_passes_through(self, views_module):
        mapping, err = views_module._resolve_column_mapping(
            "other", {"a": "b"}, {"x"}
        )
        assert err is None
        assert mapping == {"a": "b"}


class TestClampStepFrequencies:
    def test_lowers_frequencies_above_total_steps(self, views_module):
        body = {
            "batch_size": 8,
            "num_epochs": 1,
            "max_steps": 100,
            "steps_freq": 10,
            "val_steps_freq": 25,
            "save_interval": 25,
        }
        total = views_module._clamp_step_frequencies(body, row_count=10)
        assert total == 1
        assert body["steps_freq"] == 1
        assert body["val_steps_freq"] == 1
        assert body["save_interval"] == 1

    def test_leaves_frequencies_within_range_and_disabled_alone(self, views_module):
        body = {
            "batch_size": 8,
            "num_epochs": 2,
            "steps_freq": 10,
            "val_steps_freq": 0,
            "save_interval": 25,
        }
        views_module._clamp_step_frequencies(body, row_count=400)  # 100 steps
        assert body["steps_freq"] == 10
        assert body["val_steps_freq"] == 0
        assert body["save_interval"] == 25

    def test_max_steps_caps_the_estimate(self, views_module):
        body = {"batch_size": 1, "num_epochs": 1, "max_steps": 5, "steps_freq": 10}
        assert views_module._clamp_step_frequencies(body, row_count=1000) == 5
        assert body["steps_freq"] == 5


class TestInspectCustomDataset:
    def test_reads_columns_and_row_count(self, tmp_path, monkeypatch, views_module):
        views = views_module
        (tmp_path / "d.json").write_text(
            '[{"prompt": "a", "completion": "b"}, {"prompt": "c", "extra": 1}]',
            encoding="utf-8",
        )
        monkeypatch.setattr(views, "_custom_datasets_dir", lambda: str(tmp_path))
        columns, count = views._inspect_custom_dataset("d.json")
        assert columns == {"prompt", "completion", "extra"}
        assert count == 2

    def test_missing_dataset_returns_none(self, tmp_path, monkeypatch, views_module):
        monkeypatch.setattr(
            views_module, "_custom_datasets_dir", lambda: str(tmp_path)
        )
        assert views_module._inspect_custom_dataset("nope.json") == (None, None)
