import queue
import os
from pathlib import Path
from time import sleep
from unittest.mock import Mock, patch

import torch
from falcon_7b_backend import PrefillDecodeBackend, run_backend
from inference_api_server import get_user_parameters

test_prompts_outputs = [
    ("This is a test prompt.", "this is test output, much longer now"),
    ("Another prompt.", "also test output"),
]


# class MockModel:
#     vocab_size = 10


# def mock_decoder(self):
#     # mock with repeating previous token
#     sleep(0.1)  # 10 TPS
#     output_tokens = torch.zeros((self.max_users), dtype=torch.long)
#     # if user has hit max_length, send eos token
#     for idx, user in enumerate(self.users):
#         if user is not None:
#             if (user.position_id + 1 - user.prompt_length) >= user.max_tokens:
#                 output_tokens[idx] = self.tokenizer.eos_token_id
#             elif (user.position_id + 1 - user.prompt_length) >= 0:
#                 # done prefill, send output tokens
#                 out_idx = user.position_id - user.prompt_length
#                 out_tokens = self.tokenizer(test_prompts_outputs[idx][1]).input_ids
#                 if len(out_tokens) <= out_idx:
#                     output_tokens[idx] = self.tokenizer.eos_token_id
#                 else:
#                     output_tokens[idx] = out_tokens[out_idx]
#                 if (user.stop_sequence is not None) and (
#                     output_tokens[idx] == user.stop_sequence
#                 ):
#                     output_tokens[idx] = self.tokenizer.eos_token_id
#             else:
#                 output_tokens[idx] = user.prompt_tokens.squeeze(0)[user.position_id + 1]
#             print(
#                 f"mock_decoder: idx={idx}: {self.tokenizer.decode(output_tokens[idx])}"
#             )

#     # update the new tokens generated to the input id
#     self.input_ids = output_tokens.view(1, self.max_users)


# def mock_load_model_and_tokenizer(self, args):
#     from transformers import AutoTokenizer

#     # # mock model
#     model = None
#     # Load tokenizer
#     tokenizer = AutoTokenizer.from_pretrained(args.model, cache_dir=args.hf_cache)
#     return model, tokenizer


# @patch.object(DecodeBackend, "decode", new=mock_decoder)
# @patch.object(
#     DecodeBackend, "load_model_and_tokenizer", new=mock_load_model_and_tokenizer
# )
def test_falcon_7b_backend():
    prompt_q = queue.Queue()
    output_q = queue.Queue()
    status_q = queue.Queue()

    # user_id, prompt, params
    default_params, _ = get_user_parameters({"max_tokens": 64})
    prompt_q.put(("INIT_ID-1", "How do you get to Carnegie Hall?", default_params))
    prompt_q.put(("INIT_ID-2", "Another prompt", default_params))
    run_backend(prompt_q, output_q, status_q, verbose=False)
    print("finished")


if __name__ == "__main__":
    test_falcon_7b_backend()
