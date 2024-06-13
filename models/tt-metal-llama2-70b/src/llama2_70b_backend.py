import os
import time
import traceback
import threading
from multiprocessing import Queue
from functools import partial
from pathlib import Path

import torch
import torch.nn.functional as F

import tt_lib as ttl
import ttnn
from tt_metal_impl.reference.llama import Llama
from transformers.generation.utils import top_k_top_p_filtering
from tt_metal_impl.tt.llama_generation import TtLlamaModelForGeneration
from tt_metal_impl.tt.model_config import (
    get_model_config,
)
# from models.utility_functions import get_devices_for_t3000
from tt_metal_impl.tt.llama_common import get_llama_path, load_llama_state_dict

# from tt_metal_impl.utility_functions import (
#     disable_compilation_reports,
#     disable_persistent_kernel_cache,
#     enable_persistent_kernel_cache,
#     profiler,
#     torch2tt_tensor,
#     tt2torch_tensor,
#     nearest_32,
# )
from transformers.generation.utils import top_k_top_p_filtering

from model_weights_handler import get_model_weights_and_tt_cache_paths
from inference_config import inference_config
from inference_logger import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


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


def get_t3k_device_mesh(num_devices_requested):
    if ttnn.get_num_devices() < 8:
        pytest.skip()
    device_ids = [0, 4, 5, 1, 2, 6, 7, 3]
    device_mesh = ttnn.open_device_mesh(ttnn.DeviceGrid(1, num_devices_requested), device_ids[:num_devices_requested])
    logger.info(f"multidevice with {device_mesh.get_num_devices()} devices is created")
    return device_mesh


