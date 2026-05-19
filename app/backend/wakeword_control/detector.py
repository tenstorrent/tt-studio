# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import time

import numpy as np
from openwakeword.model import Model

from .apps import MODELS_DIR, WAKE_MODEL


def _resolve_wake_model_path():
    manual = MODELS_DIR / f"{WAKE_MODEL}.onnx"
    if manual.is_file():
        return manual
    return next(MODELS_DIR.glob(f"{WAKE_MODEL}_*.onnx"))


class WakeDetector:
    def __init__(self, threshold: float = 0.5, debounce_seconds: float = 1.5):
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

        now = time.monotonic()
        if now - self._last_fire < self.debounce_seconds:
            return None

        top_model, top_score = max(scores.items(), key=lambda kv: kv[1])
        if top_score >= self.threshold:
            self._last_fire = now
            return {"event": "wake", "model": top_model, "score": float(top_score)}
        return None
