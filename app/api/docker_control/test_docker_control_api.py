# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import time

import requests
import jwt

from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


on_bridge_network = False
if on_bridge_network:
    backend_host = "http://tt_studio_backend_api:8000/"
else:
    backend_host = "http://0.0.0.0:8000/"


def test_model_life_cycle():
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    # 1. get list of models
    get_containers_route = f"{backend_host}docker/get_containers/"
    logger.info(f"calling: {get_containers_route}")
    response = requests.get(get_containers_route)
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["0"] == "echo"
    # 2. deploy echo model
    deploy_route = f"{backend_host}docker/deploy/"
    logger.info(f"calling: {deploy_route}")
    response = requests.post(deploy_route, json={"model_id": "0"})
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["status"] == "success"
    deployed_container_id = data["container_id"]
    # 3. make api call
    service_route = data["service_route"]
    container_name = data["container_name"]
    port_bindings = data["port_bindings"]
    # service_port = port_bindings["7000/tcp"]
    service_port = "7000"
    host = container_name
    model_api_url = f"http://{host}:{service_port}{service_route}"
    headers = {"Authorization": f"Bearer {encoded_jwt}"}
    logger.info(f"calling: {model_api_url}")
    valid_api_call(model_api_url, headers)
    # 4. get status -> container id
    status_route = f"{backend_host}docker/status/"
    logger.info(f"calling: {status_route}")
    response = requests.get(status_route)
    data = response.json()
    logger.info(f"response json:= {data}")
    assert deployed_container_id in data.keys()
    # 5. stop echo model
    stop_route = f"{backend_host}docker/stop/"
    logger.info(f"calling: {stop_route}")
    response = requests.post(stop_route, json={"container_id": deployed_container_id})
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["status"] == "success"


def test_deploy_api():
    deploy_route = f"{backend_host}docker/deploy/"
    logger.info(f"calling: {deploy_route}")
    # test weights_path
    response = requests.post(deploy_route, json={"model_id": "0", "weights_path": ""})
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["status"] == "success"
    deployed_container_id = data["container_id"]
    stop_route = f"{backend_host}docker/stop/"
    logger.info(f"calling: {stop_route}")
    response = requests.post(stop_route, json={"container_id": deployed_container_id})
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["status"] == "success"


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