class Args:
    def __init__(
        self,
        # model args
        implementation="tt",
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


class UserInfo:
    def __init__(self, user_id, prompt, position_id, params, tokenizer):
        self.user_id = user_id
        self.prompt = prompt
        self.position_id = position_id
        self.num_tokens_generated = 0
        self.num_tokens_prefilled = 0
        self.stop_sequence = None
        self.generation_params = params
        self.max_tokens = params["max_tokens"]
        self.return_prompt = params["return_prompt"]
        self.cancel = False
        self.prefill_complete = False
        self.decode_complete = False
        self.sent_stop = False
        # this may change for each tokenizer
        self.eos_token_id = tokenizer.eos_id
        # tokenize input here
        self.prompt_tokens = tokenizer.encode(prompt, bos=True, eos=False)
        # strip eos token from prompt
        self.prompt_tokens = [tok for tok in self.prompt_tokens if tok != self.eos_token_id]
        self.num_prefill_tokens = len(self.prompt_tokens)
        if params.get("stop_sequence"):
            self.stop_sequence = tokenizer.encode(params.get("stop_sequence"), bos=False, eos=False)


class PrefillDecodeBackend:
    def __init__(
        self,
        model_version,
        batch_size,
        num_layers,
        max_seq_len,
        cache_root,
        verbose=False,
    ) -> None:
        """
        Initialize pybuda model and all infracstructures to continuously run decode
        Maintain a cur_prompts for decode.
        """
        self.max_users = 32
        self.num_users = None
        self.users = [None for _ in range(self.max_users)]
        self.use_cache = True
        # # inputs to model
        self.decode_ids = None
        # backend status
        self.time_last_status = time.time()
        self.update_period = 1  # status message period in seconds
        self.num_steps = 0
        self.verbose = verbose  # enable conditional debug logging
        # new init:
        self.model_version = model_version
        self.batch_size = batch_size
        self.num_layers = num_layers
        self.max_seq_len = max_seq_len
        self.default_top_p = inference_config.model_config.default_top_p
        self.default_top_k = inference_config.model_config.default_top_k
        self.default_temperature = inference_config.model_config.default_temperature
        #
        self.timestamps_start = {}
        self.timestamps_stop = {}
        self.enable_profile_logging = False
        #
        self.device = None
        self.cache_root = Path(cache_root)
        if not self.cache_root.exists():
            self.cache_root.mkdir(parents=True, exist_ok=True)
        # initialization
        self.decode_only = True
        self.init_model()

    def get_users(self):
        return [u for u in self.users if u]

    def get_user_param(self, param):
        return [
            user.generation_params[param] if user is not None else None
            for user in self.users
        ]

    def timer_start(self, name):
        self.timestamps_start[name] = time.time()

    def timer_stop(self, name, log=False):
        if name in self.timestamps_start.keys():
            self.timestamps_stop[name] = time.time()
            timedelta = self.timestamps_stop[name] - self.timestamps_start[name]
            if log or self.enable_profile_logging:
                print(f"timedelta: {name}: {timedelta} seconds")
                logger.info(f"timedelta: {name}: {timedelta} seconds")

    def teardown(self):
        logger.info("teardown ...")
        self.teardown_tt_metal_device()

    def teardown_tt_metal_device(self):
        logger.info("teardown_tt_metal_device ...")
        device_mesh = self.t3k_device_mesh
        for device in device_mesh.get_devices():
            ttl.device.DumpDeviceProfiler(device)
            ttl.device.DeallocateBuffers(device)

        ttnn.close_device_mesh(device_mesh)
        del device_mesh


    def init_tt_metal_device(self, model_config_default):
        logger.info("init_tt_metal_device ...")
        t3k_device_mesh = get_t3k_device_mesh(num_devices_requested=inference_config.n_devices)
        for i in t3k_device_mesh.get_device_ids():
            device = t3k_device_mesh.get_device(i)
            device.enable_program_cache()

        compute_grid_size = t3k_device_mesh.get_device(0).compute_with_storage_grid_size()
        if (
                compute_grid_size.x < model_config_default["MAX_GRID_SIZE"][0]
                or compute_grid_size.y < model_config_default["MAX_GRID_SIZE"][1]
            ):
            logger.error(f"Requires grid size of at least {model_config_default['MAX_GRID_SIZE']} to run")
        
        self.t3k_device_mesh = t3k_device_mesh
        

    def init_model(self):
        # set up variables for model init
        n_devices = inference_config.n_devices
        num_layers = inference_config.model_config.num_layers
        # set weights from tt-studio backend using
        # MODEL_WEIGHTS_ID
        # MODEL_WEIGHTS_PATH
        weights_path, tt_cache_path = get_model_weights_and_tt_cache_paths()
        tokenizer_path = weights_path.joinpath("tokenizer.model")
        logger.info(f"tokenizer_path=:{tokenizer_path}")
        logger.info("init_model ...")
        model_config_default = get_model_config("BFLOAT16-DRAM", num_devices=n_devices)
        self.init_tt_metal_device(model_config_default)
        t3k_device_mesh = self.t3k_device_mesh
        ##
        model_config_default["DEFAULT_CKPT_DIR"] = weights_path.as_posix()
        model_config_default["DEFAULT_TOKENIZER_PATH"] = tokenizer_path.as_posix()
        # DEFAULT_CACHE_PATH is a pathlib.Path
        model_config_default["DEFAULT_CACHE_PATH"] = tt_cache_path
        ##
        # TODO: use get_llama_path with devices
        # t3k_device_mesh = None
        # ckpt_dir = model_config_default["DEFAULT_CKPT_DIR"]
        # tokenizer_path = model_config_default["DEFAULT_TOKENIZER_PATH"]
        # cache_path = model_config_default["DEFAULT_CACHE_PATH"]
        t3k_device_mesh, ckpt_dir, tokenizer_path, cache_path = get_llama_path(
            t3k_device_mesh, model_config_default, n_devices, emulated=False
        )
        
        # set unused vars to None to obviously break any code using them
        args = construct_arg(
            implementation="tt",
            ckpt_dir=ckpt_dir,
            tokenizer_path=tokenizer_path,
            skip_model_load=False,
            num_layers=num_layers,
            num_tokens=None,
            prompts_file=None,
            output_at_end=None,
            top_p=None,
            top_k=None,
            temperature=None,
            device_mesh=t3k_device_mesh,
            n_devices=n_devices,
            emulated=False,
            cache_path=cache_path,
            decode_only=self.decode_only,
        )
        generator = build_generator(args)
        self.model = generator.model
        self.tokenizer = generator.tokenizer

    def _get_user_by_id(self, user_id):
        for user in self.users:
            if user is not None and user.user_id == user_id:
                return user
        return None

    def _get_num_of_users(self):
        # find num of non None users
        return sum([1 for user in self.users if user is not None])

    def _find_free_user_slot(self):
        """return the index of the first free user slot"""
        for i, user in enumerate(self.users):
            if user is None:
                return i

    def _add_users_from_non_empty_queue(self, prompt_q):
        """add users from prompt_q to self.users"""
        while not prompt_q.empty() and self._get_num_of_users() < self.max_users:
            user_id, prompt, params = prompt_q.get()

            # Cancel on special stop token
            if prompt == "<|stop|>":
                if any(
                    (user is not None) and (user_id == user.user_id)
                    for user in self.users
                ):
                    logger.info(f"Cancelling input from user {user_id}")
                    self._get_user_by_id(user_id).cancel = True
                else:
                    logger.info(f"Unexpected cancelling for non-activte user {user_id}")
                continue

            # Don't accept a prompt from a user that's already being procesed
            if any(
                (user is not None) and (user_id == user.user_id) for user in self.users
            ):
                logger.warning(f"Ignoring duplicate input from user {user_id}")
                continue

            user_info = UserInfo(user_id, prompt, 0, params, self.tokenizer)
            idx = self._find_free_user_slot()
            self.users[idx] = user_info
            if self.verbose:
                logger.debug(
                    f"Added user {user_id} to slot {idx} with prompt: {prompt}"
                )

    def pick_prompts(self, prompt_q: Queue):
        if self._get_num_of_users() == self.max_users:
            return

        if self._get_num_of_users() == 0:
            while prompt_q.empty():
                time.sleep(0.02)
            self._add_users_from_non_empty_queue(prompt_q)

        else:
            if prompt_q.empty():
                return
            else:
                self._add_users_from_non_empty_queue(prompt_q)

        # Check for duplicate user_ids and log it
        user_ids = [user.user_id for user in self.users if user is not None]
        if len(user_ids) != len(set(user_ids)):
            logger.warning(f"WARNING: Duplicate user ids: {user_ids}")

    def prepare_inputs(self):
        # empty users get pad id
        input_prompts = [
            user_info.prompt_tokens if user_info else [self.tokenizer.pad_id]
            for user_info in self.users
        ]
        tokens, input_text_mask, eos_reached = intialize_inputs(
            tokenizer=self.tokenizer, prompt_tokens=input_prompts, bsz=self.batch_size, total_len=self.max_seq_len
        )
        # TODO: when prefill is separate change
        self.cur_pos = 1
        self.prev_pos = 0
        # self.prefill_ids = tokens
        self.input_text_mask = input_text_mask
        self.tokens = tokens
        self.decode_ids = tokens[:, :1]
        self.num_users = len(self.get_users())
        # self.num_input_tokens = num_input_tokens
    
    def prefill_via_decode(self):
        # the implementation uses decode
        logger.info("Running prefill_via_decode ...")      

    def prefill(self):
        logger.info("Running prefill ...")
        logger.info("Done prefill")

    def decode(self):
        """
        self.cur_pos is the batch level position
        each user has a generation_pos
        """
        self.timer_stop("all_but_decode")
        self.timer_start("decode_preprocessing")
        self.timer_stop("decode_preprocessing")
        self.timer_start("decode")
        logits = self.model.forward(self.decode_ids, self.prev_pos, decode_only=self.decode_only)
        self.timer_stop("decode")
        self.timer_start("token_selection")
        self.timer_start("batch_top_pk_logits_efficient")
        next_tokens = batch_top_pk_logits_efficient(
            logits,
            top_ps=self.get_user_param("top_p"),
            top_ks=self.get_user_param("top_k"),
            temperatures=self.get_user_param("temperature"),
        ).reshape(self.batch_size, 1)
        self.timer_stop("batch_top_pk_logits_efficient")
        self.decode_ids = next_tokens
        for user_info, user_decode_id in zip(self.users, self.decode_ids):
            if user_info is None:
                continue
            if not user_info.prefill_complete:
                # take next token for prefill
                user_decode_id[0] = user_info.prompt_tokens[user_info.num_tokens_prefilled]
                user_info.num_tokens_prefilled += 1
                if user_info.num_tokens_prefilled >= user_info.num_prefill_tokens:
                    user_info.prefill_complete = True
            else:
                user_info.num_tokens_generated += 1
                if user_decode_id == user_info.eos_token_id:
                    user_info.decode_complete = True
                elif user_info.num_tokens_generated > user_info.max_tokens:
                    user_info.decode_complete = True
                elif (user_info.stop_sequence is not None) and (
                    user_decode_id == user_info.stop_sequence
                ):
                    user_info.decode_complete = True
            if user_info.decode_complete:
                user_decode_id = user_info.eos_token_id

        self.timer_stop("token_selection")
        self.cur_pos += 1
        self.prev_pos += 1
        self.timer_start("all_but_decode")

    def push_outputs(self, output_q):
        for i, token_id in enumerate(self.decode_ids):  # bc input_ids is 1x32
            if self.users[i] is None:
                continue
            elif self.users[i].num_tokens_generated < 1:
                # still prefilling via decode
                continue
            push_token_ids = [token_id.item()]
            return_text = self.tokenizer.decode(push_token_ids)
            output_q.put((self.users[i].user_id, return_text))
            if self.verbose:
                logger.debug(f"user_id:{self.users[i].user_id}, {return_text}")

    def reset_user_memory(self, user_idx, user):
        self.decode_ids[user_idx, 0] = 0

    def update_users(self):
        for i, token_id in enumerate(self.decode_ids):  # bc input_ids is 1x32
            if self.users[i] is None:
                continue

            if (
                token_id == self.users[i].eos_token_id
                and self.users[i].decode_complete
            ):
                self.reset_user_memory(i, self.users[i])
                self.users[i] = None
                if self.verbose:
                    logger.debug(
                        f"Evicted user_id: {self.users[i].user_id} from index {i} in user list"
                    )
            elif (
                token_id == self.users[i].eos_token_id
                and not self.users[i].decode_complete
            ):
                logger.error(
                    f"user_id: {self.users[i].user_id} from index {i} had EOS token but decode_complete=False."
                )
                self.reset_user_memory(i, self.users[i])
                self.users[i] = None
            elif (
                token_id != self.users[i].eos_token_id
                and self.users[i].decode_complete
            ):
                logger.error(
                    f"user_id: {self.users[i].user_id} from index {i} did not have EOS token but decode_complete=True."
                )
                self.reset_user_memory(i, self.users[i])
                self.users[i] = None

    def send_status(self, prompt_q, status_q):
        if time.time() - self.time_last_status > self.update_period:
            # send status queue which includes the (length of the prompt_q, the number of users being decoded rn, the user_ids being decoded)
            cur_status = (
                prompt_q.qsize(),
                self._get_num_of_users(),
                [user.user_id for user in self.users if user is not None],
            )
            status_q.put(cur_status)
            # udpate cur time
            self.time_last_status = time.time()

    def run_generate(self, prompt_q, output_q, status_q, loop_once):
        """
        Continuously pop prompt from prompt_q and push generated tokens to output_q
        while running decode. Automatically swap users from prompt_q
        prompt_q: {'user_id1': 'prompt1', 'user_id2': 'prompt2'...}
        output_q: {'user_id1': 'generated_1', 'user_id3': 'generated_1', 'user_id1': 'generated_2'...}
        stop_event: threading.Event, set to stop safely
        """
        logger.info("starting run_generate ...")
        LOOP_FORVEVER = True
        while LOOP_FORVEVER:
            if self.verbose:
                logger.debug(f"run_generate step: {self.num_steps}")
            self.pick_prompts(prompt_q)  # we update to self.users
            self.prepare_inputs()
            # if any([not user.prefill_complete for user in self.get_users()]):
            #     self.prefill_via_decode()
            logger.info("Running inference decode and pushing results ...")
            while not all([user.decode_complete for user in self.get_users()]):
                self.decode()
                self.push_outputs(output_q)
                self.update_users()
                self.send_status(prompt_q, status_q)
            self.num_steps += 1
            if loop_once:
                break


def batch_top_pk_logits_efficient(
    logits,
    top_ps=[0.9],
    top_ks=[10],
    temperatures=[1.0],
    return_probs=False,
    skip_token=11,
):
    out_tokens = []
    for b_logits, p, k, temperature in zip(logits, top_ps, top_ks, temperatures):
        if p is None:
            # skip None users
            token = torch.tensor([skip_token])
        else:
            # do not keep the entire vocab size after top k. Instead, keep the k size tensor and record the associated indices
            top_k_values, top_k_indices = torch.topk(b_logits, k=k)
            # replace any nans with 0's
            top_k_values = torch.where(
                torch.isnan(top_k_values), torch.zeros_like(top_k_values), top_k_values
            )
            top_p_values = top_k_top_p_filtering(top_k_values, top_p=p)
            probs = F.softmax(top_p_values / temperature, dim=-1)
            top_k_id = torch.multinomial(probs, num_samples=1).squeeze(-1)
            token = top_k_indices.gather(-1, top_k_id.unsqueeze(-1)).squeeze(-1)

        out_tokens.append(token)
    return torch.concat(out_tokens)


def run_backend(prompt_q, output_q, status_q, loop_once=False, verbose=True):
    logger.info("starting run_backend ...")
    with torch.no_grad():
        backend = PrefillDecodeBackend(
            model_version=inference_config.model_config.model_version,
            batch_size=inference_config.model_config.batch_size,
            num_layers=inference_config.model_config.num_layers,
            max_seq_len=inference_config.model_config.max_seq_len,
            cache_root=inference_config.cache_root,
            verbose=verbose,
        )
        try:
            # run generate
            backend.run_generate(prompt_q, output_q, status_q, loop_once)
        except Exception as e:
            logger.error(e)
            # Capture the stack trace
            stack_trace = traceback.format_exc()
            logger.error(stack_trace)
            # Re-raise the exception if you want the process to exit with an error
            raise e
        finally:
            backend.teardown()