# SPDX-FileCopyrightText: © 2023 Tenstorrent Inc.

# SPDX-License-Identifier: Apache-2.0

import os
import json
from datetime import datetime
from time import time

import torch
import torch.nn.functional as F
from datasets import load_dataset

import tt_lib
import ttnn

from time import time
from loguru import logger

from tt_metal_impl.reference.llama import Llama
from transformers.generation.utils import top_k_top_p_filtering
from tt_metal_impl.tt.llama_generation import TtLlamaModelForGeneration
from tt_metal_impl.tt.llama_common import load_llama_state_dict
from tt_metal_impl.reference.llama.tokenizer3 import ChatFormat
from tt_metal_impl.tt.llama_common import (
    setup_llama_env,
    check_device_mesh,
    string_similarity_score,
)


def main(args):
    # Set random reproducible seed
    torch.manual_seed(0)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    output_filename = (
        f"demo_user_output_{timestamp}.txt"
    )

    generator = build_generator(args)

    # Load the model and tokenizer
    model, tokenizer = generator.model, generator.tokenizer

    batch_tokenized, batch_prompts = load_alpaca_eval(args, tokenizer, n_batches=25)
    # Run decode
    with torch.no_grad():
        for _ in range(100):
            for batch_idx, (tokenized, prompts) in enumerate(
                zip(batch_tokenized, batch_prompts)
            ):
                logger.info(f"starting batch: {batch_idx}, n_users:= {len(tokenized)}")
                all_text = run_decode(
                    args=args,
                    model=model,
                    tokenizer=tokenizer,
                    prompt_tokens=tokenized,
                    prompts=prompts,
                )
                logger.info(f"finished batch: {batch_idx}.")
                # write output after each batch
                if args.output_at_end:
                    with open(output_filename, "a") as f:
                        for i, (text, prompt) in enumerate(zip(all_text, prompts)):
                            f.write(
                                f"\nbatch: {batch_idx} user: {i}\nprompt: {prompt}\noutput: {text}\n"
                            )


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
            cache_path=args.cache_path,
        )
    return generator


