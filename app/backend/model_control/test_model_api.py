# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import time

import requests
from requests.exceptions import RequestException
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


def test_model_life_cycle():
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    encoded_jwt = jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")
    test_model_id = "id_mock_vllm_modelv0.0.1"
    # 1. get list of models
    get_containers_route = f"{backend_host}docker/get_containers/"
    logger.info(f"calling: {get_containers_route}")
    response = requests.get(get_containers_route)
    data = response.json()
    logger.info(f"response json:= {data}")
    assert test_model_id == data[0]["id"]
    model_id = data[0]["id"]
    vllm_model_name = data[0]["name"]
    # 1b. get model_weights
    model_weights_route = f"{backend_host}models/model_weights/"
    logger.info(f"calling: {model_weights_route}")
    response = requests.get(model_weights_route, params={"model_id": model_id})
    data = response.json()
    logger.info(f"weights response json:= {data}")
    # 2. deploy echo model
    deploy_route = f"{backend_host}docker/deploy/"
    logger.info(f"calling: {deploy_route}")
    # 2a. test 400 on bad weights
    response = requests.post(
        deploy_route, json={"model_id": model_id, "weights_id": "test_fail_weights"}
    )
    assert response.status_code == 400
    # 2b. test default weights
    response = requests.post(deploy_route, json={"model_id": model_id})
    data = response.json()
    logger.info(f"response json:= {data}")
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
        "model": vllm_model_name,
        "prompt": "What is Tenstorrent?",
        "temperature": 1,
        "top_k": 20,
        "top_p": 0.9,
        "max_tokens": 128,
        "stream": True,
        "stop": ["<|eot_id|>"],
        "deploy_id": deploy_id,
    }
    model_inference_route = f"{backend_host}models/inference/"
    health_url = f"{backend_host}models/health/"
    # allow inference server to start up
    response = wait_for_model_health_endpoint(health_url, deploy_id=deploy_id)
    logger.info(f"calling: {model_inference_route}")
    response = requests.post(
        url=model_inference_route, json=json_data, stream=True, timeout=35
    )
    logger.info(f'response.headers={response.headers.get("transfer-encoding")}')
    assert response.headers.get("transfer-encoding") == "chunked"
    for chunk_idx, chunk in enumerate(
        response.iter_content(chunk_size=None, decode_unicode=True)
    ):
        # Process each chunk of data as it's received
        all_chunks += chunk
    logger.info(f"processed {chunk_idx} chunks.")
    logger.info(f"all_chunks:={all_chunks}")
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


def wait_for_model_health_endpoint(health_url, deploy_id, timeout=30):
    logger.info(
        f"waiting for healthy endpoint: {health_url}, timeout: {timeout} seconds"
    )
    start_time = time.time()
    while True:
        try:
            response = requests.get(
                health_url, json={"deploy_id": deploy_id}, timeout=10
            )
            response.raise_for_status()
            return response  # Success case

        except RequestException as e:
            elapsed = time.time() - start_time
            if elapsed >= timeout:
                raise TimeoutError(
                    f"Health check failed after {timeout} seconds: {str(e)}"
                )

            # Wait 1 second before retrying
            time.sleep(1)


if __name__ == "__main__":
    test_model_life_cycle()
