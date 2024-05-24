import os
import time
import traceback
from multiprocessing import Queue
from functools import partial
from pathlib import Path

import torch
import torch.nn.functional as F
from transformers import AutoTokenizer

if not os.environ.get("MOCK_MODEL"):
    import tt_lib as ttl
    from tt_metal_impl.tt.falcon_causallm import TtFalconCausalLM
    from tt_metal_impl.reference.hf_modeling_falcon import (
        FalconConfig,
        FalconForCausalLM,
    )
    from tt_metal_impl.tt.model_config import (
        get_model_config,
        # get_tt_cache_path,
        model_config_entries,
    )
    from tt_metal_impl.utility_functions import (
        disable_compilation_reports,
        disable_persistent_kernel_cache,
        enable_persistent_kernel_cache,
        profiler,
        torch2tt_tensor,
        tt2torch_tensor,
        nearest_32,
    )
    from transformers.generation.utils import top_k_top_p_filtering

from inference_config import inference_config
from inference_logger import get_logger

logger = get_logger(__name__)
logger.info(f"importing {__name__}")


def preprocess_and_validate_inputs(input_prompts, tokenizer, max_seq_len):
    tokenizer.pad_token = tokenizer.eos_token
    tokenized_inputs = tokenizer(
        input_prompts,
        padding="max_length",
        max_length=max_seq_len,
        add_special_tokens=False,
        return_tensors="pt",
        truncation=True,
    )
    prefill_ids = tokenized_inputs["input_ids"]
    tokenized_inputs_nopad = tokenizer(
        input_prompts,
        padding=False,
        max_length=max_seq_len,
        add_special_tokens=False,
        return_tensors=None,
        truncation=False,
    )

    num_users = len(tokenized_inputs_nopad["input_ids"])
    num_input_tokens = max(
        [len(inputs) for inputs in tokenized_inputs_nopad["input_ids"]]
    )

    logger.info(f"# of users: {num_users}")
    logger.info(f"# of input tokens per user: {num_input_tokens}")

    prefill_ids = prefill_ids[
        :, : nearest_32(num_input_tokens)
    ]  # only pad up to nearest 32, not max seq len

    return prefill_ids, num_users, num_input_tokens


def initialize_kv_cache(configuration, num_layers, batch_size, max_seq_len, device):
    head_dim = configuration.hidden_size // configuration.num_attention_heads
    kv_cache = ()
    for _ in range(num_layers):
        k_cache = torch.zeros(batch_size, 1, max_seq_len, head_dim)
        v_cache = torch.zeros(batch_size, 1, max_seq_len, head_dim)
        tt_k_cache = torch2tt_tensor(k_cache, device)
        tt_v_cache = torch2tt_tensor(v_cache, device)
        kv_cache += ((tt_k_cache, tt_v_cache),)
    return kv_cache


def post_process(logits, index):
    next_token_logits = logits[:, index, :]
    next_tokens = torch.argmax(next_token_logits, dim=-1)
    ids = next_tokens[:, None]
    return ids


