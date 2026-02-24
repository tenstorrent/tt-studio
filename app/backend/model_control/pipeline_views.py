# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Voice pipeline view: Whisper STT → LLM → TTS (optional).
Accepts multipart/form-data and streams SSE events to the client.
"""

import base64
import json
import time

import requests
from django.http import StreamingHttpResponse
from rest_framework.views import APIView

from model_control.model_utils import (
    encoded_jwt,
    get_deploy_cache,
    stream_response_from_external_api,
)
from shared_config.logger_config import get_logger

logger = get_logger(__name__)


class VoicePipelineView(APIView):
    """
    POST /models-api/pipeline/voice/

    Multipart fields:
        audio_file        – audio blob
        whisper_deploy_id – deploy_id of running Whisper
        llm_deploy_id     – deploy_id of running LLM
        tts_deploy_id     – (optional) deploy_id of running speecht5_tts
        system_prompt     – (optional) string
    """

    def post(self, request, *args, **kwargs):
        audio_file = request.FILES.get("audio_file")
        whisper_deploy_id = request.data.get("whisper_deploy_id")
        llm_deploy_id = request.data.get("llm_deploy_id")
        tts_deploy_id = request.data.get("tts_deploy_id")
        system_prompt = request.data.get(
            "system_prompt",
            "You are a helpful assistant. Be concise.",
        )

        if not audio_file:
            from rest_framework.response import Response
            from rest_framework import status
            return Response(
                {"error": "audio_file is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not whisper_deploy_id or not llm_deploy_id:
            from rest_framework.response import Response
            from rest_framework import status
            return Response(
                {"error": "whisper_deploy_id and llm_deploy_id are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        def event_stream():
            headers = {"Authorization": f"Bearer {encoded_jwt}"}
            deploy_cache = get_deploy_cache()

            # ------------------------------------------------------------------
            # Step 1: STT (Whisper)
            # ------------------------------------------------------------------
            try:
                whisper_deploy = deploy_cache[whisper_deploy_id]
                whisper_url = "http://" + whisper_deploy["internal_url"]
                file_payload = {
                    "file": (audio_file.name, audio_file, audio_file.content_type)
                }
                stt_resp = requests.post(
                    whisper_url, files=file_payload, headers=headers, timeout=60
                )
                stt_resp.raise_for_status()
                transcript = stt_resp.json().get("text", "")
                yield f"data: {json.dumps({'type': 'transcript', 'text': transcript})}\n\n"
            except Exception as exc:
                logger.error(f"STT step failed: {exc}")
                yield f"data: {json.dumps({'type': 'error', 'stage': 'stt', 'message': str(exc)})}\n\n"
                return

            if not transcript:
                yield f"data: {json.dumps({'type': 'error', 'stage': 'stt', 'message': 'Empty transcript'})}\n\n"
                return

            # ------------------------------------------------------------------
            # Step 2: LLM streaming
            # ------------------------------------------------------------------
            llm_deploy = deploy_cache[llm_deploy_id]
            llm_url = "http://" + llm_deploy["internal_url"]
            hf_model_id = llm_deploy["model_impl"].hf_model_id

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": transcript})

            llm_payload = {
                "model": hf_model_id,
                "messages": messages,
                "stream": True,
                "max_tokens": 512,
            }

            llm_full_text = ""
            try:
                for chunk in stream_response_from_external_api(llm_url, llm_payload):
                    if isinstance(chunk, bytes):
                        chunk = chunk.decode("utf-8")
                    llm_full_text += chunk
                    yield f"data: {json.dumps({'type': 'llm_chunk', 'text': chunk})}\n\n"
            except Exception as exc:
                logger.error(f"LLM step failed: {exc}")
                yield f"data: {json.dumps({'type': 'error', 'stage': 'llm', 'message': str(exc)})}\n\n"
                return

            # ------------------------------------------------------------------
            # Step 3: TTS (optional)
            # ------------------------------------------------------------------
            if tts_deploy_id and llm_full_text.strip():
                try:
                    tts_deploy = deploy_cache[tts_deploy_id]
                    tts_url = "http://" + tts_deploy["internal_url"]

                    tts_resp = requests.post(
                        tts_url,
                        json={"text": llm_full_text.strip()},
                        headers=headers,
                        timeout=30,
                    )
                    tts_resp.raise_for_status()

                    task_id = tts_resp.json().get("task_id")
                    status_url = tts_url.replace("/enqueue", f"/status/{task_id}")

                    # Poll for completion
                    for _ in range(120):
                        st = requests.get(status_url, headers=headers, timeout=10)
                        if st.status_code != 404 and st.json().get("status") == "Completed":
                            break
                        time.sleep(1)

                    audio_url = tts_url.replace("/enqueue", f"/fetch_audio/{task_id}")
                    audio_resp = requests.get(audio_url, headers=headers, timeout=30)
                    audio_resp.raise_for_status()

                    audio_b64 = base64.b64encode(audio_resp.content).decode("utf-8")
                    content_type = audio_resp.headers.get("Content-Type", "audio/wav")
                    data_uri = f"data:{content_type};base64,{audio_b64}"
                    yield f"data: {json.dumps({'type': 'audio_url', 'url': data_uri})}\n\n"
                except Exception as exc:
                    logger.error(f"TTS step failed: {exc}")
                    yield f"data: {json.dumps({'type': 'error', 'stage': 'tts', 'message': str(exc)})}\n\n"
                    # Don't abort — transcript and LLM response were already sent

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response
