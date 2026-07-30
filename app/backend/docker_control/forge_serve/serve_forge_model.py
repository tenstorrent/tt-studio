# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"""OpenAI-compatible server for an arbitrary Hugging Face model, compiled by Forge.

Runs bare metal: spawned as a plain host subprocess by inference-api's
POST /forge-loader/launch (inference-api runs directly on the host, unlike the Django
backend, which is containerised and cannot spawn a genuinely host-level process). It
drives the tt-xla vLLM plugin directly rather than going through tt-media-server, whose
ModelNames enum hard-fails on any model it doesn't already know -- which is every model
Forge Loader exists to serve. The plugin layer has no model whitelist and defers to
vLLM's own registry.

Configured entirely by environment:
    FORGE_MODEL                 HF repo id, e.g. ibm-granite/granite-4.1-8b
    FORGE_PORT                  port to serve on (default 8000)
    FORGE_MAX_MODEL_LEN         context cap (default 2048; models advertise far more
                                than one chip can hold)
    FORGE_MAX_NUM_SEQS          concurrent sequences (default 1)
    FORGE_GPU_MEMORY_UTILIZATION  fraction for weights + KV cache (default 0.35)
"""
import asyncio
import os
import sys

MODEL = os.environ["FORGE_MODEL"]
PORT = os.environ.get("FORGE_PORT", "8000")
MAX_MODEL_LEN = os.environ.get("FORGE_MAX_MODEL_LEN", "2048")
MAX_NUM_SEQS = os.environ.get("FORGE_MAX_NUM_SEQS", "1")
GPU_MEM_UTIL = os.environ.get("FORGE_GPU_MEMORY_UTILIZATION", "0.35")

def _resolve_tt_metal_home() -> str:
    """tt-metal ships inside the pjrt plugin, so we can find it without a shell."""
    home = os.environ.get("TT_METAL_HOME")
    if home:
        return home
    import pjrt_plugin_tt

    return os.path.join(os.path.dirname(pjrt_plugin_tt.__file__), "tt-metal")


# tt-media-server's setup_runner_environment() normally sets this. Bypassing it means
# setting the Blackhole mesh graph descriptor here, or tt-metal aborts at device init on
# a CUSTOM cluster (a single chip carved out of a P300x2) with
# "Custom fabric mesh graph descriptor path must be specified".
# Same fix as tt-inference-server#4785.
_TT_METAL_HOME = _resolve_tt_metal_home()
os.environ["TT_METAL_HOME"] = _TT_METAL_HOME
os.environ.setdefault(
    "TT_MESH_GRAPH_DESC_PATH",
    f"{_TT_METAL_HOME}/tt_metal/fabric/mesh_graph_descriptors/p150_mesh_graph_descriptor.textproto",
)

# Mirrors the generic forge runner (vllm_runner.py). bfp_bf8 holds weights near one byte
# per parameter, which is what lets an 8-9B model share a chip with its KV cache.
ADDITIONAL_CONFIG = {
    "enable_const_eval": True,
    "min_context_len": 128,
    "experimental_weight_dtype": "bfp_bf8",
    "cpu_sampling": False,
    "optimization_level": 1,
    "enable_trace": True,
}


def build_args():
    """Parse vLLM's OpenAI server args, then set what its CLI doesn't expose."""
    from vllm.entrypoints.openai.cli_args import make_arg_parser
    from vllm.utils.argparse_utils import FlexibleArgumentParser

    parser = make_arg_parser(FlexibleArgumentParser(description="Forge Loader server"))
    args = parser.parse_args([
        "--model", MODEL,
        "--served-model-name", MODEL,
        "--host", "0.0.0.0",
        "--port", PORT,
        "--max-model-len", MAX_MODEL_LEN,
        "--max-num-seqs", MAX_NUM_SEQS,
        "--gpu-memory-utilization", GPU_MEM_UTIL,
        "--no-enable-chunked-prefill",
    ])
    # additional_config is a real AsyncEngineArgs field with no CLI flag in this build.
    # from_cli_args() reads dataclass fields off the namespace, so setting it here works.
    args.additional_config = ADDITIONAL_CONFIG
    return args


def main() -> int:
    from vllm.entrypoints.openai.api_server import run_server

    print(f"[forge-loader] model={MODEL} port={PORT}", flush=True)
    print(f"[forge-loader] descriptor={os.environ['TT_MESH_GRAPH_DESC_PATH']}", flush=True)
    print(
        "[forge-loader] compiling: first start downloads weights and captures traces, "
        "so the port stays closed for several minutes",
        flush=True,
    )
    asyncio.run(run_server(build_args()))
    return 0


# vLLM's V1 engine spawns EngineCore as a subprocess that re-imports this file, so the
# work must sit behind a __main__ guard or multiprocessing re-runs it.
if __name__ == "__main__":
    sys.exit(main())
