# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""ONNX cross-encoder reranker for retrieval candidates.

Runs ms-marco-MiniLM-L-6-v2 (quantized ONNX export) on onnxruntime — no torch,
keeping the backend image free of CUDA wheels. The model (~23 MB) is fetched
once into the shared HF cache volume; if it cannot be loaded (e.g. offline
first boot) reranking is skipped and retrieval falls back to fusion order.
"""

import threading
import time

import numpy as np

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

RERANK_MODEL_REPO = "Xenova/ms-marco-MiniLM-L-6-v2"
_MODEL_FILE = "onnx/model_quantized.onnx"
_TOKENIZER_FILE = "tokenizer.json"
_MAX_LENGTH = 512
_BATCH_SIZE = 16
_RETRY_COOLDOWN_SECONDS = 300.0

_lock = threading.Lock()
_instance = None
_next_retry_at = 0.0


class ONNXCrossEncoder:
    def __init__(self, model_path: str, tokenizer_path: str):
        import onnxruntime
        from tokenizers import Tokenizer

        self.tokenizer = Tokenizer.from_file(tokenizer_path)
        self.tokenizer.enable_truncation(max_length=_MAX_LENGTH)
        self.tokenizer.enable_padding()
        self.session = onnxruntime.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self._input_names = {i.name for i in self.session.get_inputs()}

    def score(self, query: str, texts: list[str]) -> list[float]:
        scores: list[float] = []
        for start in range(0, len(texts), _BATCH_SIZE):
            batch = texts[start : start + _BATCH_SIZE]
            encodings = self.tokenizer.encode_batch([(query, t) for t in batch])
            feed = {
                "input_ids": np.array([e.ids for e in encodings], dtype=np.int64),
                "attention_mask": np.array(
                    [e.attention_mask for e in encodings], dtype=np.int64
                ),
            }
            if "token_type_ids" in self._input_names:
                feed["token_type_ids"] = np.array(
                    [e.type_ids for e in encodings], dtype=np.int64
                )
            logits = self.session.run(None, feed)[0][:, 0]
            scores.extend((1.0 / (1.0 + np.exp(-logits))).tolist())
        return scores


def _load() -> "ONNXCrossEncoder":
    from huggingface_hub import hf_hub_download

    paths = {}
    for filename in (_MODEL_FILE, _TOKENIZER_FILE):
        try:
            paths[filename] = hf_hub_download(
                RERANK_MODEL_REPO, filename, local_files_only=True
            )
        except Exception:
            paths[filename] = hf_hub_download(RERANK_MODEL_REPO, filename)
    return ONNXCrossEncoder(paths[_MODEL_FILE], paths[_TOKENIZER_FILE])


def get_reranker():
    """Lazy singleton; returns None (with a retry cooldown) when unavailable."""
    global _instance, _next_retry_at
    if _instance is not None:
        return _instance
    if time.monotonic() < _next_retry_at:
        return None
    with _lock:
        if _instance is not None:
            return _instance
        if time.monotonic() < _next_retry_at:
            return None
        try:
            _instance = _load()
            logger.info(f"Loaded ONNX reranker {RERANK_MODEL_REPO}")
        except Exception as e:
            _next_retry_at = time.monotonic() + _RETRY_COOLDOWN_SECONDS
            logger.warning(
                f"Reranker unavailable ({e}); retrying in {_RETRY_COOLDOWN_SECONDS:.0f}s"
            )
    return _instance


def rerank(query: str, chunks: list) -> tuple[list, bool]:
    """Sort chunks by cross-encoder relevance; (chunks, False) when skipped."""
    encoder = get_reranker()
    if encoder is None or not chunks:
        return chunks, False
    try:
        scores = encoder.score(query, [c.text for c in chunks])
    except Exception as e:
        logger.warning(f"Rerank scoring failed: {e}")
        return chunks, False
    for chunk, score in zip(chunks, scores):
        chunk.rerank_score = float(score)
    return sorted(chunks, key=lambda c: c.rerank_score, reverse=True), True
