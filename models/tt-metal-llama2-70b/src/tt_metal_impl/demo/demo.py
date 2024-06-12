# SPDX-FileCopyrightText: © 2023 Tenstorrent Inc.

# SPDX-License-Identifier: Apache-2.0

import os
import json
import torch
import torch.nn.functional as F
import tt_lib

from time import time
import pytest
from loguru import logger

from models.experimental.llama2_70b.reference.llama.llama import Llama
from transformers.generation.utils import top_k_top_p_filtering
from models.experimental.llama2_70b.tt.llama_generation import TtLlamaModelForGeneration
from models.experimental.llama2_70b.tt.model_config import (
    get_model_config,
)
from models.utility_functions import get_devices_for_t3000
from models.experimental.llama2_70b.tt.llama_common import get_llama_path, load_llama_state_dict


def main(args):
    # Set random reproducible seed
    torch.manual_seed(0)

    generator = build_generator(args)

    # Load the model and tokenizer
    model, tokenizer = generator.model, generator.tokenizer

    tokenized, prompts = load_prompts_file(args, tokenizer)

    # Run decode
    with torch.no_grad():
        all_text = run_decode(args=args, model=model, tokenizer=tokenizer, prompt_tokens=tokenized, prompts=prompts)

        if args.output_at_end:
            with open(
                "models/demos/t3000/llama2_70b/demo/data/demo_user_output.txt", "w"
            ) as f:  # Open a file for writing
                for i, text in enumerate(all_text):
                    f.write(f"User {i}: {text}\n")


def build_generator(args):
    generator = Llama.build(
        ckpt_dir=args.ckpt_dir,
        tokenizer_path=args.tokenizer_path,
        max_seq_len=args.max_seq_len,
        max_batch_size=args.max_batch_size,
        skip_model_load=args.skip_model_load,
        n_layers=1 if args.implementation == "tt" else args.num_layers,
    )

    state_dict = load_llama_state_dict(args.ckpt_dir, n_layers=args.num_layers)

    if args.implementation == "tt":
        generator.model = TtLlamaModelForGeneration(
            configuration=generator.model.params,
            state_dict=state_dict,
            device_mesh=args.device_mesh,
            n_devices=args.n_devices,
            n_layers=args.num_layers,
            batch=args.max_batch_size,
            emulated=args.emulated,
            cache_path=args.cache_path,
        )
    return generator


def load_prompts_file(args, tokenizer):
    # Load prompts from json
    prompts = json.load(open(args.prompts_file))
    # Encode the prompt
    tokenized = [tokenizer.encode(x, bos=True, eos=False) for x in prompts]

    if len(tokenized) > args.max_batch_size:
        logger.warn(
            f"Warning: prompts file contains {len(tokenized)} prompts, but max batch size is {args.max_batch_size}. Only first {args.max_batch_size} are decoded."
        )
        tokenized = tokenized[: args.max_batch_size]
        prompts = prompts[: args.max_batch_size]

    return tokenized, prompts


def intialize_inputs(tokenizer, prompt_tokens, bsz, total_len):
    # pad the model to maximum length
    pad_id = tokenizer.pad_id
    tokens = torch.full((bsz, total_len), pad_id, dtype=torch.long, device="cpu")
    for k, t in enumerate(prompt_tokens):
        tokens[k, : len(t)] = torch.tensor(t, dtype=torch.long, device="cpu").clone().detach()
    eos_reached = torch.tensor([False] * bsz, device="cpu")
    input_text_mask = tokens != pad_id  # use prefill token if that token is not masked
    return tokens, input_text_mask, eos_reached


def prepare_next_input(tokenizer, tokens, input_text_mask, cur_pos, next_token):
    # only replace token if prompt has already been generated
    next_token = torch.where(input_text_mask[:, cur_pos], tokens[:, cur_pos], next_token)
    tokens[:, cur_pos] = next_token

    eos_reached = (~input_text_mask[:, cur_pos]) & (next_token == tokenizer.eos_id)
    prev_pos = cur_pos

    return tokens, eos_reached, prev_pos


