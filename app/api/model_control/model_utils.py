# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import os
import pickle
import time
import traceback 

import requests
import jwt
import json

from django.core.cache import caches

from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger
from docker_control.docker_utils import update_deploy_cache

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")


def get_deploy_cache():
    # the cache is initialized when by docker_control is imported
    def get_all_records():
        # need to strip out the key version tag
        return {
            k.replace(":version:", ""): pickle.loads(v)
            for k, v in caches[backend_config.django_deploy_cache_name]._cache.items()
        }

    update_deploy_cache()
    data = get_all_records()
    return data


def health_check(url, json_data, timeout=5):
    logger.info(f"calilng health_url:= {url}")
    try:
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        response = requests.get(url, json=json_data, headers=headers, timeout=5)
        response.raise_for_status()
        logger.info(f"Health check passed: {response.status_code}")
        return True, response.json() if response.content else {}
    except requests.RequestException as e:
        logger.error(f"Health check failed: {str(e)}")
        return False, str(e)

def stream_response_from_agent_api(url, json_data):
    try:
        new_json_data = {}
        new_json_data["thread_id"] = json_data["thread_id"]
        new_json_data["message"] = json_data["messages"][-1]["content"]
        headers = {"Content-Type": "application/json"}

        logger.info(f"stream_response_from_agent_api headers:={headers}")
        logger.info(f"stream_response_from_agent_api json_data:={new_json_data}")
        logger.info(f"using agent thread id: {new_json_data["thread_id"]}")
        logger.info(f"POST URL: {url}")
        logger.info(f"POST Headers: {headers}")
        logger.info(f"POST Data: {json.dumps(new_json_data, indent=2)}")



        with requests.post(
            url, json=new_json_data, headers=headers, stream=True, timeout=None
        ) as response:
            logger.info(f"stream_response_from_external_api response:={response}")
            response.raise_for_status()
            logger.info(f"response.headers:={response.headers}")
            logger.info(f"response.encoding:={response.encoding}")
            # only allow HTTP 1.1 chunked encoding
            # assert response.headers.get("transfer-encoding") == "chunked"

            # Stream chunks
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                json_chunk = {}
                logger.info(f"stream_response_from_external_api chunk:={chunk}")
                if chunk == "[DONE]":
                    yield "data: " + chunk + "\n"
                else: 
                    json_chunk["choices"] = [{"index": 0, "delta": {"content": chunk}}]
                    json_chunk =  json.dumps(json_chunk)
                    string = "data: " + json_chunk 
                    logger.info(f"streaming json object: {string}")
                    yield "data: " + json_chunk + "\n"
            logger.info("stream_response_from_external done")

    except requests.RequestException as e:
        logger.error(f"RequestException: {str(e)}")
        yield f"error: {str(e)}"

