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

from django.test import APITestCase
from django.urls import reverse
from rest_framework import status

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


class ModelCatalogViewTests(APITestCase):
    def setUp(self):
        # Get a valid model_id from model_implmentations
        self.model_id = list(model_implmentations.keys())[0]
        self.model = model_implmentations[self.model_id]
        self.url = reverse('model_catalog')
        
    def test_get_catalog_status(self):
        """Test getting catalog status"""
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('status', response.data)
        self.assertIn('models', response.data)
        self.assertIn(self.model_id, response.data['models'])
        
        model_data = response.data['models'][self.model_id]
        self.assertIn('model_name', model_data)
        self.assertIn('model_type', model_data)
        self.assertIn('image_version', model_data)
        self.assertIn('exists', model_data)
        self.assertIn('disk_usage', model_data)
        
    def test_pull_model(self):
        """Test pulling a model"""
        response = self.client.post(
            self.url,
            {'model_id': self.model_id},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('status', response.data)
        
    def test_pull_model_with_sse(self):
        """Test pulling a model with SSE updates"""
        response = self.client.post(
            self.url,
            {'model_id': self.model_id},
            format='json',
            HTTP_ACCEPT='text/event-stream'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response['Content-Type'], 'text/event-stream')
        
    def test_pull_invalid_model(self):
        """Test pulling an invalid model"""
        response = self.client.post(
            self.url,
            {'model_id': 'invalid_model'},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        
    def test_eject_model(self):
        """Test ejecting a model"""
        response = self.client.delete(
            self.url,
            {'model_id': self.model_id},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('status', response.data)
        self.assertEqual(response.data['status'], 'success')
        
    def test_eject_invalid_model(self):
        """Test ejecting an invalid model"""
        response = self.client.delete(
            self.url,
            {'model_id': 'invalid_model'},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        
    def test_cancel_pull(self):
        """Test cancelling a model pull"""
        response = self.client.patch(
            self.url,
            {'model_id': self.model_id},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('status', response.data)
        self.assertEqual(response.data['status'], 'success')
        
    def test_cancel_invalid_pull(self):
        """Test cancelling an invalid model pull"""
        response = self.client.patch(
            self.url,
            {'model_id': 'invalid_model'},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class DockerPullTest(APITestCase):
    """Test suite for Docker image pull functionality with SSE streaming"""
    
    def setUp(self):
        # Get a valid model_id from model_implmentations
        self.model_id = list(model_implmentations.keys())[0]
        self.model = model_implmentations[self.model_id]
        self.pull_url = reverse('docker-pull-image')
        self.status_url = reverse('docker-image-status', kwargs={'model_id': self.model_id})
        
    def test_pull_image_with_sse(self):
        """Test pulling a Docker image with SSE streaming updates"""
        # First check initial image status
        status_response = self.client.get(self.status_url)
        self.assertEqual(status_response.status_code, status.HTTP_200_OK)
        initial_status = status_response.json()
        logger.info(f"Initial image status: {initial_status}")
        
        # Start the pull with SSE
        headers = {
            'Accept': 'text/event-stream',
            'Content-Type': 'application/json'
        }
        data = {'model_id': self.model_id}
        
        # Make the request and get the streaming response
        response = self.client.post(
            self.pull_url,
            data=data,
            format='json',
            HTTP_ACCEPT='text/event-stream'
        )
        
        # Verify response is streaming
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response['Content-Type'], 'text/event-stream')
        
        # Process the SSE stream
        events = []
        for line in response.content.decode('utf-8').split('\n'):
            if line.startswith('data: '):
                try:
                    event_data = json.loads(line[6:])
                    events.append(event_data)
                    logger.info(f"Received SSE event: {event_data}")
                    
                    # Verify event structure
                    self.assertIn('status', event_data)
                    self.assertIn('progress', event_data)
                    if 'message' in event_data:
                        self.assertIsInstance(event_data['message'], str)
                except json.JSONDecodeError:
                    logger.error(f"Failed to parse SSE data: {line}")
        
        # Verify we got some events
        self.assertTrue(len(events) > 0, "No SSE events received")
        
        # Verify first event is "starting"
        self.assertEqual(events[0]['status'], 'starting')
        self.assertEqual(events[0]['progress'], 0)
        
        # Verify last event is "success" or "error"
        last_event = events[-1]
        self.assertIn(last_event['status'], ['success', 'error'])
        if last_event['status'] == 'success':
            self.assertEqual(last_event['progress'], 100)
        
        # Check final image status
        final_status_response = self.client.get(self.status_url)
        self.assertEqual(final_status_response.status_code, status.HTTP_200_OK)
        final_status = final_status_response.json()
        logger.info(f"Final image status: {final_status}")
        
        # If pull was successful, verify image exists
        if last_event['status'] == 'success':
            self.assertTrue(final_status['exists'])
            self.assertNotEqual(final_status['size'], '0MB')
    
    def test_pull_image_regular(self):
        """Test pulling a Docker image with regular (non-SSE) response"""
        data = {'model_id': self.model_id}
        response = self.client.post(self.pull_url, data=data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('status', response.data)
        self.assertIn('message', response.data)
    
    def test_pull_invalid_model(self):
        """Test pulling an invalid model ID"""
        data = {'model_id': 'invalid_model_id'}
        response = self.client.post(
            self.pull_url,
            data=data,
            format='json',
            HTTP_ACCEPT='text/event-stream'
        )
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('message', response.data)
        self.assertIn('not found', response.data['message'].lower())
    
    def test_pull_cancellation(self):
        """Test cancelling an ongoing pull"""
        # Start a pull
        data = {'model_id': self.model_id}
        pull_response = self.client.post(
            self.pull_url,
            data=data,
            format='json',
            HTTP_ACCEPT='text/event-stream'
        )
        
        # Cancel the pull
        cancel_url = reverse('docker-cancel-pull')
        cancel_response = self.client.patch(
            cancel_url,
            data=data,
            format='json'
        )
        
        self.assertEqual(cancel_response.status_code, status.HTTP_200_OK)
        self.assertIn('status', cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'success')
