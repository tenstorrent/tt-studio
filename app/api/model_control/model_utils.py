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
                                        "continuous_usage_stats":
                                                 True
                                            }
        logger.info(f"added extra token and temp:={json_data}")

        ttft = 0
        tpot = 0
        num_token_gen = 0
        prompt_tokens = 0
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
            ttft_start = time.time()
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                logger.info(f"stream_response_from_external_api chunk:={chunk}")
                if chunk.startswith("data: ") and num_token_gen < json_data["max_tokens"]:
                    new_chunk = chunk[len("data: "): ] # slice out the json object/dictionary
                    new_chunk.strip()
                    if new_chunk != "[DONE]": 
                        chunk_dict = json.loads(new_chunk)
                        if chunk_dict["usage"]["completion_tokens"] == 1:
                            ttft = time.time() - ttft_start # if first token created 
                            num_token_gen = 1
                            tpot_start = time.time()
                            prompt_tokens = chunk_dict["usage"]["prompt_tokens"]
                        elif chunk_dict["usage"]["completion_tokens"] > num_token_gen:
                            # TODO: consider if speculative decoding (?)
                            num_token_gen += 1
                            tpot += (1/num_token_gen) * (time.time() - tpot_start - tpot) # udpate average
                            tpot_start = time.time()
                    else: # streaming chunks is complete 
                        stats = {"ttft": ttft, "tpot": tpot, "tokens_decoded": num_token_gen, 
                                    "tokens_prefilled": prompt_tokens, 
                                    "context_length": prompt_tokens + num_token_gen}
                        logger.info(f"ttft and tpot stats: {stats}")
                        # allow stats to be streamed before [DONE] chunk
                        yield "data: "+ str(stats) 



                yield chunk

            # TODO: ttft e2e and batch size 
            # TODO: what if max context len is hit 

            yield "<<END_OF_STREAM>>"  # Custom marker to signal end of stream

            logger.info("stream_response_from_external done")
    except requests.RequestException as e:
        yield str(e)