class UserInfo:
    def __init__(self, user_id, prompt, position_id, params, tokenizer):
        self.user_id = user_id
        self.prompt = prompt
        self.position_id = position_id
        # TODO: only tokenize once, consolidate with preprocess_and_validate_inputs()
        tokenized = tokenizer(
            prompt,
            padding="max_length",
            return_tensors="pt",
            max_length=2048,
            truncation=True,
        )
        # remove any EOS tokens for input
        tokenized.input_ids = tokenized.input_ids[
            tokenized.input_ids != tokenizer.eos_token_id
        ]
        # pad back to 2048 tokens
        tokenized.input_ids = F.pad(
            tokenized.input_ids,
            (0, 2048 - tokenized.input_ids.size(0)),
            "constant",
            0,
        )

        self.prompt_tokens = tokenized.input_ids.clone().squeeze()  # (2048,)
        self.prompt_length = torch.sum(tokenized.attention_mask).item()  # int
        self.num_tokens_generated = 0
        self.stop_sequence = None
        self.generation_params = params
        self.max_tokens = params["max_tokens"]
        self.return_prompt = params["return_prompt"]
        self.cancel = False
        self.prefill_complete = False
        self.decode_complete = False
        self.sent_stop = False

        if params.get("stop_sequence"):
            self.stop_sequence = tokenizer(params.get("stop_sequence")).input_ids[0]


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
        # self.device = device
        self.batch_size = batch_size
        self.num_layers = num_layers
        self.max_seq_len = max_seq_len
        self.model_config = get_model_config("BFLOAT16-DRAM")
        #
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_version)
        self.tokenizer.pad_token_id = 0
        self.post_processor = partial(post_process)
        self.default_top_p = inference_config.falcon_config.default_top_p
        self.default_top_k = inference_config.falcon_config.default_top_k
        self.default_temperature = inference_config.falcon_config.default_temperature
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
        if not os.environ.get("MOCK_MODEL"):
            self.init_tt_metal()

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

    def model_location_generator(self, model_version, model_subdir=""):
        model_cache_path = Path(self.cache_root) / "tt-metal-models" / model_version
        model_cache_path.mkdir(parents=True, exist_ok=True)
        return model_cache_path

    def get_tt_cache_path(self, model_version, model_subdir="", default_dir=""):
        tt_cache_path = Path(self.cache_root) / "tt-metal-cache" / model_version
        tt_cache_path.mkdir(parents=True, exist_ok=True)
        return tt_cache_path

    def teardown(self):
        logger.info("teardown ...")
        if not os.environ.get("MOCK_MODEL"):
            self.teardown_tt_metal_device()

    def teardown_tt_metal_device(self):
        logger.info("teardown_tt_metal_device ...")
        ttl.device.CloseDevice(self.device)
        ttl.device.DeallocateBuffers(self.device)
        ttl.program_cache.disable_and_clear()

    def init_tt_metal_device(self):
        logger.info("init_tt_metal_device ...")
        # TODO: can this be determined?
        # if not, use environment var
        device_id = int(os.getenv("DEVICE_ID", 0))
        logger.info(f"using DEVICE_ID={device_id}")
        device = ttl.device.CreateDevice(device_id)
        ttl.device.SetDefaultDevice(device)
        self.device = ttl.device.GetDefaultDevice()

    def init_tt_metal(self):
        logger.info("init_tt_metal ...")
        self.init_tt_metal_device()
        ttl.program_cache.disable_and_clear()
        ttl.program_cache.enable()
        disable_persistent_kernel_cache()
        disable_compilation_reports()

        torch.manual_seed(0)

        tt_cache_path = self.get_tt_cache_path(self.model_version)

        configuration = FalconConfig(**model_config_entries)

        # State dict is needed for embeddings
        logger.info("Loading weights...")
        profiler.start(f"loading_weights")
        if len(os.listdir(tt_cache_path)) < 260:
            logger.info("Weights not found on machine; downloading weights...")
            model_cache = self.model_location_generator(self.model_version)
            # use cache_dir arg
            hugging_face_reference_model = FalconForCausalLM.from_pretrained(
                self.model_version, low_cpu_mem_usage=True, cache_dir=model_cache
            )
            hugging_face_reference_model.eval()
            state_dict = hugging_face_reference_model.state_dict()
            torch.save(
                state_dict["transformer.word_embeddings.weight"],
                tt_cache_path / "embedding.pt",
            )
        else:
            state_dict = None

        logger.info("Loading weights finished!")
        profiler.end(f"loading_weights")

        ttl.device.Synchronize(self.device)

        logger.info("Moving weights to device; might take some time...")
        profiler.start(f"moving_to_device")

        base_url = ""
        self.tt_FalconCausalLM = TtFalconCausalLM(
            self.device,
            state_dict,
            base_url,
            self.num_layers,
            configuration,
            self.max_seq_len,
            self.model_config,
            tt_cache_path,
        )

        logger.info("Moved weights to device!")
        profiler.end(f"moving_to_device")

        ttl.device.Synchronize(self.device)

        logger.info("Initializing KV cache...")
        profiler.start(f"initializing_KV_cache")
        self.kv_cache = initialize_kv_cache(
            configuration,
            self.num_layers,
            self.batch_size,
            self.max_seq_len,
            self.device,
        )
        profiler.end(f"initializing_KV_cache")
        profiler.disable()

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
        input_prompts = [user_info.prompt for user_info in self.users if user_info]
        prefill_ids, num_users, num_input_tokens = preprocess_and_validate_inputs(
            input_prompts, self.tokenizer, self.max_seq_len
        )
        self.prefill_ids = prefill_ids
        self.num_users = num_users
        self.num_input_tokens = num_input_tokens

    def prefill(self):
        logger.info("Running prefill ...")
        self.prefill_output_ids = torch.zeros(self.batch_size, 1, dtype=torch.int64)
        for user_idx, user_info in enumerate(self.get_users()):
            if user_info.prefill_complete:
                logger.info(f"user_id={user_idx}: skipping prefill")
                continue
            # TODO: prefill batches of prompts of various lengths arent fully supported
            # currently max length of batch is used, padding tokens will be added
            # could this be supported by prefilling one prompt at a time?
            self.timer_start("prefill_preprocessing")
            (
                tt_prefill_embeddings,
                tt_prefill_attention_mask,
            ) = self.tt_FalconCausalLM.model_preprocessing(
                "prefill",
                self.prefill_ids[user_idx : user_idx + 1],
                0,
                num_input_tokens=self.num_input_tokens,
            )
            self.timer_stop("prefill_preprocessing")
            assert tt_prefill_attention_mask is not None
            self.timer_start("prefill")
            tt_logits, self.kv_cache = self.tt_FalconCausalLM(
                input_embeddings=tt_prefill_embeddings,
                llm_mode="prefill",
                attention_mask=tt_prefill_attention_mask,
                user_id=user_idx,
                layer_past=self.kv_cache,
                layer_past_len=0,
                use_cache=self.use_cache,
            )

            tt_prefill_embeddings.deallocate()
            if tt_prefill_attention_mask is not None:
                tt_prefill_attention_mask.deallocate()
            self.timer_stop("prefill")

            logits = tt2torch_tensor(tt_logits).squeeze(1)
            tt_logits.deallocate()

            # TODO: can we actually use the first token generated via prefill?
            self.prefill_output_ids[user_idx] = self.post_processor(
                logits=logits, index=self.num_input_tokens - 1
            )[0]
            user_info.prefill_complete = True

        self.decode_ids = self.prefill_output_ids.clone()

        self.kv_cache_len = (
            self.num_input_tokens
        )  # This will increment by one after each decode

        ttl.device.Synchronize(self.device)
        logger.info("Done prefill")

    def decode(self):
        self.timer_stop("all_but_decode")
        self.timer_start("decode_preprocessing")
        (
            tt_decode_embeddings,
            tt_decode_attention_mask,
        ) = self.tt_FalconCausalLM.model_preprocessing(
            "decode",
            self.decode_ids,
            self.kv_cache_len,
            num_input_tokens=self.kv_cache_len + 1,
        )
        self.timer_stop("decode_preprocessing")
        assert tt_decode_attention_mask is not None
        self.timer_start("decode")
        tt_logits, self.kv_cache = self.tt_FalconCausalLM(
            input_embeddings=tt_decode_embeddings,
            llm_mode="decode",
            attention_mask=tt_decode_attention_mask,
            layer_past=self.kv_cache,
            layer_past_len=self.kv_cache_len,
            use_cache=self.use_cache,
        )

        tt_decode_embeddings.deallocate()
        if tt_decode_attention_mask is not None:
            tt_decode_attention_mask.deallocate()
        self.timer_stop("decode")
        self.timer_start("decode_get_logits")
        logits = tt2torch_tensor(tt_logits).squeeze(1)
        tt_logits.deallocate()
        self.timer_stop("decode_get_logits")
        self.timer_start("token_selection")
        self.timer_start("batch_top_pk_logits_efficient")
        self.decode_ids = batch_top_pk_logits_efficient(
            logits,
            top_ps=self.get_user_param("top_p"),
            top_ks=self.get_user_param("top_k"),
            temperatures=self.get_user_param("temperature"),
        ).reshape(self.batch_size, 1)
        self.timer_stop("batch_top_pk_logits_efficient")

        for idx, user_decode_id in enumerate(self.decode_ids):
            if self.users[idx] is None:
                continue
            self.users[idx].num_tokens_generated += 1
            if user_decode_id == self.tokenizer.eos_token_id:
                self.users[idx].decode_complete = True
            elif self.users[idx].num_tokens_generated > self.users[idx].max_tokens:
                self.users[idx].decode_complete = True
            elif (self.users[idx].stop_sequence is not None) and (
                user_decode_id == self.users[idx].stop_sequence
            ):
                self.users[idx].decode_complete = True

            if self.users[idx].decode_complete:
                self.decode_ids[idx] = self.tokenizer.eos_token_id
        self.timer_stop("token_selection")
        self.kv_cache_len += 1
        self.timer_start("all_but_decode")

    def push_outputs(self, output_q):
        for i, token_id in enumerate(self.decode_ids):  # bc input_ids is 1x32
            if self.users[i] is None:
                continue
            push_token_ids = []
            push_token_ids.append(token_id.item())
            return_text = self.tokenizer.decode(
                push_token_ids, clean_up_tokenization_spaces=True
            )
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
                token_id == self.tokenizer.eos_token_id
                and self.users[i].decode_complete
            ):
                self.reset_user_memory(i, self.users[i])
                self.users[i] = None
                if self.verbose:
                    logger.debug(
                        f"Evicted user_id: {self.users[i].user_id} from index {i} in user list"
                    )
            elif (
                token_id == self.tokenizer.eos_token_id
                and not self.users[i].decode_complete
            ):
                logger.error(
                    f"user_id: {self.users[i].user_id} from index {i} had EOS token but decode_complete=False."
                )
                self.reset_user_memory(i, self.users[i])
                self.users[i] = None
            elif (
                token_id != self.tokenizer.eos_token_id
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

    def run_generate(self, prompt_q, output_q, status_q):
        """
        Continuously pop prompt from prompt_q and push generated tokens to output_q
        while running decode. Automatically swap users from prompt_q
        prompt_q: {'user_id1': 'prompt1', 'user_id2': 'prompt2'...}
        output_q: {'user_id1': 'generated_1', 'user_id3': 'generated_1', 'user_id1': 'generated_2'...}
        """
        logger.info("starting run_generate ...")
        while True:
            if self.verbose:
                logger.debug(f"run_generate step: {self.num_steps}")
            self.pick_prompts(prompt_q)  # we update to self.users
            self.prepare_inputs()
            if any([not user.prefill_complete for user in self.get_users()]):
                self.prefill()
            logger.info("Running inference decode and pushing results ...")
            while not all([user.decode_complete for user in self.get_users()]):
                self.decode()
                self.push_outputs(output_q)
                self.update_users()
                self.send_status(prompt_q, status_q)
            self.num_steps += 1


def batch_top_pk_logits_efficient(
    logits,
    top_ps=[0.9],
    top_ks=[10],
    temperatures=[1.0],
    return_probs=False,
    skip_token=11,
):
    out_tokens = []
    for b_logits, p, k, temperature in zip(logits[0], top_ps, top_ks, temperatures):
        if p is None:
            # skip None users
            token = torch.tensor([skip_token])
        else:
            # do not keep the entire vocab size after top k. Instead, keep the k size tensor and record the associated indices
            top_k_values, top_k_indices = torch.topk(b_logits.unsqueeze(0), k=k)
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


def run_backend(prompt_q, output_q, status_q, verbose=True):
    logger.info("starting run_backend ...")
    with torch.no_grad():
        backend = PrefillDecodeBackend(
            model_version=inference_config.falcon_config.model_version,
            batch_size=inference_config.falcon_config.batch_size,
            num_layers=inference_config.falcon_config.num_layers,
            max_seq_len=inference_config.falcon_config.max_seq_len,
            cache_root=inference_config.cache_root,
            verbose=verbose,
        )
        try:
            # run generate
            backend.run_generate(prompt_q, output_q, status_q)
        except Exception as e:
            logger.error(e)
            # Capture the stack trace
            stack_trace = traceback.format_exc()
            logger.error(stack_trace)
            # Re-raise the exception if you want the process to exit with an error
            raise e
        finally:
            backend.teardown()