def stream_response_from_external_api(url, json_data):
    logger.info(f"stream_response_from_external_api to: url={url}")
    try:
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        logger.info(f"stream_response_from_external_api headers:={headers}")
        logger.info(f"stream_response_from_external_api json_data:={json_data}")
        # TODO: remove once vllm implementation can support different topk/temperature in same batch
        json_data["temperature"] = 1
        json_data["top_k"] = 20
        json_data["top_p"] = 0.9
        json_data["max_tokens"] = 512
        json_data["stream_options"] = {"include_usage": True,
                                       "continuous_usage_stats": True}
        logger.info(f"added extra token and temp:={json_data}")

        ttft = 0
        tpot = 0
        num_token_gen = 0
        prompt_tokens = 0
        ttft_start = time.time()

        with requests.post(
            url, json=json_data, headers=headers, stream=True, timeout=None
        ) as response:
            logger.info(f"stream_response_from_external_api response:={response}")
            response.raise_for_status()
            logger.info(f"response.headers:={response.headers}")
            logger.info(f"response.encoding:={response.encoding}")
            # only allow HTTP 1.1 chunked encoding
            assert response.headers.get("transfer-encoding") == "chunked"

            # Stream chunks
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                logger.info(f"stream_response_from_external_api chunk:={chunk}")
                if chunk.startswith("data: "):
                    new_chunk = chunk[len("data: "):]  # slice out the JSON object/dictionary
                    new_chunk = new_chunk.strip()

                    if new_chunk == "[DONE]":
                        # Yield [DONE] to signal that streaming is complete
                        yield chunk

                        # Now calculate and yield stats after [DONE]
                        stats = {
                            "ttft": ttft,
                            "tpot": tpot,
                            "tokens_decoded": num_token_gen,
                            "tokens_prefilled": prompt_tokens,
                            "context_length": prompt_tokens + num_token_gen
                        }
                        logger.info(f"ttft and tpot stats: {stats}")
                        yield "data: " + json.dumps(stats) + "\n\n"

                        # Send the custom end of stream marker
                        yield "<<END_OF_STREAM>>"  # Custom marker to signal end of stream
                        break

                    elif new_chunk != "":
                        chunk_dict = json.loads(new_chunk)
                        if chunk_dict.get("usage", {}).get("completion_tokens", 0) == 1:
                            ttft = time.time() - ttft_start  # if first token is created
                            num_token_gen = 1
                            tpot_start = time.time()
                            prompt_tokens = chunk_dict["usage"]["prompt_tokens"]
                        elif chunk_dict.get("usage", {}).get("completion_tokens", 0) > num_token_gen:
                            num_token_gen += 1
                            tpot += (1 / num_token_gen) * (time.time() - tpot_start - tpot)  # update average
                            tpot_start = time.time()

                    # Yield the current chunk
                    yield chunk

            logger.info("stream_response_from_external done")

    except requests.RequestException as e:
        logger.error(f"RequestException: {str(e)}")
        yield f"error: {str(e)}"


