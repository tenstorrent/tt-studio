import json
import time
import os

import requests
import jwt

from shared_config.backend_config import backend_config
from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from docker_control.docker_utils import run_container, stop_container
from model_control.model_utils import (
    get_deploy_cache,
    stream_response_from_external_api,
)

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

# for test script set up Django using settings
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()


def test_model_utils():
    impl = model_implmentations["0"]
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    # 1. run container
    logger.info(f"using impl:={impl}")
    status = run_container(impl)
    logger.info(f"status:={status}")
    assert status["status"] == "success"
    # 2. make valid API call to
    deploy_cache = get_deploy_cache()
    deploy_id = list(deploy_cache.keys())[-1]
    deploy = deploy_cache[deploy_id]
    json_data = {
        "text": "What is in Austin Texas?",
        "temperature": 1,
        "top_k": 10,
        "top_p": 0.9,
        "max_tokens": 32,
        "stop_sequence": None,
        "return_prompt": None,
        # "deploy_id": = deploy_id,
    }
    url = "http://" + deploy["internal_url"]
    all_chunks = ""
    logger.info(f"Making stream_response_from_external_api request to url:={url}")
    for chunk in stream_response_from_external_api(url=url, json_data=json_data):
        # logger.info(chunk)
        all_chunks += chunk
    assert all_chunks == json_data["text"] + "<|endoftext|>"
    # 3. stop container
    # TODO: change once deploy_id is no longer container_id
    container_id = deploy_id
    logger.info(f"stop deployed container: container_id={container_id}")
    stop_status = stop_container(container_id)
    logger.info(f"status:={stop_status}")
    assert stop_status["status"] == "success"


def valid_api_call(api_url, headers, prompt_extra="", print_output=True):
    # set API prompt and optional parameters
    json_data = {
        "text": "What is in Austin Texas?" + prompt_extra,
        "temperature": 1,
        "top_k": 10,
        "top_p": 0.9,
        "max_tokens": 16,
        "stop_sequence": None,
        "return_prompt": None,
    }
    logger.info("waiting for containers HTTP server to become available ...")
    time.sleep(2)
    # using requests stream=True, make sure to set a timeout
    response = requests.post(
        api_url, json=json_data, headers=headers, stream=True, timeout=35
    )
    # Handle chunked response
    if response.headers.get("transfer-encoding") == "chunked":
        logger.info("processing chunks ...")
        for idx, chunk in enumerate(
            response.iter_content(chunk_size=None, decode_unicode=True)
        ):
            # Process each chunk of data as it's received
            if print_output:
                logger.info(chunk)
    else:
        # If not chunked, you can access the entire response body at once
        logger.info("NOT CHUNKED!")
        logger.info(response.text)
    passed = True
    return passed


if __name__ == "__main__":
    test_model_utils()
