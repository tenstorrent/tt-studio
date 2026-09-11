# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for model_control.model_utils.find_deployed_embedding_model and embed_text.
"""

from unittest.mock import Mock, patch

from shared_config.model_type_config import ModelTypes
from model_control.model_utils import find_deployed_embedding_model, embed_text


def _embedding_impl(model_name=None, hf_model_id=None, inference_engine="forge"):
    impl = Mock()
    impl.model_type = ModelTypes.EMBEDDING
    impl.model_name = model_name
    impl.hf_model_id = hf_model_id
    impl.inference_engine = inference_engine
    return impl


class TestFindDeployedEmbeddingModel:
    @patch("model_control.model_utils.get_deploy_cache")
    def test_matches_by_hf_model_id(self, mock_cache):
        deploy = {"model_impl": _embedding_impl(model_name="Qwen3-Embedding-4B", hf_model_id="Qwen/Qwen3-Embedding-4B")}
        mock_cache.return_value = {"d1": deploy}
        assert find_deployed_embedding_model("Qwen/Qwen3-Embedding-4B") is deploy

    @patch("model_control.model_utils.get_deploy_cache")
    def test_matches_by_model_name(self, mock_cache):
        deploy = {"model_impl": _embedding_impl(model_name="bge-m3", hf_model_id="BAAI/bge-m3")}
        mock_cache.return_value = {"d1": deploy}
        assert find_deployed_embedding_model("bge-m3") is deploy

    @patch("model_control.model_utils.get_deploy_cache")
    def test_ignores_non_embedding_models(self, mock_cache):
        chat_impl = Mock()
        chat_impl.model_type = ModelTypes.CHAT
        chat_impl.model_name = "Qwen3-Embedding-4B"  # same name, wrong type
        chat_impl.hf_model_id = "Qwen/Qwen3-Embedding-4B"
        mock_cache.return_value = {"d1": {"model_impl": chat_impl}}
        assert find_deployed_embedding_model("Qwen/Qwen3-Embedding-4B") is None

    @patch("model_control.model_utils.get_deploy_cache")
    def test_not_deployed_returns_none(self, mock_cache):
        mock_cache.return_value = {}
        assert find_deployed_embedding_model("Qwen/Qwen3-Embedding-4B") is None


class TestEmbedText:
    @patch("model_control.model_utils.requests.post")
    def test_media_engine_uses_static_api_key(self, mock_post):
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [{"embedding": [0.1]}]}
        mock_post.return_value = mock_resp

        deploy = {
            "internal_url": "x:8000/v1/embeddings",
            "model_impl": _embedding_impl(model_name="bge-large-en-v1.5", hf_model_id="BAAI/bge-large-en-v1.5", inference_engine="media"),
        }
        result = embed_text(deploy, "hello")

        assert result == {"data": [{"embedding": [0.1]}]}
        headers = mock_post.call_args.kwargs["headers"]
        assert headers["Authorization"].startswith("Bearer ")
        assert mock_post.call_args.kwargs["json"]["model"] == "BAAI/bge-large-en-v1.5"
