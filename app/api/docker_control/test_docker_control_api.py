# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import time

import requests
import jwt

from shared_config.backend_config import backend_config
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations

from .test_docker_utils import (
    wait_for_vllm_healthy_endpoint,
    valid_api_call,
    valid_vllm_api_call,
)


logger = get_logger(__name__)
logger.info(f"importing {__name__}")


def create_auth_token():
    json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
    return jwt.encode(json_payload, backend_config.jwt_secret, algorithm="HS256")


def get_available_models(backend_host):
    route = f"{backend_host}docker/get_containers/"
    logger.info(f"calling: {route}")
    response = requests.get(route)
    data = response.json()
    logger.info(f"response json:= {data}")
    assert isinstance(data[0], dict)
    return data[0]["name"]


def deploy_model(backend_host, model_id):
    route = f"{backend_host}docker/deploy/"
    logger.info(f"calling: {route}")
    response = requests.post(route, json={"model_id": model_id, "weights_path": ""})
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["status"] == "success"
    return data


def get_service_details(deployment_data, impl, on_bridge_network):
    port_bindings = deployment_data["port_bindings"]
    service_port = port_bindings["7000/tcp"] if on_bridge_network else impl.service_port
    return {
        "host": deployment_data["container_name"],
        "port": service_port,
        "container_id": deployment_data["container_id"],
        "service_route": deployment_data["service_route"],
    }


def verify_model_status(backend_host, container_id):
    route = f"{backend_host}docker/status/"
    logger.info(f"calling: {route}")
    response = requests.get(route)
    data = response.json()
    logger.info(f"response json:= {data}")
    assert container_id in data.keys()


def stop_model(backend_host, container_id):
    route = f"{backend_host}docker/stop/"
    logger.info(f"calling: {route}")
    response = requests.post(route, json={"container_id": container_id})
    data = response.json()
    logger.info(f"response json:= {data}")
    assert data["status"] == "success"


def test_model_life_cycle():
    # if running outside container, set on_bridge_network to False
    on_bridge_network = False
    if on_bridge_network:
        backend_host = "http://tt_studio_backend_api:8000/"
    else:
        backend_host = "http://0.0.0.0:8000/"
    model_id = "id_mock_vllm_modelv0.0.1"
    encoded_jwt = create_auth_token()

    try:
        # 1. Get available models
        model_name = get_available_models(backend_host)
        impl = model_implmentations[model_id]

        # 2. Deploy model
        deployment_data = deploy_model(backend_host, model_id)

        # 3. Make API call
        service = get_service_details(deployment_data, impl, on_bridge_network)
        headers = {"Authorization": f"Bearer {encoded_jwt}"}

        health_url = f"http://{service['host']}:{service['port']}/health"
        api_url = (
            f"http://{service['host']}:{service['port']}{service['service_route']}"
        )

        wait_for_vllm_healthy_endpoint(health_url, headers, timeout=30)
        logger.info(f"calling: {api_url}")
        valid_vllm_api_call(api_url, headers, vllm_model=model_name)

        # 4. Verify model status
        verify_model_status(backend_host, service["container_id"])

    except Exception as e:
        logger.error(f"Error: {e}")
        raise e
    finally:
        # 5. Stop model
        if "service" in locals():
            stop_model(backend_host, service["container_id"])
