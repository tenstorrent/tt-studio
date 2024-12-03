# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import pickle

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
        return True, response.json() if response.content else {}
    except requests.RequestException as e:
        logger.error(f"Health check failed: {str(e)}")
        return False, str(e)


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
        logger.info(f"added extra token and temp:={json_data}")
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
                yield chunk
            
            # Append the custom end marker after the last chunk
            yield "<<END_OF_STREAM>>"  # Custom marker to signal end of stream

            logger.info("stream_response_from_external done")
    except requests.RequestException as e:
        yield str(e)
