# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Chroma-compatible embedding function backed by a TT-hardware-deployed embedding
model, via the same /v1/embeddings proxy path model_control.EmbeddingInferenceView
uses. Lets a collection be embedded with e.g. Qwen3-Embedding-4B instead of the
default local ONNX MiniLM (see vector_db_control.singletons.get_embedding_function).
"""

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# Prefix that marks a collection's embedding_func_name as TT-hardware-backed
# rather than the local ONNX MiniLM default. The rest of the string is the
# model's stable identity (hf_model_id or model_name) -- never a deploy_id,
# which is a container id that doesn't survive a redeploy.
TT_EMBED_PREFIX = "tt-embed:"


class TTDeployedEmbeddingFunction:
    """A Chroma collection created with embedding_func_name="tt-embed:<model_identifier>"
    resolves back to an instance of this on every get_embedding_function() call.
    The live deploy is re-resolved by model identity on every embed call rather
    than captured once, since deploy/container ids churn across redeploys.
    """

    def __init__(self, model_identifier: str):
        self.model_identifier = model_identifier

    def __call__(self, input):
        # Imported lazily: vector_db_control has no other dependency on
        # model_control, and importing it at module load time would run
        # model_control's own app-loading side effects during vector_db_control's.
        from model_control.model_utils import embed_text, find_deployed_embedding_model

        deploy = find_deployed_embedding_model(self.model_identifier)
        if deploy is None:
            raise RuntimeError(
                f"Embedding model '{self.model_identifier}' is not currently "
                "deployed. Redeploy it to use this collection."
            )
        return [embed_text(deploy, text)["data"][0]["embedding"] for text in input]
