# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import time
from collections import defaultdict
from unittest.mock import patch

import requests
from requests.exceptions import RequestException
import jwt

from shared_config.backend_config import backend_config
from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from .docker_utils import run_container, stop_container

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


# Simple dict-based cache mock
class MockCache:
    def __init__(self):
        self.store = {}

    def set(self, key, value, timeout=None):
        self.store[key] = value

    def get(self, key, default=None):
        return self.store.get(key, default)


@patch("docker_control.docker_utils.caches", defaultdict(MockCache))
def test_deploy_mock_model():
    impl = model_implmentations["id_mock_vllm_modelv0.0.1"]
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    # 1. run container
    logger.info(f"using impl:={impl}")
    status = run_container(impl, weights_id=None)
    logger.info(f"status:={status}")
    assert status["status"] == "success"
    try:
        # 2. make valid API call to container
        container_id = status["container_id"]
        service_port = impl.service_port
        service_route = status["service_route"]
        host = status["container_name"]
        api_url = f"http://{host}:{service_port}{service_route}"
        health_url = f"http://{host}:{service_port}/health"
        headers = {"Authorization": f"Bearer {encoded_jwt}"}
        wait_for_vllm_healthy_endpoint(health_url, headers)
        assert valid_vllm_api_call(api_url, headers, vllm_model=impl.model_name)
    except Exception as e:
        logger.error(f"Error: {e}")
        has_error = True
    # 3. stop container
    logger.info(f"stop deployed container: container_id={container_id}")
    stop_status = stop_container(container_id)
    logger.info(f"status:={stop_status}")
    if has_error:
        raise e
    assert stop_status["status"] == "success"


@patch("docker_control.docker_utils.caches", defaultdict(MockCache))
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
    assert valid_vllm_api_call(api_url, headers)
    # 3. stop container
    logger.info(f"stop deployed container: container_id={container_id}")
    stop_status = stop_container(container_id)
    logger.info(f"status:={stop_status}")
    assert stop_status["status"] == "success"


def valid_api_call(api_url, headers, print_output=True):
    # set API prompt and optional parameters
    json_data = {
        "text": "What is Tenstorrent?",
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


def wait_for_vllm_healthy_endpoint(health_url, headers, timeout=30):
    logger.info(
        f"waiting for healthy endpoint: {health_url}, timeout: {timeout} seconds"
    )
    start_time = time.time()
    while True:
        try:
            response = requests.get(health_url, headers=headers, timeout=10)
            response.raise_for_status()
            return True  # Success case

        except RequestException as e:
            elapsed = time.time() - start_time
            if elapsed >= timeout:
                raise TimeoutError(
                    f"Health check failed after {timeout} seconds: {str(e)}"
                )

            # Wait 1 second before retrying
            time.sleep(1)


def valid_vllm_api_call(api_url, headers, vllm_model, print_output=True):
    # set API prompt and optional parameters
    json_data = {
        "model": vllm_model,
        "prompt": "What is Tenstorrent?",
        "temperature": 1,
        "top_k": 20,
        "top_p": 0.9,
        "max_tokens": 128,
        "stream": True,
        "stop": ["<|eot_id|>"],
    }
    req_time = time.time()
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


if __name__ == "__main__":
    test_deploy_mock_model()
