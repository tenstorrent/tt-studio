# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import pickle
import time 

import requests
import jwt

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
    # logger.info(f"stream_response_from_agent_api to: url={url}")
    try:
        # headers = {"Authorization": f"Bearer {encoded_jwt}"}
        # logger.info(f"stream_response_from_external_api headers:={headers}")
        # logger.info(f"stream_response_from_external_api json_data:={json_data}")
        # TODO: remove once vllm implementation can support different topk/temperature in same batch
        # json_data["temperature"] = 1
        # json_data["top_k"] = 20
        # json_data["top_p"] = 0.9
        # json_data["max_tokens"] = 512
        # json_data["stream_options"] = {"include_usage": True,
        #                                "continuous_usage_stats": True}
        # logger.info(f"added extra token and temp:={json_data}")
        new_json_data = {}
        new_json_data["thread_id"] = "12345"
        new_json_data["message"] = json_data["messages"][-1]["content"]

        ttft = 0
        tpot = 0
        num_token_gen = 0
        prompt_tokens = 0
        ttft_start = time.time()

        headers = {"Content-Type": "application/json"}

        logger.info(f"stream_response_from_external_api headers:={headers}")
        logger.info(f"stream_response_from_external_api json_data:={new_json_data}")

        import json

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