def run_decode(args, model, tokenizer, prompt_tokens, prompts, return_logits=False, return_full_logits=False):
    """
    return_logits: return the logits for the last token
    return_full_logits: return the logits for all tokens
    """
    assert not (return_logits and return_full_logits), "return_logits and return_full_logits cannot both be true"

    # decode arguments
    bsz = args.max_batch_size
    model_args = model.params
    max_gen_len = args.num_tokens
    args.greedy = args.top_k == 1  # greedy decoding is top-k with k=1

    min_prompt_len = min(len(t) for t in prompt_tokens) if not args.decode_only else 1
    max_prompt_len = max(len(t) for t in prompt_tokens)
    assert max_prompt_len <= model_args.max_seq_len
    total_len = min(model_args.max_seq_len, max_gen_len + max_prompt_len)
    assert total_len <= model_args.max_seq_len

    # prepare inputs
    tokens, input_text_mask, eos_reached = intialize_inputs(tokenizer, prompt_tokens, bsz, total_len)
    prev_pos = 0

    # some profiling and logging
    latencies = []
    full_logits = []

    for cur_pos in range(min_prompt_len, total_len):
        start = time()
        input_tokens = tokens[:, prev_pos:cur_pos]
        logits = model.forward(input_tokens, prev_pos, decode_only=args.decode_only)
        # expects logits to be of shape (bsz, 1, vocab_size)

        # sample next token
        if args.greedy:
            next_token = torch.argmax(logits[:, -1], dim=-1)
        else:
            next_token = top_pk_logits_efficient(
                logits[:, -1], p=args.top_p, k=args.top_k, temperature=args.temperature
            )
        next_token = next_token.reshape(-1)

        tokens, eos_reached, prev_pos = prepare_next_input(tokenizer, tokens, input_text_mask, cur_pos, next_token)

        if all(eos_reached):
            break

        # profiling
        latencies.append(time() - start)

        # Decode the entire sequence generated so far and log it
        for user_id in range(bsz):
            text = tokenizer.decode(tokens[user_id, : cur_pos + 1].tolist())
            logger.info(f"Loop {cur_pos} user {user_id}: {text}\n")

        if return_full_logits:
            full_logits.append(logits.clone().detach())

    latency_printout(latencies, args, total_len - min_prompt_len)
    output = get_all_text(tokenizer, tokens, prompt_tokens, max_gen_len)

    if return_logits:
        output = (output, logits)
    elif return_full_logits:
        full_logits = torch.cat(full_logits, dim=1)
        output = (output, full_logits)
    return output


def latency_printout(latencies, args, generated_len):
    latencies = [
        latency for token_pos, latency in enumerate(latencies) if token_pos % 32 != 0
    ]  # We recompute program_cache for multiples of 32
    overall_time = sum(latencies)
    overall_tokens = args.max_batch_size * len(latencies)
    warmup_batch = 2
    # skip initial warmup batch
    if len(latencies) > warmup_batch:
        overall_time -= sum(latencies[:warmup_batch])
        overall_tokens -= warmup_batch * args.max_batch_size
        latencies = latencies[warmup_batch:]
    mean_latency = sum(latencies) / len(latencies)
    tokens_per_second = 1 / mean_latency if mean_latency != 0 else 0
    overall_tokens_per_second = overall_tokens / overall_time if overall_time != 0 else 0
    tokens_per_second_per_user = overall_tokens_per_second / args.max_batch_size

    logger.info(
        f"Overall throughput: {1000 * overall_time / overall_tokens:.1f} ms @ {overall_tokens_per_second:.1f} tokens/s"
    )
    logger.info(f"Tokens per second per user: {tokens_per_second_per_user:.1f} tokens/s/u")
    logger.info(f"User latency: {1000 * mean_latency:.1f} ms @ {tokens_per_second:.1f} tokens/s")


def get_all_text(tokenizer, tokens, prompt_tokens, max_gen_len):
    out_tokens = []
    for i, toks in enumerate(tokens.tolist()):
        # cut to max gen len
        start = 0
        toks = toks[start : len(prompt_tokens[i]) + max_gen_len]
        # cut to eos tok if any
        if tokenizer.eos_id in toks:
            eos_idx = toks.index(tokenizer.eos_id)
            toks = toks[:eos_idx]
        out_tokens.append(toks)
    all_text = [tokenizer.decode(toks) for toks in out_tokens]
    return all_text


def top_pk_logits_efficient(logits, p=0.9, k=10, temperature=1.0, return_probs=False):
    # do not keep the entire vocab size after top k. Instead, keep the k size tensor and record the associated indices
    top_k_values, top_k_indices = torch.topk(logits, k=k)
    top_p_values = top_k_top_p_filtering(top_k_values, top_p=p)
    probs = F.softmax(top_p_values / temperature, dim=-1)
    top_k_id = torch.multinomial(probs, num_samples=1).squeeze(-1)
    token = top_k_indices.gather(-1, top_k_id.unsqueeze(-1)).squeeze(-1)
    if return_probs:
        return token, (probs, top_k_indices)
    else:
        return token


