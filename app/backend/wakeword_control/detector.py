# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import time

import numpy as np
from openwakeword.model import Model


class WakeDetector:
    def __init__(self, threshold: float = 0.5, debounce_seconds: float = 1.5):
        self.threshold = threshold
        self.debounce_seconds = debounce_seconds
        self._model = Model(inference_framework="onnx")
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
