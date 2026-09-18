# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for _hf_from_container's env-var identity heuristic and _detect_model_info's
guard against tt-media-server's non-LLM /v1/models path-as-id quirk.
"""

from unittest.mock import Mock, patch

from docker_control.views import _hf_from_container, _detect_model_info


def _container(env: dict) -> dict:
    return {"Config": {"Env": [f"{k}={v}" for k, v in env.items()]}}


class TestHfFromContainer:
    def test_prefers_slash_shaped_org_repo_id(self):
        info = _container({"HF_MODEL_ID": "Qwen/Qwen3-Embedding-4B", "MODEL": "Qwen3-Embedding-4B"})
        assert _hf_from_container(info) == "Qwen/Qwen3-Embedding-4B"

    def test_falls_back_to_bare_model_env_when_nothing_slash_shaped(self):
        """tt-media-server forge/media launches set MODEL=<short catalog name>
        (e.g. "bge-m3", "Qwen3-Embedding-4B") with no org prefix; this used to be
        silently dropped, leaving hf_model_id unset."""
        info = _container({"MODEL": "Qwen3-Embedding-4B"})
        assert _hf_from_container(info) == "Qwen3-Embedding-4B"

    def test_bare_model_id_env_also_accepted(self):
        info = _container({"MODEL_ID": "bge-m3"})
        assert _hf_from_container(info) == "bge-m3"

    def test_no_identity_anywhere_returns_none(self):
        info = _container({"SOME_OTHER_VAR": "x"})
        assert _hf_from_container(info) is None


class TestDetectModelInfoIgnoresPathLikeApiId:
    @patch("docker_control.views.requests.get")
    def test_live_v1_models_path_does_not_clobber_container_identity(self, mock_get):
        """tt-media-server's /v1/models reports settings.model_weights_path (an
        absolute cache path) for non-LLM services when SERVED_MODEL_NAME isn't set
        at launch -- that must never override a real env-derived identity."""
        info = {
            "Config": {"Env": ["MODEL=Qwen3-Embedding-4B"]},
            "NetworkSettings": {"Ports": {"8000/tcp": [{"HostPort": "8100"}]}},
        }
        mock_resp = Mock()
        mock_resp.json.return_value = {
            "data": [{"id": "/home/container_app_user/.cache/huggingface/models--Qwen--Qwen3-Embedding-4B/snapshots/abc123"}]
        }
        mock_get.return_value = mock_resp

        result = _detect_model_info(Mock(), "container_id", container_info=info)

        assert result["hf_model_id"] == "Qwen3-Embedding-4B"
        assert result["source"] == "container"

    @patch("docker_control.views.requests.get")
    def test_live_v1_models_still_wins_when_it_looks_like_a_real_id(self, mock_get):
        info = {
            "Config": {"Env": []},
            "NetworkSettings": {"Ports": {"8000/tcp": [{"HostPort": "8100"}]}},
        }
        mock_resp = Mock()
        mock_resp.json.return_value = {"data": [{"id": "meta-llama/Llama-3.1-8B-Instruct"}]}
        mock_get.return_value = mock_resp

        result = _detect_model_info(Mock(), "container_id", container_info=info)

        assert result["hf_model_id"] == "meta-llama/Llama-3.1-8B-Instruct"
        assert result["source"] == "api"
