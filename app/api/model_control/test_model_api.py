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
# when running from within the backend api container need on_bridge_network=False
if on_bridge_network:
    backend_host = "http://tt_studio_backend_api:8000/"
else:
    backend_host = "http://0.0.0.0:8000/"

# enabled when running on gunicorn
streaming_enabled = False


def test_model_life_cycle():
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    # 1. get list of models
    get_containers_route = f"{backend_host}docker/get_containers/"
    logger.info(f"calling: {get_containers_route}")
    response = requests.get(get_containers_route)
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data[0]["name"] == "echo"
    model_id = data[0]["id"]
    # 1b. get model_weights
    model_weights_route = f"{backend_host}models/model_weights/"
    logger.info(f"calling: {model_weights_route}")
    response = requests.get(model_weights_route, json={"model_id": model_id})
    data = response.json()
    logger.info(f"response json:= {data}")
    # assert data[0]["name"] == "echo"
    # 2. deploy echo model
    deploy_route = f"{backend_host}docker/deploy/"
    logger.info(f"calling: {deploy_route}")
    # 2a. test 400 on bad weights
    response = requests.post(
        deploy_route, json={"model_id": model_id, "weights_id": "test_fail"}
    )
    assert response.status_code == 400
    # 2b. test default weights
    response = requests.post(deploy_route, json={"model_id": model_id})
    data = response.json()
    # logger.info(f"response json:= {data}")
    assert data["status"] == "success"
    deployed_container_id = data["container_id"]
    logger.info(f"deployed container: {deployed_container_id}")
    # 3. get deployed models
    model_deployed_route = f"{backend_host}models/deployed/"
    logger.info(f"calling: {model_deployed_route}")
    response = requests.get(model_deployed_route)
    deployed_res = response.json()
    deployed_ids = list(deployed_res.keys())
    logger.info(f"found deployed_ids: {deployed_ids}")
    # 3. make valid API call to
    deploy_id = deployed_ids[-1]
    deploy_data = deployed_res[deploy_id]
    json_data = {
        "text": "What is in Austin Texas?",
        "temperature": 1,
        "top_k": 10,
        "top_p": 0.9,
        "max_tokens": 32,
        "stop_sequence": None,
        "return_prompt": None,
        "deploy_id": deploy_id,
    }
    model_inference_route = f"{backend_host}models/inference/"
    # allow inference server to start up
    time.sleep(1)
    logger.info(f"calling: {model_inference_route}")
    response = requests.post(url=model_inference_route, json=json_data, stream=True)
    logger.info(f'response.headers={response.headers.get("transfer-encoding")}')
    if streaming_enabled:
        assert response.headers.get("transfer-encoding") == "chunked"
    all_chunks = ""
    logger.info("processing chunks ...")
    for chunk_idx, chunk in enumerate(
        response.iter_content(chunk_size=None, decode_unicode=True)
    ):
        # Process each chunk of data as it's received
        all_chunks += chunk
    logger.info(f"processed {chunk_idx} chunks.")
    logger.info(f"all_chunks:={all_chunks}")
    if streaming_enabled:
        assert chunk_idx > 1
    assert all_chunks == json_data["text"] + "<|endoftext|>"
    # 4. get status -> container id
    status_route = f"{backend_host}docker/status/"
    logger.info(f"calling: {status_route}")
    response = requests.get(status_route)
    data = response.json()
    # logger.info(f"response json:= {data}")
    assert deployed_container_id in data.keys()
    logger.info(f"got status.")
    # 5. stop echo model
    stop_route = f"{backend_host}docker/stop/"
    logger.info(f"calling: {stop_route}")
    response = requests.post(stop_route, json={"container_id": deployed_container_id})
    data = response.json()
    # logger.info(f"response json:= {data}")
    assert data["status"] == "success"
    logger.info(f"stopped container: {deployed_container_id}")
