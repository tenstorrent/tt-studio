import queue
import os
from pathlib import Path
import time
from unittest.mock import Mock, patch, MagicMock
import sys

from inference_api_server import get_user_parameters
from dummy_echo_backend import run_backend

def test_dummy_backend():
    prompt_q = queue.Queue()
    output_q = queue.Queue()
    status_q = queue.Queue()
    # user_id, prompt, params
    default_params, _ = get_user_parameters({})
    prompt_q.put(("INIT_ID-1", "How do you get to Carnegie Hall?", default_params))
    prompt_q.put(("INIT_ID-2", "Who's on first?", default_params))
    run_backend(prompt_q, output_q, status_q, verbose=False)
    print("finished")


if __name__ == "__main__":
    test_dummy_backend()
