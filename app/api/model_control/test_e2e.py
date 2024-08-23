# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import time
import os
import logging

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__file__)
logger.setLevel(logging.INFO)
logger.info(f"importing {__file__}")

def test_e2e():
    # get all deployed_ids
    base_url = "http://localhost:3000"
    deployed_url = f"{base_url}/models-api/deployed/"
    inference_url = f"{base_url}/models-api/inference/"
    response = requests.get(deployed_url)
    deployed_data = response.json()
    for deploy_id, v in deployed_data.items():
        valid_api_call(inference_url, deploy_id)

def valid_api_call(api_url, deploy_id, prompt_extra="", print_output=True):
    # set API prompt and optional parameters
    headers = None
    json_data = {
        "text": "What is in Austin Texas?" + prompt_extra,
        "temperature": 1,
        "top_k": 10,
        "top_p": 0.9,
        "max_tokens": 16,
        "stop_sequence": None,
        "return_prompt": None,
        "deploy_id": deploy_id,
    }
    # logger.info("waiting for containers HTTP server to become available ...")
    # time.sleep(2)
    # using requests stream=True, make sure to set a timeout
    logging.info(f"calling: {api_url}, deploy_id: {deploy_id}")
    response = requests.post(
        api_url, json=json_data, headers=headers, stream=True, timeout=35
    )
    # Handle chunked response
    if response.headers.get("transfer-encoding") == "chunked":
        logger.info("processing chunks ...")
        chunks = ""
        for idx, chunk in enumerate(
            response.iter_content(chunk_size=None, decode_unicode=True)
        ):
            # Process each chunk of data as it's received
            chunks += chunk
            if print_output:
                logger.info(chunks)
    else:
        # If not chunked, you can access the entire response body at once
        logger.info("NOT CHUNKED!")
        logger.info(response.text)
    passed = True
    return passed


if __name__ == "__main__":
    test_e2e()
