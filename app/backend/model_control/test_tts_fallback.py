# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for TTS inference view fallback behavior.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from rest_framework.test import APIRequestFactory
from rest_framework import status as http_status

from model_control.views import TtsInferenceView, OpenAIAudioSpeechView


class TestTtsInferenceFallback:
    """Test TTS inference view with fallback to /v1/audio/speech on 404."""
    
    @patch('model_control.views.get_deploy_cache')
    @patch('model_control.views.requests.post')
    def test_tts_fallback_on_404_from_enqueue(self, mock_post, mock_cache):
        """When /enqueue returns 404 for TTS media model, should retry with /v1/audio/speech."""
        # Setup mock deploy cache
        mock_impl = Mock()
        mock_impl.model_name = "speecht5_tts"
        mock_impl.inference_engine = "media"
        
        mock_cache.return_value = {
            "test_deploy_id": {
                "internal_url": "speecht5_tts:7000/enqueue",
                "model_impl": mock_impl
            }
        }
        
        # First call returns 404, second call succeeds
        mock_resp_404 = Mock()
        mock_resp_404.status_code = 404
        
        mock_resp_success = Mock()
        mock_resp_success.status_code = 200
        mock_resp_success.headers = {"Content-Type": "audio/wav"}
        mock_resp_success.content = b"fake_audio_data"
        
        mock_post.side_effect = [mock_resp_404, mock_resp_success]
        
        # Create request
        factory = APIRequestFactory()
        request = factory.post('/models-api/tts/', {
            'deploy_id': 'test_deploy_id',
            'text': 'Hello world'
        }, format='json')
        
        # Call view
        view = TtsInferenceView.as_view()
        response = view(request)
        
        # Verify fallback was attempted
        assert mock_post.call_count == 2
        first_call_url = mock_post.call_args_list[0][0][0]
        second_call_url = mock_post.call_args_list[1][0][0]
        
        assert "enqueue" in first_call_url
        assert "/v1/audio/speech" in second_call_url
        assert response.status_code == 200
    
    @patch('model_control.views.get_deploy_cache')
    @patch('model_control.views.requests.post')
    def test_tts_success_without_fallback(self, mock_post, mock_cache):
        """When initial request succeeds, should not retry."""
        # Setup mock deploy cache
        mock_impl = Mock()
        mock_impl.model_name = "speecht5_tts"
        mock_impl.inference_engine = "media"
        
        mock_cache.return_value = {
            "test_deploy_id": {
                "internal_url": "speecht5_tts:7000/v1/audio/speech",
                "model_impl": mock_impl
            }
        }
        
        # First call succeeds
        mock_resp_success = Mock()
        mock_resp_success.status_code = 200
        mock_resp_success.headers = {"Content-Type": "audio/wav"}
        mock_resp_success.content = b"fake_audio_data"
        
        mock_post.return_value = mock_resp_success
        
        # Create request
        factory = APIRequestFactory()
        request = factory.post('/models-api/tts/', {
            'deploy_id': 'test_deploy_id',
            'text': 'Hello world'
        }, format='json')
        
        # Call view
        view = TtsInferenceView.as_view()
        response = view(request)
        
        # Verify no fallback was needed
        assert mock_post.call_count == 1
        assert response.status_code == 200


class TestOpenAIAudioSpeechFallback:
    """Test OpenAI audio/speech view with fallback to /v1/audio/speech on 404."""
    
    @patch('model_control.views.get_deploy_cache')
    @patch('model_control.views.requests.post')
    def test_openai_audio_fallback_on_404(self, mock_post, mock_cache):
        """OpenAI endpoint should also retry with /v1/audio/speech on 404."""
        # Setup mock deploy cache
        mock_impl = Mock()
        mock_impl.model_name = "speecht5_tts"
        mock_impl.inference_engine = "media"
        
        mock_cache.return_value = {
            "deploy_1": {
                "internal_url": "speecht5_tts:7000/enqueue",
                "model_impl": mock_impl
            }
        }
        
        # First call returns 404, second call succeeds
        mock_resp_404 = Mock()
        mock_resp_404.status_code = 404
        
        mock_resp_success = Mock()
        mock_resp_success.status_code = 200
        mock_resp_success.headers = {"Content-Type": "audio/wav"}
        mock_resp_success.content = b"fake_audio_data"
        
        mock_post.side_effect = [mock_resp_404, mock_resp_success]
        
        # Create request
        factory = APIRequestFactory()
        request = factory.post('/v1/audio/speech', {
            'model': 'speecht5_tts',
            'input': 'Hello world'
        }, format='json')
        
        # Call view
        view = OpenAIAudioSpeechView.as_view()
        response = view(request)
        
        # Verify fallback was attempted
        assert mock_post.call_count == 2
        second_call_url = mock_post.call_args_list[1][0][0]
        assert "/v1/audio/speech" in second_call_url
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
