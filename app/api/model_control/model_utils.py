
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


def stream_response_from_external_api(url, json_data):
    logger.info(f"stream_response_from_external_api to: url={url}")
    try:
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        with requests.post(
            url, json=json_data, headers=headers, stream=True, timeout=None
        ) as response:
            response.raise_for_status()
            logger.info(f"response.headers:={response.headers}")
            logger.info(f"response.encoding:={response.encoding}")
            # only allow HTTP 1.1 chunked encoding
            assert response.headers.get("transfer-encoding") == "chunked"
            # Note: chunk_size=None must be passed or it will chunk single chars
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                yield chunk
    except requests.RequestException as e:
        yield str(e)
