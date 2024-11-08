# SPDX-FileCopyrightText: © 2023 Tenstorrent Inc.

# SPDX-License-Identifier: Apache-2.0

import torch
from abc import abstractmethod
from typing import Optional, Tuple

import tt_lib

from tt_metal_impl.tt.falcon_decoder import TtFalconDecoderLayer
from tt_metal_impl.utility_functions import (
    torch2tt_tensor,
    pad_by_zero,
    nearest_32,
)


class TtFalconModelShared(torch.nn.Module):
    @abstractmethod
    def __init__(
        self,
        device,
        state_dict,
        base_url,
        num_layers,
        config,
        max_position_embeddings,
        model_config,
        tt_cache_path,
    ):
        super().__init__()

        # NOTE: Once we make embeddings run on device, pass in state dict
        # instead of model itself
        self.device = device
        self.state_dict = state_dict
        self.base_url = base_url
        self.config = config
        self.max_position_embeddings = max_position_embeddings
        self.model_config = model_config

        # So far on CPU until we add embeddings support on device
        self.embeddings = torch.nn.Embedding(config.vocab_size, config.hidden_size)
        self.embeddings.weight = torch.nn.Parameter(
            torch.load(
                str(tt_cache_path / "embedding.pt"), map_location=torch.device("cpu")
            )
        )

        # stack all decoders
        self.layers = torch.nn.ModuleList(
            [
                TtFalconDecoderLayer(
                    device=device,
                    state_dict=state_dict,
                    base_url=f"{base_url}.h",
                    layer_num=layer_num,
                    config=config,
                    max_position_embeddings=max_position_embeddings,
                    model_config=model_config,
                    tt_cache_path=tt_cache_path,
                )
                for layer_num in range(num_layers)
            ]
        )

        layer_name = f"{base_url}"

        layernorm_weights_str = f"{layer_name}.ln_f.weight"
        layernorm_bias_str = f"{layer_name}.ln_f.bias"

        if (
            tt_cache_path
            / f"{layernorm_weights_str}_{self.model_config['LN_F_WEIGHTS_DTYPE'].name}.bin"
        ).exists():
            self.layernorm_gamma = tt_lib.tensor.load_tensor(
                str(
                    tt_cache_path
                    / f"{layernorm_weights_str}_{self.model_config['LN_F_WEIGHTS_DTYPE'].name}.bin"
                )
            ).to(device, self.model_config["LN_F_WEIGHTS_MEMCFG"])
        else:
            self.layernorm_gamma = pad_by_zero(
                self.state_dict[layernorm_weights_str],
                device,
                tt_memory_config=self.model_config["LN_F_WEIGHTS_MEMCFG"],
                tt_dtype=self.model_config["LN_F_WEIGHTS_DTYPE"],
            )[0]
            tt_lib.tensor.dump_tensor(
                str(
                    tt_cache_path
                    / f"{layernorm_weights_str}_{self.model_config['LN_F_WEIGHTS_DTYPE'].name}.bin"
                ),
                self.layernorm_gamma.cpu(),
            )

        if (
            tt_cache_path
            / f"{layernorm_bias_str}_{self.model_config['LN_F_BIAS_DTYPE'].name}.bin"
        ).exists():
            self.layernorm_beta = tt_lib.tensor.load_tensor(
                str(
                    tt_cache_path
                    / f"{layernorm_bias_str}_{self.model_config['LN_F_BIAS_DTYPE'].name}.bin"
                )
            ).to(device, self.model_config["LN_F_BIAS_MEMCFG"])
        else:
            self.layernorm_beta = pad_by_zero(
                self.state_dict[layernorm_bias_str],
                device,
                tt_memory_config=self.model_config["LN_F_BIAS_MEMCFG"],
                tt_dtype=self.model_config["LN_F_BIAS_DTYPE"],
            )[0]
            tt_lib.tensor.dump_tensor(
                str(
                    tt_cache_path
                    / f"{layernorm_bias_str}_{self.model_config['LN_F_BIAS_DTYPE'].name}.bin"
                ),
                self.layernorm_beta.cpu(),
            )

        self.layernorm_eps = config.layer_norm_epsilon

    def model_preprocessing(self, llm_mode, input_ids, kv_cache_len, num_input_tokens):
        assert input_ids.dim() == 2
        batch_size, sequence_size = input_ids.shape

        embeddings = self.embeddings(input_ids)

        # Generate input and attention_mask ---------------------------------------------
        if llm_mode == "prefill":
            assert batch_size == 1, "For prefill, batch_size must be 1!"
            assert (
                sequence_size % 32 == 0
            ), "For prefill, sequence_size must be multiple of 32!"
            assert kv_cache_len == 0, "For prefill, no kv_cache is passed in!"

            tt_embeddings = torch2tt_tensor(
                embeddings.unsqueeze(1),
                self.device,
                tt_memory_config=self.model_config["WORD_EMBEDDING_OUTPUT_MEMCFG"],
                tt_dtype=self.model_config["WORD_EMBEDDING_OUTPUT_DTYPE"],
            )

            attention_mask_bool = torch.ones(
                batch_size, 1, sequence_size, num_input_tokens, dtype=bool
            )
            attention_mask_bool = attention_mask_bool.triu(diagonal=1)

            attention_mask_bool_padded = torch.cat(
                (
                    attention_mask_bool,
                    torch.ones(
                        batch_size,
                        1,
                        sequence_size,
                        sequence_size - num_input_tokens,
                        dtype=bool,
                    ),
                ),
                dim=-1,
            )

            tt_attention_mask = torch2tt_tensor(
                (attention_mask_bool_padded * -1e3).expand(
                    -1, self.config.num_attention_heads, -1, -1
                ),
                self.device,
                tt_memory_config=self.model_config["ATTN_MASK_MEMCFG"],
                tt_dtype=self.model_config["ATTN_MASK_DTYPE"],
            )

        elif llm_mode == "decode":
            assert (
                batch_size % 32 == 0
            ), "For decode, batch_size must be multiple of 32!"
            assert sequence_size == 1, "For decode, q_len must be 1!"

            tt_embeddings = torch2tt_tensor(
                embeddings.unsqueeze(1).transpose(0, 2),
                self.device,
                tt_memory_config=self.model_config["WORD_EMBEDDING_OUTPUT_MEMCFG"],
                tt_dtype=self.model_config["WORD_EMBEDDING_OUTPUT_DTYPE"],
            )

            attention_mask_bool = torch.zeros(
                batch_size, 1, sequence_size, num_input_tokens, dtype=bool
            )

            num_max_tokens = nearest_32(
                kv_cache_len + 1
            )  # Potentially, num_max_tokens must be provided as a separate argument
            attention_mask_bool_padded = torch.cat(
                (
                    attention_mask_bool,
                    torch.ones(
                        batch_size,
                        1,
                        sequence_size,
                        num_max_tokens - num_input_tokens,
                        dtype=bool,
                    ),
                ),
                dim=-1,
            )
            tt_attention_mask = torch2tt_tensor(
                (attention_mask_bool_padded.transpose(0, 2) * -1e3).expand(
                    -1, self.config.num_attention_heads, -1, -1
                ),
                self.device,
                tt_memory_config=self.model_config["ATTN_MASK_MEMCFG"],
                tt_dtype=self.model_config["ATTN_MASK_DTYPE"],
            )

        else:
            raise NotImplementedError(
                f"Llm mode {llm_mode} is not supported! Must be one of prefill or decode."
            )

        return tt_embeddings, tt_attention_mask

    @abstractmethod
    def forward(
        self,
        input_embeddings: tt_lib.tensor.Tensor,
        llm_mode: str,
        attention_mask: tt_lib.tensor.Tensor = None,
        user_id: int = 0,
        layer_past: Optional[Tuple[Tuple[tt_lib.tensor.Tensor]]] = None,
        layer_past_len: int = 0,
        use_cache: bool = False,
    ) -> tt_lib.tensor.Tensor:
        layer_output = input_embeddings
        presents = ()
        for idx, layer in enumerate(self.layers):
            layer_output = layer(
                hidden_states=layer_output,
                alibi=None,
                attention_mask=attention_mask,
                llm_mode=llm_mode,
                user_id=user_id,
                layer_past=layer_past[idx],
                layer_past_len=layer_past_len,
                use_cache=use_cache,
            )
            presents += layer_output[1:]
            layer_output = layer_output[0]

        # apply final norm layer
        layer_output = tt_lib.tensor.layernorm(
            layer_output,
            self.layernorm_eps,
            output_mem_config=self.model_config["LN_F_OUTPUT_MEMCFG"],
        )
        layer_output = tt_lib.tensor.bcast(
            layer_output,
            self.layernorm_gamma,
            tt_lib.tensor.BcastOpMath.MUL,
            tt_lib.tensor.BcastOpDim.H,
            output_mem_config=self.model_config["LN_F_OUTPUT_MEMCFG"],
        )
        layer_output = tt_lib.tensor.bcast(
            layer_output,
            self.layernorm_beta,
            tt_lib.tensor.BcastOpMath.ADD,
            tt_lib.tensor.BcastOpDim.H,
            output_mem_config=self.model_config["LN_F_OUTPUT_MEMCFG"],
        )

        return layer_output, presents


class TtFalconModel(TtFalconModelShared):
    def __init__(
        self,
        device,
        state_dict,
        base_url,
        num_layers,
        config,
        max_position_embeddings,
        model_config,
        tt_cache_path,
    ):
        super().__init__(
            device=device,
            state_dict=state_dict,
            base_url=base_url,
            num_layers=num_layers,
            config=config,
            max_position_embeddings=max_position_embeddings,
            model_config=model_config,
            tt_cache_path=tt_cache_path,
        )

    def forward(
        self,
        input_embeddings: tt_lib.tensor.Tensor,
        llm_mode: str,
        attention_mask: tt_lib.tensor.Tensor = None,
        user_id: int = 0,
        layer_past: Optional[Tuple[Tuple[tt_lib.tensor.Tensor]]] = None,
        layer_past_len: int = 0,
        use_cache: bool = False,
    ) -> tt_lib.tensor.Tensor:
        hidden_states, presents = super().forward(
            input_embeddings=input_embeddings,
            llm_mode=llm_mode,
            attention_mask=attention_mask,
            user_id=user_id,
            layer_past=layer_past,
            layer_past_len=layer_past_len,
            use_cache=use_cache,
        )
        return hidden_states, presents
