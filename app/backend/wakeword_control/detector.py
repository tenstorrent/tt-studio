# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import logging
import time

import numpy as np
from openwakeword.model import Model

from .apps import BUNDLED_DIR, MODELS_DIR, WAKEWORD_DEBUG_SCORES, WAKEWORD_MODEL, WAKEWORD_THRESHOLD

logger = logging.getLogger(__name__)


def _resolve_wake_model_path():
    # Resolution order: repo-bundled → manually dropped in volume → downloaded.
    bundled = BUNDLED_DIR / f"{WAKEWORD_MODEL}.onnx"
    if bundled.is_file():
        return bundled
    manual = MODELS_DIR / f"{WAKEWORD_MODEL}.onnx"
    if manual.is_file():
        return manual
    return next(MODELS_DIR.glob(f"{WAKEWORD_MODEL}_*.onnx"))


class WakeDetector:
    def __init__(self, threshold: float = WAKEWORD_THRESHOLD, debounce_seconds: float = 1.5):
        self.threshold = threshold
        self.debounce_seconds = debounce_seconds
        self._model = Model(
            wakeword_models=[str(_resolve_wake_model_path())],
            melspec_model_path=str(MODELS_DIR / "melspectrogram.onnx"),
            embedding_model_path=str(MODELS_DIR / "embedding_model.onnx"),
            inference_framework="onnx",
        )
        self._last_fire = 0.0

    def process_frame(self, pcm_bytes: bytes) -> dict | None:
        audio = np.frombuffer(pcm_bytes, dtype=np.int16)
        scores = self._model.predict(audio)
        top_model, top_score = max(scores.items(), key=lambda kv: kv[1])

        if WAKEWORD_DEBUG_SCORES and top_score >= 0.1:
            logger.info("wake score=%.3f model=%s threshold=%.2f", top_score, top_model, self.threshold)

        now = time.monotonic()
        if now - self._last_fire < self.debounce_seconds:
            return None

        if top_score >= self.threshold:
            self._last_fire = now
            return {"event": "wake", "model": top_model, "score": float(top_score)}
        return None
