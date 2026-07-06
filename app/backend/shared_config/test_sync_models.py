# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for sync_models_from_inference_server.py route derivation logic.
"""

import pytest
from sync_models_from_inference_server import map_service_route


class TestServiceRouteMapping:
    """Test that service routes are correctly derived for different model types."""
    
    def test_vllm_chat_capable_models(self):
        """vLLM chat-capable models should use /v1/chat/completions."""
        assert map_service_route("vLLM", "meta-llama/Llama-3.1-8B-Instruct", "") == "/v1/chat/completions"
        assert map_service_route("vLLM", "mistralai/Mistral-7B-Instruct-v0.3", "") == "/v1/chat/completions"
        assert map_service_route("vLLM", "Qwen/QwQ-32B", "") == "/v1/chat/completions"
    
    def test_vllm_base_models(self):
        """vLLM base models should use /v1/completions."""
        assert map_service_route("vLLM", "meta-llama/Llama-3.1-70B", "") == "/v1/completions"
        assert map_service_route("vLLM", "meta-llama/Llama-3.2-1B", "") == "/v1/completions"
    
    def test_tts_media_models_use_openai_endpoint(self):
        """TTS media models should use /v1/audio/speech (OpenAI-compatible)."""
        assert map_service_route("media", "", "TEXT_TO_SPEECH") == "/v1/audio/speech"
        assert map_service_route("media", "", "TTS") == "/v1/audio/speech"
    
    def test_image_gen_media_models_use_v1_images_generations(self):
        """Image generation media models should use /v1/images/generations."""
        assert map_service_route("media", "", "IMAGE") == "/v1/images/generations"
        assert map_service_route("media", "", "IMAGE_GENERATION") == "/v1/images/generations"

    def test_non_image_media_models_use_enqueue(self):
        """Non-image/non-audio/non-video media models should use /enqueue."""
        assert map_service_route("media", "", "CNN") == "/enqueue"
        assert map_service_route("media", "", "EMBEDDING") == "/enqueue"

    def test_video_gen_media_models_use_v1_videos_generations(self):
        """T2V video generation media models should use /v1/videos/generations."""
        assert map_service_route("media", "Wan-AI/Wan2.2-T2V-A14B-Diffusers", "VIDEO") == "/v1/videos/generations"
        assert map_service_route("media", "Wan-AI/Wan2.2-I2V-A14B-Diffusers", "VIDEO") == "/v1/videos/generations/i2v"
        assert map_service_route("media", "some-org/some-T2V-model", "VIDEO") == "/v1/videos/generations"
    
    def test_forge_models_use_chat_completions(self):
        """Forge models should use /v1/chat/completions."""
        assert map_service_route("forge", "", "") == "/v1/chat/completions"
        assert map_service_route("forge", "", "CNN") == "/v1/chat/completions"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
