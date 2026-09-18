# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for OpenAIAudioSpeechView (TTS) and OpenAIAudioTranscriptionsView (STT).
"""

import io
import os
import pytest
from unittest.mock import Mock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from rest_framework.response import Response
from rest_framework.test import APIRequestFactory

from model_control.views import OpenAIAudioSpeechView, OpenAIAudioTranscriptionsView


@patch("model_control.views.LITELLM_UPSTREAM_KEY", "")
class TestOpenAIAudioSpeechView:
    @patch("model_control.views.requests.post")
    @patch("model_control.views.find_deployed_tts_model")
    def test_synthesizes_via_deployed_model(self, mock_find, mock_post):
        impl = Mock()
        impl.inference_engine = "vllm"
        mock_find.return_value = {"internal_url": "tts-box:8000/v1/audio/speech", "model_impl": impl}

        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.headers = {"Content-Type": "audio/wav"}
        mock_resp.content = b"RIFF..."
        mock_resp.raise_for_status = Mock()
        mock_post.return_value = mock_resp

        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/audio/speech",
            {"model": "some-tts", "input": "hello there"},
            format="json",
        )
        response = OpenAIAudioSpeechView.as_view()(request)

        assert response.status_code == 200
        assert mock_post.call_args.kwargs["json"]["input"] == "hello there"

    @patch("model_control.views.find_deployed_tts_model")
    def test_unknown_model_is_404(self, mock_find):
        mock_find.return_value = None
        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/audio/speech",
            {"model": "not-deployed", "input": "hello"},
            format="json",
        )
        response = OpenAIAudioSpeechView.as_view()(request)
        assert response.status_code == 404

    def test_missing_input_is_rejected(self):
        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/audio/speech", {"model": "some-tts"}, format="json"
        )
        response = OpenAIAudioSpeechView.as_view()(request)
        assert response.status_code == 400


@patch("model_control.views.LITELLM_UPSTREAM_KEY", "")
class TestOpenAIAudioTranscriptionsView:
    @patch("model_control.views.post_audio_for_transcription")
    @patch("model_control.views.find_deployed_speech_model")
    def test_transcribes_via_deployed_model(self, mock_find, mock_proxy):
        impl = Mock()
        impl.inference_engine = "media"
        mock_find.return_value = {"internal_url": "stt-box:8000/v1/audio/transcriptions", "model_impl": impl}
        mock_proxy.return_value = Response({"text": "hello"}, status=200)

        factory = APIRequestFactory()
        audio = io.BytesIO(b"fake-audio-bytes")
        audio.name = "clip.wav"
        request = factory.post(
            "/models-api/openai/v1/audio/transcriptions",
            {"model": "distil-large-v3", "file": audio},
            format="multipart",
        )
        response = OpenAIAudioTranscriptionsView.as_view()(request)

        assert response.status_code == 200
        assert mock_proxy.call_count == 1
        internal_url = mock_proxy.call_args.args[0]
        assert internal_url == "http://stt-box:8000/v1/audio/transcriptions"

    @patch("model_control.views.post_audio_for_transcription")
    @patch("model_control.views.find_deployed_speech_model")
    def test_transcribes_when_content_length_is_missing(self, mock_find, mock_proxy):
        """Regression: a chunked Transfer-Encoding request correctly sends no
        Content-Length (the body length isn't known ahead of time), but DRF's
        multipart parser used to treat that as an empty body and reject with
        "model is required" even though ASGI had already buffered the whole
        thing. Open WebUI streams its audio chunks exactly this way."""
        impl = Mock()
        impl.inference_engine = "media"
        mock_find.return_value = {"internal_url": "stt-box:8000/v1/audio/transcriptions", "model_impl": impl}
        mock_proxy.return_value = Response({"text": "hello"}, status=200)

        factory = APIRequestFactory()
        audio = io.BytesIO(b"fake-audio-bytes")
        audio.name = "clip.wav"
        request = factory.post(
            "/models-api/openai/v1/audio/transcriptions",
            {"model": "distil-large-v3", "file": audio},
            format="multipart",
        )
        del request.META["CONTENT_LENGTH"]

        response = OpenAIAudioTranscriptionsView.as_view()(request)

        assert response.status_code == 200
        assert mock_proxy.call_count == 1

    @patch("model_control.views.find_deployed_speech_model")
    def test_unknown_model_is_404(self, mock_find):
        mock_find.return_value = None
        factory = APIRequestFactory()
        audio = io.BytesIO(b"fake-audio-bytes")
        audio.name = "clip.wav"
        request = factory.post(
            "/models-api/openai/v1/audio/transcriptions",
            {"model": "not-deployed", "file": audio},
            format="multipart",
        )
        response = OpenAIAudioTranscriptionsView.as_view()(request)
        assert response.status_code == 404

    def test_missing_file_is_rejected(self):
        factory = APIRequestFactory()
        request = factory.post(
            "/models-api/openai/v1/audio/transcriptions",
            {"model": "distil-large-v3"},
            format="multipart",
        )
        response = OpenAIAudioTranscriptionsView.as_view()(request)
        assert response.status_code == 400


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
