# SPDX-FileCopyrightText: © 2023 Tenstorrent Inc.

# SPDX-License-Identifier: Apache-2.0

from loguru import logger
from typing import List
import torch
from torch import nn
import ttnn.experimental as tt_lib
import ttnn
from ttnn import ShardTensorToMesh, ReplicateTensorToMesh, ConcatMeshToTensor, ListMeshToTensor


from models.utility_functions import torch2tt_tensor, pad_by_zero, tt2torch_tensor, nearest_32
from models.experimental.llama2_70b.tt.llama_attention_optimized import TtLlamaAttention_optimized
from models.experimental.llama2_70b.tt.llama_mlp_optimized import TtLlamaMLP_optimized
from models.experimental.llama2_70b.tt.llama_common import (
    tt_all_gather_torch,
    generate_rot_emb,
    get_weight_cache_path,
    get_rotation_mat,
    precompute_freqs,
    gather_cos_sin,
)


class TtLlamaDecoder_optimized:
    def __init__(
        self,
        device_mesh,
        state_dict,
        base_url,
        layer_num,
        model_config,
        configuration,
        batch,
        transformation_mats,
        emulated=False,
        cache_path=None,
        read_cache=False,
    ):
        super().__init__()

        self.state_dict = state_dict
        self.device_mesh = device_mesh
        self.num_devices = device_mesh.get_num_devices()
        self.model_config = model_config
        self.emulated = emulated
        self.read_cache = read_cache

        self.hidden_size = configuration.dim
        self.n_heads = configuration.n_heads
        self.n_local_heads = self.n_heads // self.num_devices
        self.padded_local_heads = 32
        self.head_dim = self.hidden_size // self.n_heads
        self.max_seq_len = configuration.max_seq_len
        self.norm_eps = configuration.norm_eps
        self.rope_theta = configuration.rope_theta

        self.llama3 = configuration.vocab_size == 128256

        self.layer_name = f"{base_url}.{layer_num}"
        self.cache_path = cache_path

        self.attention = TtLlamaAttention_optimized(
            device_mesh,
            state_dict,
            base_url,
            layer_num,
            model_config,
            configuration,
            transformation_mats,
            emulated=emulated,
            cache_path=cache_path,
            read_cache=read_cache,
        )

        self.mlp = TtLlamaMLP_optimized(
            device_mesh,
            state_dict,
            base_url,
            layer_num,
            self.hidden_size,
            model_config,
            emulated=emulated,
            cache_path=cache_path,
            read_cache=read_cache,
        )

        self.load_weights()

    def set_model_config(self, model_config):
        self.model_config = model_config
        self.attention.set_model_config(model_config)
        self.mlp.set_model_config(model_config)

    def load_weights(self):
        """
        Loads weights that this layer is responsible for.
        Doesn't touch the weights of the submodules.
        """
        assert not hasattr(self, "attn_norm"), "attn_norm_list is already an attribute of this object"
        assert not hasattr(self, "ffn_norm"), "ffn_norm_list is already an attribute of this object"
        attn_norm_str = f"{self.layer_name}.attention_norm.weight"
        ffn_norm_str = f"{self.layer_name}.ffn_norm.weight"

        pt_attn_norm = None
        pt_ffn_norm = None
        if not self.read_cache:
            pt_attn_norm = self.state_dict[attn_norm_str].reshape([1, 1, -1, 32])
            pt_ffn_norm = self.state_dict[ffn_norm_str].reshape([1, 1, -1, 32])

        attn_norm_ttnn = ttnn.as_tensor(
            pt_attn_norm,
            dtype=ttnn.bfloat16,
            layout=ttnn.ROW_MAJOR_LAYOUT,
            device=self.device_mesh,
            memory_config=self.model_config["DRAM_MEMCFG"],
            mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
            cache_file_name=self.cache_path / attn_norm_str,
        )
        self.attn_norm = ttnn.to_device(attn_norm_ttnn, self.device_mesh)

        ffn_norm_ttnn = ttnn.as_tensor(
            pt_ffn_norm,
            dtype=ttnn.bfloat16,
            layout=ttnn.ROW_MAJOR_LAYOUT,
            device=self.device_mesh,
            memory_config=self.model_config["DRAM_MEMCFG"],
            mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
            cache_file_name=self.cache_path / ffn_norm_str,
        )
        self.ffn_norm = ttnn.to_device(ffn_norm_ttnn, self.device_mesh)

    def prepare_inputs(self, x, start_pos):
        assert len(x.size()) == 3
        batch, seq_len, hidden_size = x.shape

        cache_name = lambda name: self.cache_path / (f"{'llama3_' if self.llama3 else ''}{name}")

        if self.model_config["LLM_MODE"] == "prefill":
            assert (
                seq_len % 128 == 0 and seq_len > 0 and seq_len <= 2048
            ), "Prefill mode only supports seqlen as a multiple of 128 up to 2k"
            assert batch == 1, "prefill mode only supports batch size 1"
            x = x.unsqueeze(1)  # [batch, 1, seq_len, hidden_dim]

            xs = as_tensor(
                x, ttnn.bfloat16, ttnn.TILE_LAYOUT, None, ShardTensorToMesh(self.device_mesh, dim=3), self.device_mesh
            )
            xs = ttnn.to_device(xs, self.device_mesh)

            cos, sin = precompute_freqs(self.head_dim, self.max_seq_len * 2, self.rope_theta)
            cos_gathered, sin_gathered = gather_cos_sin(torch.arange(start_pos, start_pos + seq_len), cos, sin)
            assert cos_gathered.size() == (1, 1, seq_len, self.head_dim)
            assert sin_gathered.size() == (1, 1, seq_len, self.head_dim)

            cos_gathereds = ttnn.as_tensor(
                cos_gathered,
                dtype=ttnn.bfloat16,
                layout=ttnn.TILE_LAYOUT,
                cache_file_name=cache_name(f"cos_gathered_prefill_{seq_len}"),
                memory_config=self.model_config["DRAM_MEMCFG"],
                device=self.device_mesh,
                mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
            )
            sin_gathereds = ttnn.as_tensor(
                sin_gathered,
                dtype=ttnn.bfloat16,
                layout=ttnn.TILE_LAYOUT,
                cache_file_name=cache_name(f"sin_gathered_prefill_{seq_len}"),
                memory_config=self.model_config["DRAM_MEMCFG"],
                device=self.device_mesh,
                mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
            )
            cos_gathereds = ttnn.to_device(cos_gathereds, self.device_mesh)
            sin_gathereds = ttnn.to_device(sin_gathereds, self.device_mesh)
            rot_mats = [cos_gathereds, sin_gathereds]

            attn_mask = torch.full((seq_len, seq_len), torch.finfo(torch.float32).min)
            attn_mask = torch.triu(attn_mask, diagonal=1)
            attn_mask = attn_mask.expand(batch, 1, -1, -1)
            attn_masks = ttnn.as_tensor(
                attn_mask,
                dtype=ttnn.bfloat16,
                layout=ttnn.TILE_LAYOUT,
                cache_file_name=cache_name(f"attn_mask_prefill_{seq_len}"),
                mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
                device=self.device_mesh,
            )
            attn_masks = ttnn.to_device(attn_masks, self.device_mesh)
            repeat_shape = (1, self.n_local_heads, 1, 1)
            attn_masks = tt_lib.tensor.repeat(
                attn_masks, repeat_shape, output_mem_config=self.model_config["DRAM_MEMCFG"]
            )

        elif self.model_config["LLM_MODE"] == "decode":
            assert seq_len == 1, "Only supporting decode mode"
            x = x.transpose(0, 1).unsqueeze(1)  # [seq_len, 1, batch, hidden_dim]

            xs = ttnn.as_tensor(
                x,
                dtype=ttnn.bfloat16,
                layout=ttnn.TILE_LAYOUT,
                mesh_mapper=ShardTensorToMesh(self.device_mesh, dim=3),
                device=self.device_mesh,
            )
            xs = ttnn.to_device(xs, self.device_mesh)
            xs = tt_lib.tensor.interleaved_to_sharded(
                xs, sharded_mem_config=self.model_config["WORD_EMBEDDING_OUTPUT_MEMCFG"]
            )

            rot_emb = generate_rot_emb(self.head_dim, self.max_seq_len * 2)
            rot_mat = get_rotation_mat(rot_emb, start_pos, seq_len, batch=batch)
            assert rot_mat.size() == (1, batch, self.head_dim, self.head_dim)
            rot_mats = ttnn.as_tensor(
                rot_mat,
                dtype=ttnn.bfloat16,
                layout=ttnn.TILE_LAYOUT,
                mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
                device=self.device_mesh,
            )
            rot_mats = ttnn.to_device(rot_mats, self.device_mesh)

            rot_mats = tt_lib.tensor.interleaved_to_sharded(
                rot_mats, sharded_mem_config=self.model_config["ROT_MAT_MM_IN1_MEMCFG"]
            )

            padded_layer_past_len = nearest_32(start_pos + 1)
            attn_mask_shape = (seq_len, 1, self.padded_local_heads, padded_layer_past_len)
            attn_mask = torch.zeros(*attn_mask_shape)
            attn_mask[:, :, :, start_pos + 1 :] = torch.finfo(attn_mask.dtype).min

            attn_masks = ttnn.as_tensor(
                attn_mask,
                dtype=ttnn.bfloat16,
                layout=ttnn.TILE_LAYOUT,
                mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
                device=self.device_mesh,
            )
            attn_masks = ttnn.to_device(attn_masks, self.device_mesh)

            repeat_shape = (1, batch, 1, 1)
            attn_masks = tt_lib.tensor.repeat(
                attn_masks, repeat_shape, output_mem_config=self.model_config["DRAM_MEMCFG"]
            )
            # Put attn_mask on the device with the sharded config
            attention_mask_memconfig = self.model_config["ATTN_MASK_MEMCFG"]
            if attention_mask_memconfig.is_sharded():
                attn_mask_shard_shape = attention_mask_memconfig.shard_spec.shape
                attn_mask_shard_shape[-1] = padded_layer_past_len
                attention_mask_memconfig.shard_spec.shape = attn_mask_shard_shape

                attn_masks = tt_lib.tensor.interleaved_to_sharded(
                    attn_masks, sharded_mem_config=attention_mask_memconfig
                )

        return (
            xs,
            start_pos,
            rot_mats,
            attn_masks,
        )

    def __call__(
        self,
        xs: List[tt_lib.tensor.Tensor],
        rot_mats: List[tt_lib.tensor.Tensor],
        start_pos: int,
        attn_masks: List[tt_lib.tensor.Tensor],
        user_id: int = 0,
    ) -> tt_lib.tensor.Tensor:
        if self.model_config["LLM_MODE"] == "prefill":
            return self.prefill_forward(xs, rot_mats, start_pos, attn_masks, user_id)
        elif self.model_config["LLM_MODE"] == "decode":
            return self.decode_forward(xs, rot_mats, start_pos, attn_masks)
        else:
            raise ValueError(f"Unknown llm_mode: {self.model_config['LLM_MODE']}")

    def decode_forward(
        self,
        xs: List[tt_lib.tensor.Tensor],
        rot_mats: List[tt_lib.tensor.Tensor],
        start_pos: int,
        attn_masks: List[tt_lib.tensor.Tensor],
    ) -> List[tt_lib.tensor.Tensor]:
        ### xs (residual stream) is fractured on all chips
        # Put xs back on DRAM and do allgather

        # xs_replicated = tt_lib.tensor.sharded_to_interleaved(xs, output_mem_config=self.model_config["L1_MEMCFG"])

        ### Duplicate inputs for layernorm
        # if self.emulated:
        #     xs_replicated = tt_all_gather_torch(xs_replicated, dim=-1)
        # else:
        #     xs_replicated = tt_lib.tensor.all_gather(
        #         xs_replicated,
        #         dim=3,
        #         num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
        #         output_mem_config=self.model_config["L1_MEMCFG"],
        #     )
        xs_replicated = ttnn.all_gather(
            xs,
            dim=3,
            num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
            memory_config=self.model_config["DECODER_ALL_GATHER_OUTPUT_MEMCFG"],
        )

        # RMSNorm must execute on sharded input
        # xs_replicated = tt_lib.tensor.interleaved_to_sharded(
        #     xs_replicated, sharded_mem_config=self.model_config["DECODER_ALL_GATHER_OUTPUT_MEMCFG"]
        # )

        # In-place RMSNorm
        attn_norm_replicated = tt_lib.operations.primary.rmsnorm(
            xs_replicated,
            self.norm_eps,
            self.attn_norm,
            program_config=self.model_config["LN_ATTN_PROGCFG"],
            output_mem_config=self.model_config["LN_ATTN_OUTPUT_MEMCFG"],
            compute_kernel_config=self.model_config["LN_COMPUTE_KERNEL_CONFIG"],
        )
        # attn_norm_replicated is sharded

        # attn_outs is fractured
        attn_outs = self.attention(attn_norm_replicated, rot_mats, start_pos, attn_masks)

        ### Fractured residual add
        # Add attn output to residiual first in place to save memory

        residual = xs
        output = tt_lib.operations.primary.add(
            residual,
            attn_outs,
            output_mem_config=self.model_config["ATTN_ADD_OUTPUT_MEMCFG"],
            in_place=True,
        )
        attn_outs.deallocate(True)

        # Put attn_resid back on DRAM
        # attn_resid_replicated = tt_lib.tensor.sharded_to_interleaved(
        #     output, output_mem_config=self.model_config["L1_MEMCFG"]
        # )

        # ### Duplicate attention residual on all chips
        # if self.emulated:
        #     attn_resid_replicated = tt_all_gather_torch(attn_resid_replicated, dim=-1)
        # else:
        #     attn_resid_replicated = tt_lib.tensor.all_gather(
        #         attn_resid_replicated,
        #         dim=3,
        #         num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
        #         output_mem_config=self.model_config["L1_MEMCFG"],
        #     )
        attn_resid_replicated = ttnn.all_gather(
            output,
            dim=3,
            num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
            memory_config=self.model_config["DECODER_ALL_GATHER_OUTPUT_MEMCFG"],
        )

        # # RMSNorm must execute on sharded input
        # attn_resid_replicated = tt_lib.tensor.interleaved_to_sharded(
        #     attn_resid_replicated, sharded_mem_config=self.model_config["DECODER_ALL_GATHER_OUTPUT_MEMCFG"]
        # )

        # In-place RMSNorm
        ffn_norm_replicated = tt_lib.operations.primary.rmsnorm(
            attn_resid_replicated,
            self.norm_eps,
            self.ffn_norm,
            program_config=self.model_config["LN_MLP_PROGCFG"],
            output_mem_config=self.model_config["LN_MLP_OUTPUT_MEMCFG"],
            compute_kernel_config=self.model_config["LN_COMPUTE_KERNEL_CONFIG"],
        )
        # ffn_norm_replicated is sharded

        ffn_out = self.mlp(ffn_norm_replicated)

        ### residual in place
        output = tt_lib.operations.primary.add(
            output,
            ffn_out,
            output_mem_config=self.model_config["MLP_ADD_OUTPUT_MEMCFG"],
            in_place=True,
        )
        ffn_out.deallocate(True)

        return output

    def sharded_rmsnorm(self, xs, eps, norm_list):
        # Do sharded RMS by partial sequence length of 128 or 512
        # Input xs[0] is [1, 1, seq_len, 8192]
        seq_len = xs.shape[2]
        slice_size = 512 if seq_len == 2048 else 128
        num_slices = seq_len // slice_size  # we do 128 per iteration (slice), then we concat the result.

        xs_output_cat = ttnn.as_tensor(
            torch.zeros([1, 1, seq_len, self.hidden_size]),
            device=self.device_mesh,
            memory_config=self.model_config["DRAM_MEMCFG"],
            dtype=ttnn.bfloat16,
            layout=ttnn.TILE_LAYOUT,
            mesh_mapper=ReplicateTensorToMesh(self.device_mesh),
        )

        layernorm_num_cores_x, layernorm_num_cores_y = (
            self.model_config["layernorm_params"]["layernorm_num_cores_x"],
            self.model_config["layernorm_params"]["layernorm_num_cores_y"],
        )
        layernorm_shard_height_hidden_dim, layernorm_shard_width_hidden_dim = (
            self.model_config["layernorm_params"]["layernorm_shard_height_hidden_dim"],
            self.model_config["layernorm_params"]["layernorm_shard_width_hidden_dim"],
        )

        for slice_i in range(num_slices):
            xs_slice = tt_lib.tensor.interleaved_to_sharded_partial(
                xs,
                (layernorm_num_cores_x, layernorm_num_cores_y),
                [layernorm_shard_height_hidden_dim, layernorm_shard_width_hidden_dim],
                num_slices,  # num_slices
                slice_i,  # slice_index
                tt_lib.tensor.TensorMemoryLayout.BLOCK_SHARDED,
                tt_lib.tensor.ShardOrientation.ROW_MAJOR,
            )

            xs_slice = tt_lib.operations.primary.rmsnorm(
                xs_slice,
                eps,
                norm_list,
                program_config=self.model_config["LN_ATTN_PROGCFG"],
                output_mem_config=self.model_config["LN_ATTN_OUTPUT_MEMCFG"],
                compute_kernel_config=self.model_config["LN_COMPUTE_KERNEL_CONFIG"],
            )

            tt_lib.tensor.sharded_to_interleaved_partial(
                xs_slice,
                xs_output_cat,
                num_slices,
                slice_i,
                self.model_config["DRAM_MEMCFG"],
            )
            xs_slice.deallocate(True)
        return xs_output_cat

    def prefill_forward(
        self,
        xs: List[tt_lib.tensor.Tensor],
        rot_mats: List[tt_lib.tensor.Tensor],
        start_pos: int,
        attn_masks: List[tt_lib.tensor.Tensor],
        user_id: int = 0,
    ) -> List[tt_lib.tensor.Tensor]:
        ### xs (residual stream) is fractured on all chips
        # TODO: Reenable when typcast supports multidevice
        # xs_replicated = []
        # for i in range(self.num_devices):
        #     xs_replicated.append(
        #         tt_lib.tensor.typecast(tt_lib.tensor.clone(xs[i]), dtype=tt_lib.tensor.DataType.BFLOAT8_B)
        #     )

        ### Duplicate inputs for layernorm
        # if self.emulated:
        #     xs_replicated = tt_all_gather_torch(xs_replicated, dim=-1)
        # else:
        #     xs_replicated = tt_lib.tensor.all_gather(
        #         xs_replicated,
        #         dim=3,
        #         num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
        #         output_mem_config=self.model_config["DRAM_MEMCFG"],
        #     )
        xs_replicated = ttnn.all_gather(
            xs,
            dim=3,
            num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
            memory_config=self.model_config["DRAM_MEMCFG"],
        )

        attn_norm_interleaved = self.sharded_rmsnorm(xs_replicated, self.norm_eps, self.attn_norm)

        xs_replicated.deallocate(True)

        # attn_outs is fractured
        attn_outs = self.attention(attn_norm_interleaved, rot_mats, start_pos, attn_masks, user_id)

        ### Fractured residual add
        residual = xs
        output = ttnn.add(residual, attn_outs)
        attn_outs.deallocate(True)

        ### Duplicate attention residual on all chips
        # if self.emulated:
        #     attn_resid_replicated = tt_all_gather_torch(attn_resid_replicated, dim=-1)
        # else:
        #     attn_resid_replicated = tt_lib.tensor.all_gather(
        #         attn_resid_replicated,
        #         dim=3,
        #         num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
        #         output_mem_config=self.model_config["L1_MEMCFG"],
        #     )
        attn_resid_replicated = ttnn.all_gather(
            output,
            dim=3,
            num_links=self.model_config["ALL_GATHER_NUM_LINKS"],
            memory_config=self.model_config["DRAM_MEMCFG"],
        )

        ffn_norm_interleaved = self.sharded_rmsnorm(attn_resid_replicated, self.norm_eps, self.ffn_norm)

        attn_resid_replicated.deallocate(True)

        ffn_out = self.mlp(ffn_norm_interleaved)

        ### residual add
        output = ttnn.add(output, ffn_out)
        ffn_out.deallocate(True)
        return output
