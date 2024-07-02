import os
from time import sleep
from unittest.mock import Mock, patch

import torch

from model_weights_handler import get_model_weights_and_tt_cache_paths
# from tt_metal_impl.reference.llama.tokenizer import Tokenizer
from tt_metal_impl.reference.llama.tokenizer3 import Tokenizer3, ChatFormat
from llama3_70b_backend import PrefillDecodeBackend, run_backend

from llama3_70b_backend import run_backend
from inference_api_server import (
    app,
    initialize_decode_backend,
)
from inference_config import inference_config

"""
This script runs the flask server and initialize_decode_backend()
with the actual model mocked out.

This allows for rapid testing of the server and backend implementation.
"""

backend_initialized = False
api_log_dir = os.path.join(inference_config.log_cache, "api_logs")


def global_backend_init():
    global backend_initialized
    if not backend_initialized:
        # Create server log directory
        if not os.path.exists(api_log_dir):
            os.makedirs(api_log_dir)
        initialize_decode_backend()
        backend_initialized = True


class MockModel:
    def forward(self, tokens: torch.Tensor, start_pos: int, *args, **kwargs):
        assert len(tokens.shape) == 2
        # mock with repeating previous token
        TPS = 10.7
        sleep(1/TPS)
        # update the new tokens generated to the input id
        logits = torch.randn([32, 1, 32000])
        return logits


def mock_init_model(self):
    weights_path, tt_cache_path = get_model_weights_and_tt_cache_paths()
    tokenizer_path = weights_path.joinpath("tokenizer.model")
    # vocab_size = 32000
    self.tokenizer = Tokenizer3(model_path=tokenizer_path.as_posix())
    self.formatter = ChatFormat(self.tokenizer)
    self.model = MockModel()


@patch.object(PrefillDecodeBackend, "init_model", new=mock_init_model)
@patch.object(
    PrefillDecodeBackend, "teardown_tt_metal_device", new=Mock(return_value=None)
)
def create_test_server():
    global_backend_init()
    return app


if __name__ == "__main__":
    app = create_test_server()
    app.run(
        port=inference_config.backend_server_port,
        host="0.0.0.0",
    )