def load_alpaca_eval(args, tokenizer, n_batches):
    bsz = args.max_batch_size
    n_samples = bsz * n_batches
    alpaca_ds = load_dataset(
        "tatsu-lab/alpaca_eval", "alpaca_eval", split=f"eval[:{n_samples}]"
    )
    logger.info(f"loaded {len(alpaca_ds)} samples from tatsu-lab/alpaca_eval")
    batch_tokenized = []
    batch_prompts = []
    for batch_idx in range(0, len(alpaca_ds) // bsz):
        batch = alpaca_ds[(batch_idx * bsz) : ((batch_idx * bsz) + bsz)]
        prompts = [batch["instruction"][i] for i in range(0, bsz)]
        tokenized = [tokenizer.encode(p, bos=True, eos=False) for p in prompts]
        batch_prompts.append(prompts)
        batch_tokenized.append(tokenized)
    return batch_tokenized, batch_prompts


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
    min_prompt_len = min(min_prompt_len, args.sample_len) if args.sample_len else min_prompt_len
    max_prompt_len = max(len(t) for t in prompt_tokens)
    max_prompt_len = min(max_prompt_len, args.sample_len) if args.sample_len else max_prompt_len
    assert max_prompt_len <= model_args.max_seq_len
    total_len = min(model_args.max_seq_len, max_gen_len + max_prompt_len)
    assert total_len <= model_args.max_seq_len

    # prepare inputs
    tokens, input_text_mask, eos_reached = intialize_inputs(tokenizer, prompt_tokens, bsz, total_len)
    prev_pos = 0

    # some profiling and logging
    latencies = []

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

    latency_printout(latencies, args, total_len - min_prompt_len)
    output = get_all_text(tokenizer, tokens, prompt_tokens, max_gen_len)

    return output


def latency_printout(latencies, args, generated_len):
    latencies = [
        latency for token_pos, latency in enumerate(latencies) if token_pos % 32 != 0
    ]  # We recompute program_cache for multiples of 32
    overall_time = sum(latencies)
    overall_tokens = args.max_batch_size * len(latencies)
    warmup_batch = 2
    # Skip initial warmup batch
    if len(latencies) > warmup_batch:
        overall_time -= sum(latencies[:warmup_batch])
        overall_tokens -= warmup_batch * args.max_batch_size
        latencies = latencies[warmup_batch:]

    mean_latency = sum(latencies) / len(latencies) if len(latencies) > 0 else 0

    tokens_per_second = 1 / mean_latency if mean_latency != 0 else 0
    overall_tokens_per_second = overall_tokens / overall_time if overall_time != 0 else 0
    tokens_per_second_per_user = overall_tokens_per_second / args.max_batch_size if args.max_batch_size != 0 else 0
    throughput = 1000 * overall_time / overall_tokens if overall_tokens != 0 else 0

    logger.info(f"Overall throughput: {throughput:.1f} ms @ {overall_tokens_per_second:.1f} tokens/s")
    logger.info(f"Tokens per second per user: {tokens_per_second_per_user:.1f} tokens/s/u")
    logger.info(f"User latency: {1000 * mean_latency:.1f} ms @ {tokens_per_second:.1f} tokens/s")


def get_all_text(tokenizer, tokens, prompt_tokens, max_gen_len):
    out_tokens = []
    for i, toks in enumerate(tokens.tolist()):
        try:
            # cut to max gen len
            start = 0
            toks = toks[start : len(prompt_tokens[i]) + max_gen_len]
        except IndexError:
            logger.info(f"Index out of range for sequence {i}, returning entire sequence.")
            pass

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
        ckpt_dir=None,
        tokenizer_path=None,
        skip_model_load=False,
        max_batch_size=32,
        num_layers=None,
        max_seq_len=4096,
        # Generation args
        num_tokens=128,
        prompts_file=None,
        output_at_end=True,
        top_p=1,
        top_k=1,
        temperature=1.0,
        chat=False,
        ground_truth=None,
        sample_len=None,
        # TT args
        device_mesh=None,
        n_devices=8,
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
        self.chat = chat
        self.ground_truth = ground_truth
        self.sample_len = sample_len
        self.device_mesh = device_mesh
        self.n_devices = n_devices
        self.cache_path = cache_path
        self.decode_only = decode_only


def construct_arg(**kwargs):
    return Args(**kwargs)


def get_t3k_device_mesh(num_devices_requested):
    assert ttnn.get_num_devices() == 8
    device_ids = [0, 4, 5, 1, 2, 6, 7, 3]
    t3k_device_mesh = ttnn.open_device_mesh(
        ttnn.DeviceGrid(1, num_devices_requested), device_ids[:num_devices_requested]
    )
    # enable program cache
    for i in t3k_device_mesh.get_device_ids():
        device = t3k_device_mesh.get_device(i)
        device.enable_program_cache()
    logger.info(f"multidevice with {t3k_device_mesh.get_num_devices()} devices is created")   
    return t3k_device_mesh


def close_devices(device_mesh):
    for device in device_mesh.get_devices():
        ttl.device.DumpDeviceProfiler(device)
        ttl.device.DeallocateBuffers(device)

    ttnn.close_device_mesh(device_mesh)
    del device_mesh

if __name__ == "__main__":
    implementation = "tt"
    skip_model_load = False
    num_layers = 80
    num_tokens = 2048
    prompts_file = None
    output_at_end = True
    top_k = 20
    top_p = 0.9
    temperature = 1.0
    chat = True
    n_devices = 8
    decode_only = True
    llama_version = "llama3"
    ground_truth = False
    logger.info("Running LlamaModel demo")
    ## Get model config

    model_config, ckpt_dir, tokenizer_path, cache_path = setup_llama_env(
        llama_version=llama_version,
    )

    t3k_device_mesh = get_t3k_device_mesh(num_devices_requested=n_devices)
    for i in t3k_device_mesh.get_device_ids():
        device = t3k_device_mesh.get_device(i)
        device.enable_async(True)
        
    check_device_mesh(t3k_device_mesh, model_config)

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
        chat=chat,
        device_mesh=t3k_device_mesh,
        n_devices=n_devices,
        cache_path=cache_path,
        decode_only=decode_only,
        ground_truth=ground_truth,
    )
    main(args)
    close_devices(t3k_device_mesh)