class Args:
    def __init__(
        self,
        # model args
        implementation="meta",
        ckpt_dir="/home/llama-data-repacked-2/llama-2-70b/",
        tokenizer_path="/home/llama-data/tokenizer.model",
        skip_model_load=False,
        max_batch_size=32,
        num_layers=None,
        max_seq_len=4096,
        # Generation args
        num_tokens=128,
        prompts_file="models/demos/t3000/llama2_70b/demo/data/multi_prompt.json",
        output_at_end=True,
        top_p=1,
        top_k=1,
        temperature=1.0,
        # TT args
        device_mesh=None,
        n_devices=8,
        emulated=False,
        cache_path=None,
        decode_only=False,
    ):
        self.implementation = implementation
        self.ckpt_dir = ckpt_dir
        self.tokenizer_path = tokenizer_path
        self.skip_model_load = skip_model_load
        self.max_batch_size = max_batch_size
        self.num_layers = num_layers
        self.max_seq_len = max_seq_len
        self.num_tokens = num_tokens
        self.prompts_file = prompts_file
        self.output_at_end = output_at_end
        self.top_p = top_p
        self.top_k = top_k
        self.temperature = temperature
        self.device_mesh = device_mesh
        self.n_devices = n_devices
        self.emulated = emulated
        self.cache_path = cache_path
        self.decode_only = decode_only


def construct_arg(**kwargs):
    return Args(**kwargs)


@pytest.mark.timeout(240000)
@pytest.mark.parametrize("decode_only", (True, False), ids=["decode_only", "prefill_decode"])
@pytest.mark.parametrize("num_layers", (1, 2, 10, 80), ids=["1L", "2L", "10L", "80L"])
@pytest.mark.parametrize(
    "implementation, skip_model_load, n_devices, emulated",
    [
        (
            "tt",
            False,
            8,
            False,
        ),
        (
            "meta",
            False,
            8,
            True,
        ),
        (
            "tt",
            False,
            8,
            True,
        ),
    ],
    ids=["tt-70b-T3000", "meta-70b", "tt-70b-emulated"],
)
@pytest.mark.parametrize(
    "num_tokens, prompts_file, output_at_end, top_p, top_k, temperature",
    [
        (128, "models/demos/t3000/llama2_70b/demo/data/multi_prompt.json", True, 1, 1, 1.0),
        (128, "models/demos/t3000/llama2_70b/demo/data/multi_prompt.json", True, 0.9, 10, 1.0),
    ],
    ids=["greedy", "sampling"],
)
def test_LlamaModel_demo(
    # model args
    implementation,
    skip_model_load,
    num_layers,
    # Generation args
    num_tokens,
    prompts_file,
    output_at_end,
    top_p,
    top_k,
    temperature,
    # TT args
    # all_devices,
    t3k_device_mesh,
    n_devices,
    emulated,
    decode_only,
):
    ## Get model config
    # devices = get_devices_for_t3000(all_devices, num_devices=n_devices if not emulated else 1)
    model_config_default = get_model_config("BFLOAT16-DRAM", num_devices=n_devices)

    compute_grid_size = t3k_device_mesh.get_device(0).compute_with_storage_grid_size()
    # if len(devices) < n_devices and emulated == False:
    # pytest.skip(f"Requires at {n_devices} devices to run")
    if (
        compute_grid_size.x < model_config_default["MAX_GRID_SIZE"][0]
        or compute_grid_size.y < model_config_default["MAX_GRID_SIZE"][1]
    ):
        pytest.skip(f"Requires grid size of at least {model_config_default['MAX_GRID_SIZE']} to run")

    t3k_device_mesh, ckpt_dir, tokenizer_path, cache_path = get_llama_path(
        t3k_device_mesh, model_config_default, n_devices, emulated
    )

    for i in t3k_device_mesh.get_device_ids():
        device = t3k_device_mesh.get_device(i)
        device.enable_program_cache()

    args = construct_arg(
        implementation=implementation,
        ckpt_dir=ckpt_dir,
        tokenizer_path=tokenizer_path,
        skip_model_load=skip_model_load,
        num_layers=num_layers,
        num_tokens=num_tokens,
        prompts_file=prompts_file,
        output_at_end=output_at_end,
        top_p=top_p,
        top_k=top_k,
        temperature=temperature,
        device_mesh=t3k_device_mesh,
        n_devices=n_devices,
        emulated=emulated,
        cache_path=cache_path,
        decode_only=decode_only,
    )
    main(args)
