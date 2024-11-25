# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import time

import requests
import jwt

from shared_config.backend_config import backend_config
from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from .docker_utils import run_container, stop_container

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


def test_deploy_echo_model():
    impl = model_implmentations["id_dummy_echo_modelv0.0.1"]
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    # 1. run container
    logger.info(f"using impl:={impl}")
    status = run_container(impl)
    logger.info(f"status:={status}")
    assert status["status"] == "success"
    # 2. make valid API call to container
    container_id = status["container_id"]
    service_port = impl.service_port
    service_route = status["service_route"]
    host = status["container_name"]
    api_url = f"http://{host}:{service_port}{service_route}"
    headers = {"Authorization": f"Bearer {encoded_jwt}"}
    assert valid_api_call(api_url, headers)
    # 3. stop container
    logger.info(f"stop deployed container: container_id={container_id}")
    stop_status = stop_container(container_id)
    logger.info(f"status:={stop_status}")
    assert stop_status["status"] == "success"


def test_deploy_llama3_model():
    impl = model_implmentations["id_tt-metal-llama-3.1-70b-instructv0.0.1"]
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    # 1. run container
    logger.info(f"using impl:={impl}")
    weights_id = impl.docker_config["environment"]["MODEL_WEIGHTS_ID"]
    status = run_container(impl, weights_id)
    logger.info(f"status:={status}")
    assert status["status"] == "success"
    # 2. make valid API call to container
    container_id = status["container_id"]
    service_port = impl.service_port
    service_route = status["service_route"]
    host = status["container_name"]
    api_url = f"http://{host}:{service_port}{service_route}"
    headers = {"Authorization": f"Bearer {encoded_jwt}"}
    assert valid_api_call(api_url, headers)
    # 3. stop container
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
    test_deploy_echo_model()