AUTH_TOKEN = os.getenv('CLOUD_CHAT_UI_AUTH_TOKEN', '')
def stream_to_cloud_model(url, json_data):
    logger.info(f"ATTEMPT 6 :stream_to_cloud_model to: url={url}")
    try:
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        logger.info(f"stream_to_cloud_model headers:={headers}")
        logger.info(f"stream_to_cloud_model json_data:={json_data}")

        json_data["temperature"] = 1
        json_data["top_k"] = 20
        json_data["top_p"] = 0.9
        json_data["max_tokens"] = 512
        json_data["stream_options"] = {"include_usage": True, "continuous_usage_stats": True}
        logger.info(f"added extra token and temp:={json_data}")

        ttft = 0
        tpot = 0
        num_token_gen = 0
        prompt_tokens = 0
        ttft_start = time.time()
        # Initialize tpot_start to avoid the UnboundLocalError
        tpot_start = ttft_start  
        logger.info(f"Starting stream request at time: {ttft_start}")

        with requests.post(url, json=json_data, headers=headers, stream=True, timeout=None) as response:
            logger.info(f"stream_to_cloud_model response status:={response.status_code}")
            logger.info(f"stream_to_cloud_model response headers:={dict(response.headers)}")
            response.raise_for_status()
            
            transfer_encoding = response.headers.get("transfer-encoding")
            logger.info(f"Transfer encoding: {transfer_encoding}")
            assert transfer_encoding == "chunked"

            chunk_count = 0
            found_done = False
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                chunk_count += 1
                logger.info(f"Received chunk #{chunk_count}: {repr(chunk)}")
                
                # Check if this chunk contains the [DONE] marker
                if "data: [DONE]" in chunk:
                    logger.info("Found [DONE] marker in chunk")
                    found_done = True
                
                if chunk.startswith("data: "):
                    logger.info(f"Processing data chunk #{chunk_count}")
                    new_chunk = chunk[len("data: "):].strip()
                    logger.info(f"Stripped chunk: {repr(new_chunk)}")
                    
                    # Process the chunk normally to track tokens
                    if new_chunk and new_chunk != "[DONE]":
                        try:
                            # Handle multiple JSON objects in a single chunk
                            # Split by newlines to handle multiple JSON objects
                            new_chunks = new_chunk.split('\n\ndata: ')
                            for sub_chunk in new_chunks:
                                if not sub_chunk.strip() or sub_chunk.strip() == "[DONE]":
                                    continue
                                    
                                logger.info(f"Processing sub-chunk: {repr(sub_chunk)}")
                                try:
                                    chunk_dict = json.loads(sub_chunk)
                                    logger.info(f"Successfully parsed JSON: {chunk_dict}")
                                    
                                    usage = chunk_dict.get("usage", {})
                                    completion_tokens = usage.get("completion_tokens", 0)
                                    logger.info(f"Usage info: {usage}, completion tokens: {completion_tokens}")
                                    
                                    if completion_tokens == 1:
                                        ttft = time.time() - ttft_start
                                        logger.info(f"First token received. TTFT: {ttft}s")
                                        num_token_gen = 1
                                        tpot_start = time.time()
                                        logger.info(f"TPOT timer started at: {tpot_start}")
                                        prompt_tokens = usage["prompt_tokens"]
                                        logger.info(f"Prompt tokens: {prompt_tokens}")
                                    elif completion_tokens > num_token_gen:
                                        old_token_gen = num_token_gen
                                        num_token_gen = completion_tokens  # Use the token count from the response
                                        logger.info(f"Token count increased: {old_token_gen} -> {num_token_gen}")
                                        current_time = time.time()
                                        time_since_last = current_time - tpot_start
                                        logger.info(f"Time since last token: {time_since_last}s")
                                        old_tpot = tpot
                                        tpot += (1 / num_token_gen) * (time_since_last - tpot)
                                        logger.info(f"TPOT updated: {old_tpot} -> {tpot}")
                                        tpot_start = current_time
                                        logger.info(f"TPOT timer reset to: {tpot_start}")
                                except json.JSONDecodeError as e:
                                    logger.error(f"JSON decode error in sub-chunk: {str(e)}")
                                    logger.error(f"Problematic sub-chunk: {repr(sub_chunk)}")
                        except json.JSONDecodeError as e:
                            logger.error(f"JSON decode error: {str(e)}")
                            logger.error(f"Problematic chunk: {repr(new_chunk)}")
                    
                    # Always yield the original chunk first
                    logger.info(f"Yielding chunk: {repr(chunk)}")
                    yield chunk
                    
                    # If we found [DONE], also send stats
                    if found_done:
                        stats = {
                            "ttft": ttft, 
                            "tpot": tpot, 
                            "tokens_decoded": num_token_gen, 
                            "tokens_prefilled": prompt_tokens, 
                            "context_length": prompt_tokens + num_token_gen
                        }
                        logger.info(f"Final stats: {stats}")
                        stats_json = json.dumps(stats)
                        logger.info(f"Yielding stats JSON: {stats_json}")
                        yield "data: " + stats_json + "\n\n"
                        logger.info("Yielding end of stream marker")
                        yield "<<END_OF_STREAM>>"
                        break
                else:
                    logger.info(f"Received non-data chunk: {repr(chunk)}")
                    yield chunk
                    
            # If we somehow didn't find [DONE] but finished streaming, still send stats
            if not found_done:
                logger.info("Stream ended without [DONE] marker, sending stats anyway")
                stats = {
                    "ttft": ttft, 
                    "tpot": tpot, 
                    "tokens_decoded": num_token_gen, 
                    "tokens_prefilled": prompt_tokens, 
                    "context_length": prompt_tokens + num_token_gen
                }
                logger.info(f"Final stats: {stats}")
                stats_json = json.dumps(stats)
                logger.info(f"Yielding stats JSON: {stats_json}")
                yield "data: " + stats_json + "\n\n"
                logger.info("Yielding end of stream marker")
                yield "<<END_OF_STREAM>>"
                
            logger.info(f"Stream completed after {chunk_count} chunks")
    except requests.RequestException as e:
        logger.error(f"RequestException: {str(e)}")
        logger.error(f"Request exception traceback: {traceback.format_exc()}")
        yield f"error: {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected exception: {str(e)}")
        logger.error(f"Exception traceback: {traceback.format_exc()}")
        yield f"error: Unexpected error - {str(e)}"