#!/bin/bash

# Exit script if any command fails
set -e

# change directory to TT_METAL_HOME
cd $TT_METAL_HOME

# Run all emulated tests
pytest models/experimental/llama2_70b/tests/test_llama_mlp.py::test_LlamaMLP_inference[decode-8chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_attention.py::test_LlamaAttention_inference[decode-8chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_decoder.py::test_LlamaDecoder_inference[decode-8chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_model.py::test_LlamaModel_inference[decode-8chip-emulated-1L]


pytest models/experimental/llama2_70b/tests/test_llama_mlp.py::test_LlamaMLP_inference[decode-32chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_attention.py::test_LlamaAttention_inference[decode-32chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_decoder.py::test_LlamaDecoder_inference[decode-32chip-emulated]

pytest models/experimental/llama2_70b/tests/test_llama_mlp.py::test_LlamaMLP_inference[prefill_128-8chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_attention.py::test_LlamaAttention_inference[prefill_128-8chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_decoder.py::test_LlamaDecoder_inference[prefill_128-8chip-emulated]
pytest models/experimental/llama2_70b/tests/test_llama_model.py::test_LlamaModel_inference[prefill_128-8chip-emulated-1L]
