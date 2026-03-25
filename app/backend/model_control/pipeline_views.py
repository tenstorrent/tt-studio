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
            pipeline_start = time.time()
            metrics = {}

            # ------------------------------------------------------------------
            # Step 1: STT (Whisper)
            # ------------------------------------------------------------------
            stt_start = time.time()
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
                metrics["stt_latency_ms"] = round((time.time() - stt_start) * 1000)
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
            llm_start = time.time()
            llm_first_chunk_time = None
            llm_chunk_count = 0
            try:
                for chunk in stream_response_from_external_api(llm_url, llm_payload):
                    if isinstance(chunk, bytes):
                        chunk = chunk.decode("utf-8")
                    if llm_first_chunk_time is None and chunk.strip():
                        llm_first_chunk_time = time.time()
                    llm_chunk_count += 1
                    llm_full_text += chunk
                    yield f"data: {json.dumps({'type': 'llm_chunk', 'text': chunk})}\n\n"
            except Exception as exc:
                logger.error(f"LLM step failed: {exc}")
                yield f"data: {json.dumps({'type': 'error', 'stage': 'llm', 'message': str(exc)})}\n\n"
                return

            llm_end = time.time()
            metrics["llm_ttfb_ms"] = round((llm_first_chunk_time - llm_start) * 1000) if llm_first_chunk_time else 0
            metrics["llm_total_ms"] = round((llm_end - llm_start) * 1000)
            metrics["llm_tokens"] = llm_chunk_count

            # ------------------------------------------------------------------
            # Step 3: TTS (optional)
            # ------------------------------------------------------------------
            if tts_deploy_id and llm_full_text.strip():
                tts_start = time.time()
                try:
                    tts_deploy = deploy_cache[tts_deploy_id]
                    tts_url = "http://" + tts_deploy["internal_url"]
                    model_impl = tts_deploy.get("model_impl")
                    model_name = getattr(model_impl, "model_name", None) if model_impl else None
                    
                    # Determine if this is OpenAI-style or enqueue-style endpoint
                    is_openai_style = "/v1/audio/speech" in tts_url
                    
                    if is_openai_style:
                        # OpenAI-style: POST directly and get audio back
                        payload = {"model": model_name, "text": llm_full_text.strip(), "voice": "default"}
                        tts_resp = requests.post(tts_url, json=payload, headers=headers, timeout=120)
                        tts_resp.raise_for_status()
                        
                        audio_b64 = base64.b64encode(tts_resp.content).decode("utf-8")
                        content_type = tts_resp.headers.get("Content-Type", "audio/wav")
                        data_uri = f"data:{content_type};base64,{audio_b64}"
                        yield f"data: {json.dumps({'type': 'audio_url', 'url': data_uri})}\n\n"
                    else:
                        # Enqueue-style: POST → poll status → fetch audio
                        tts_resp = requests.post(
                            tts_url,
                            json={"text": llm_full_text.strip()},
                            headers=headers,
                            timeout=30,
                        )
                        
                        # If 404 on enqueue, try fallback to /v1/audio/speech
                        if tts_resp.status_code == 404 and "/enqueue" in tts_url:
                            logger.info(f"Pipeline TTS 404 on {tts_url}, trying /v1/audio/speech")
                            fallback_url = tts_url.replace("/enqueue", "/v1/audio/speech")
                            payload = {"model": model_name, "text": llm_full_text.strip(), "voice": "default"}
                            tts_resp = requests.post(fallback_url, json=payload, headers=headers, timeout=120)
                            tts_resp.raise_for_status()
                            
                            audio_b64 = base64.b64encode(tts_resp.content).decode("utf-8")
                            content_type = tts_resp.headers.get("Content-Type", "audio/wav")
                            data_uri = f"data:{content_type};base64,{audio_b64}"
                            yield f"data: {json.dumps({'type': 'audio_url', 'url': data_uri})}\n\n"
                        else:
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
                            
                    metrics["tts_latency_ms"] = round((time.time() - tts_start) * 1000)
                except Exception as exc:
                    logger.error(f"TTS step failed: {exc}")
                    yield f"data: {json.dumps({'type': 'error', 'stage': 'tts', 'message': str(exc)})}\n\n"
                    # Don't abort — transcript and LLM response were already sent

            metrics["total_ms"] = round((time.time() - pipeline_start) * 1000)
            yield f"data: {json.dumps({'type': 'metrics', **metrics})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response
