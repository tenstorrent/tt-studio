import time
import traceback
from multiprocessing import Queue
from pathlib import Path

from inference_config import inference_config
from inference_logger import get_logger
from model_weights_handler import get_model_weights_and_tt_cache_paths

logger = get_logger(__name__)
logger.info(f"importing {__name__}")
END_OF_TEXT = 11
SPACE = 204


class UserInfo:
    def __init__(self, user_id, prompt, position_id, params, tokenizer=None):
        self.user_id = user_id
        self.prompt = prompt
        self.position_id = position_id
        self.num_tokens_generated = 0
        self.stop_sequence = None
        self.generation_params = params
        self.max_tokens = params["max_tokens"]
        self.return_prompt = params["return_prompt"]
        self.cancel = False
        self.prefill_complete = False
        self.decode_complete = False
        self.sent_stop = False


class DummyEchoBackend:
    def __init__(
        self,
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
        self.outputs = [None for _ in range(self.max_users)]
        # backend status
        self.time_last_status = time.time()
        self.update_period = 1  # status message period in seconds
        self.num_steps = 0
        self.verbose = verbose  # enable conditional debug logging
        # new init:
        self.enable_profile_logging = False
        self.cache_root = Path(cache_root)
        if not self.cache_root.exists():
            self.cache_root.mkdir(parents=True, exist_ok=True)
        weights_path, tt_cache_path = get_model_weights_and_tt_cache_paths()

    def teardown(self):
        pass

    def get_users(self):
        return [u for u in self.users if u]

    def get_user_param(self, param):
        return [
            user.generation_params[param] if user is not None else None
            for user in self.users
        ]

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
            user_id, rag_context, prompt, params = prompt_q.get()
            if rag_context:
                prompt = rag_context + prompt
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

            user_info = UserInfo(user_id, prompt, 0, params, None)
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
   
    def decode(self):
        # simulate TPS of a real LLM
        chars_per_token = 3
        tokens_per_second = 12.0
        time.sleep(1.0/tokens_per_second)
        for idx, user in enumerate(self.users):
            if user is None:
                continue
            self.outputs[idx] = user.prompt[user.position_id:user.position_id+chars_per_token]
            user.position_id += chars_per_token
            if user.position_id >= len(user.prompt):
                self.users[idx].decode_complete = True
                self.outputs[idx] += inference_config.end_of_sequence_str

    def push_outputs(self, output_q):
        for idx, user in enumerate(self.users):
            if user is None:
                continue
            return_text = self.outputs[idx]
            output_q.put((user.user_id, return_text))
            if self.verbose:
                logger.debug(f"user_id:{user.user_id}, {return_text}")

    def reset_user_memory(self, user_idx, user):
        self.outputs[user_idx] = None

    def update_users(self):
        for idx, user in enumerate(self.users):
        # for i, token_id in enumerate(self.decode_ids):
            if user is None:
                continue

            if user.decode_complete:
                self.reset_user_memory(idx, self.users[idx])
                if self.verbose:
                    logger.debug(
                        f"Evicting user_id: {user.user_id} from index {idx} in user list"
                    )
                self.users[idx] = None

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
            logger.info("Running inference decode and pushing results ...")
            while not all([user.decode_complete for user in self.get_users()]):
                self.decode()
                self.push_outputs(output_q)
                self.update_users()
                self.send_status(prompt_q, status_q)
            self.num_steps += 1


def run_backend(prompt_q, output_q, status_q, verbose=True):
    logger.info("starting run_backend ...")
    backend = DummyEchoBackend(
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
