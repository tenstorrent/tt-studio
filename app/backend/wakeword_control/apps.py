# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import logging
import os
from pathlib import Path

from django.apps import AppConfig

logger = logging.getLogger(__name__)

# Specify wake word model to load, can be overridden with WAKEWORD_MODEL env var.
WAKEWORD_MODEL = os.environ.get("WAKEWORD_MODEL", "hey_quiet_box")

# Detection score above which a wake event fires (0.0–1.0). Lower = more sensitive
WAKEWORD_THRESHOLD = float(os.environ.get("WAKEWORD_THRESHOLD", "0.3"))

# When truthy, logs every per-frame top-score >= 0.1 for debugging purposes
WAKEWORD_DEBUG_SCORES = os.environ.get("WAKEWORD_DEBUG_SCORES", "").lower() in ("1", "true", "yes")

# Repo-bundled wake-word weights. Drop `{name}.onnx` here and set
BUNDLED_DIR = Path(__file__).resolve().parent / "bundled_models"

# Downloaded weights + preprocessing models live in the gitignored persistent volume
MODELS_DIR = Path("/tt_studio_persistent_volume/openwakeword_models")


def _download_preprocessing_models(target_dir: Path) -> None:
    """
    Fetch openWakeWord's Apache-2.0 feature-extraction models (melspectrogram + embedding).
    """
    import openwakeword
    from openwakeword.utils import download_file

    for feature_model in openwakeword.FEATURE_MODELS.values():
        onnx_url = feature_model["download_url"].replace(".tflite", ".onnx")
        if not (target_dir / onnx_url.split("/")[-1]).exists():
            download_file(onnx_url, str(target_dir))


class WakeWordConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wakeword_control"

    def ready(self):
        if not MODELS_DIR.parent.is_dir():
            return  # volume not mounted — nothing to do here

        bundled = (BUNDLED_DIR / f"{WAKEWORD_MODEL}.onnx").is_file()
        manual = (MODELS_DIR / f"{WAKEWORD_MODEL}.onnx").is_file()
        have_preprocessing = (MODELS_DIR / "melspectrogram.onnx").exists() and (
            MODELS_DIR / "embedding_model.onnx"
        ).exists()
        have_wake_word = bundled or manual or any(MODELS_DIR.glob(f"{WAKEWORD_MODEL}_*.onnx"))
        if have_preprocessing and have_wake_word:
            return  # nothing to fetch

        MODELS_DIR.mkdir(parents=True, exist_ok=True)

        if not have_preprocessing:
            try:
                _download_preprocessing_models(MODELS_DIR)
            except Exception:
                logger.warning(
                    "Could not fetch openWakeWord preprocessing models into %s; "
                    "wake-word detection will stay disabled until they are present.",
                    MODELS_DIR,
                    exc_info=True,
                )

        if not have_wake_word:
            # No first-party (bundled/manual) wake-word model present.
            # Wake-word detection simply stays disabled; the app must not crash over it.
            logger.warning(
                "No wake-word model found for '%s' in %s or %s; wake-word detection is "
                "disabled. Drop a first-party '%s.onnx' into the bundled_models dir or the "
                "persistent volume to enable it.",
                WAKEWORD_MODEL,
                BUNDLED_DIR,
                MODELS_DIR,
                WAKEWORD_MODEL,
            )
