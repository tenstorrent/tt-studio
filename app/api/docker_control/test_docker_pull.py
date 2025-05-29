#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

"""
Docker Image Pull Test Script

This script simulates what the UI does when pulling a Docker image,
including handling Server-Sent Events (SSE) for progress updates.

Usage:
    python test_docker_pull.py [model_id]

If model_id is not provided, the first model from model_implmentations will be used.
"""

import json
import sys
import time
import requests
from shared_config.model_config import model_implmentations
from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# Base URL for the API
BASE_URL = "http://localhost:8000"  # Change this if your server is running elsewhere

def check_image_status(model_id):
    """Check the status of a Docker image for a given model"""
    url = f"{BASE_URL}/docker/docker/image_status/{model_id}/"
    response = requests.get(url)
    
    if response.status_code == 200:
        status = response.json()
        logger.info(f"Image status for {model_id}: {status}")
        return status
    else:
        logger.error(f"Failed to check image status: {response.status_code} - {response.text}")
        return None

def pull_image_with_progress(model_id):
    """Pull a Docker image with progress updates via SSE"""
    url = f"{BASE_URL}/docker/docker/pull_image/"
    headers = {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json'
    }
    data = {'model_id': model_id}
    
    logger.info(f"Starting pull for model {model_id}")
    
    try:
        # Make the request with stream=True to get the SSE response
        response = requests.post(url, json=data, headers=headers, stream=True)
        
        if response.status_code != 200:
            logger.error(f"Pull request failed: {response.status_code} - {response.text}")
            return False
        
        # Process the SSE stream
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    try:
                        event_data = json.loads(line[6:])
                        logger.info(f"Progress: {event_data}")
                        
                        # Print a progress bar
                        if 'progress' in event_data:
                            progress = event_data['progress']
                            bar_length = 30
                            filled_length = int(bar_length * progress / 100)
                            bar = '█' * filled_length + '░' * (bar_length - filled_length)
                            print(f"\rProgress: [{bar}] {progress}% - {event_data.get('message', '')}", end='')
                        
                        # If the pull is complete, print a newline and return
                        if event_data.get('status') in ['success', 'error']:
                            print()  # New line after progress bar
                            if event_data['status'] == 'success':
                                logger.info("Pull completed successfully!")
                                return True
                            else:
                                logger.error(f"Pull failed: {event_data.get('message', 'Unknown error')}")
                                return False
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse SSE data: {line}")
        
        logger.warning("Stream ended without success or error status")
        return False
    
    except Exception as e:
        logger.error(f"Error during pull: {str(e)}")
        return False

def cancel_pull(model_id):
    """Cancel an ongoing Docker image pull"""
    url = f"{BASE_URL}/docker/docker/cancel_pull/"
    data = {'model_id': model_id}
    
    try:
        response = requests.patch(url, json=data)
        
        if response.status_code == 200:
            logger.info("Pull cancelled successfully")
            return True
        else:
            logger.error(f"Failed to cancel pull: {response.status_code} - {response.text}")
            return False
    
    except Exception as e:
        logger.error(f"Error cancelling pull: {str(e)}")
        return False

def main():
    # Get model_id from command line or use the first one from model_implmentations
    if len(sys.argv) > 1:
        model_id = sys.argv[1]
        if model_id not in model_implmentations:
            logger.error(f"Invalid model_id: {model_id}")
            print(f"Available models: {list(model_implmentations.keys())}")
            return 1
    else:
        model_id = list(model_implmentations.keys())[0]
        logger.info(f"No model_id provided, using: {model_id}")
    
    # Check initial image status
    initial_status = check_image_status(model_id)
    if not initial_status:
        return 1
    
    # If image already exists, ask if user wants to pull again
    if initial_status.get('exists'):
        print(f"Image for model {model_id} already exists.")
        choice = input("Do you want to pull it again? (y/n): ")
        if choice.lower() != 'y':
            return 0
    
    # Pull the image with progress updates
    print(f"Pulling image for model {model_id}...")
    success = pull_image_with_progress(model_id)
    
    # Check final image status
    final_status = check_image_status(model_id)
    
    if success and final_status and final_status.get('exists'):
        print(f"Image pull completed successfully!")
        print(f"Image size: {final_status.get('size', 'Unknown')}")
        return 0
    else:
        print("Image pull failed or image not found after pull.")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 