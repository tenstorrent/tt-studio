# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for _ensure_volume_hf_home — the token-less media-deploy workaround
that pre-creates HF_HOME inside the model's docker volume so tt-media-server's
no-token check (any(os.scandir(HF_HOME))) warns instead of crashing the worker."""

from types import SimpleNamespace
from unittest import mock

import pytest


def _api():
    return pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )


def _spec(
    impl_id="tt_transformers", model_name="Wan2.2-T2V-A14B-Diffusers", image=None
):
    return SimpleNamespace(
        impl=SimpleNamespace(impl_id=impl_id), model_name=model_name, docker_image=image
    )


class TestEnsureVolumeHfHome:
    def test_mkdir_runs_with_override_image_and_volume(self):
        api = _api()
        client = mock.Mock()
        argv = ["run.py", "--override-docker-image", "ghcr.io/x/media:1"]
        with mock.patch.object(
            api, "get_runtime_model_spec", return_value=(_spec(), None, None)
        ), mock.patch.object(api.docker, "from_env", return_value=client):
            api._ensure_volume_hf_home(
                "job1", "Wan2.2-T2V-A14B-Diffusers", "p300x2", None, argv
            )

        client.containers.run.assert_called_once()
        args, kwargs = client.containers.run.call_args
        assert args[0] == "ghcr.io/x/media:1"
        assert kwargs["entrypoint"] == [
            "sh",
            "-c",
            "mkdir -p /home/container_app_user/cache_root/huggingface"
            " && chmod 2775 /home/container_app_user/cache_root/huggingface",
        ]
        assert kwargs["volumes"] == {
            "volume_id_tt_transformers-Wan2.2-T2V-A14B-Diffusers": {
                "bind": "/home/container_app_user/cache_root",
                "mode": "rw",
            }
        }
        assert kwargs["remove"] is True

    def test_falls_back_to_spec_docker_image(self):
        api = _api()
        client = mock.Mock()
        with mock.patch.object(
            api,
            "get_runtime_model_spec",
            return_value=(_spec(image="ghcr.io/x/from-spec:2"), None, None),
        ), mock.patch.object(api.docker, "from_env", return_value=client):
            api._ensure_volume_hf_home(
                "job2", "Wan2.2-T2V-A14B-Diffusers", "p300x2", None, ["run.py"]
            )

        assert client.containers.run.call_args[0][0] == "ghcr.io/x/from-spec:2"

    def test_skips_when_no_image_known(self):
        api = _api()
        client = mock.Mock()
        with mock.patch.object(
            api, "get_runtime_model_spec", return_value=(_spec(image=None), None, None)
        ), mock.patch.object(api.docker, "from_env", return_value=client):
            api._ensure_volume_hf_home("job3", "SomeModel", "p150", None, ["run.py"])

        client.containers.run.assert_not_called()

    def test_spec_lookup_failure_is_nonfatal(self):
        api = _api()
        with mock.patch.object(
            api, "get_runtime_model_spec", side_effect=ValueError("not in catalog")
        ):
            api._ensure_volume_hf_home("job4", "UnknownModel", "p150", None, ["run.py"])

    def test_docker_failure_is_nonfatal(self):
        api = _api()
        client = mock.Mock()
        client.containers.run.side_effect = RuntimeError("docker down")
        argv = ["run.py", "--override-docker-image", "ghcr.io/x/media:1"]
        with mock.patch.object(
            api, "get_runtime_model_spec", return_value=(_spec(), None, None)
        ), mock.patch.object(api.docker, "from_env", return_value=client):
            api._ensure_volume_hf_home(
                "job5", "Wan2.2-T2V-A14B-Diffusers", "p300x2", None, argv
            )
