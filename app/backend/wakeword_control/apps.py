# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from pathlib import Path

from django.apps import AppConfig

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


class WakeWordConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wakeword_control"

    def ready(self):
        if not MODELS_DIR.parent.is_dir():
            return  # volume not mounted — nothing to do here

        bundled = (BUNDLED_DIR / f"{WAKEWORD_MODEL}.onnx").is_file()
        manual = (MODELS_DIR / f"{WAKEWORD_MODEL}.onnx").is_file()
        have_preprocessing = (MODELS_DIR / "melspectrogram.onnx").exists()
        have_wake_word = bundled or manual or any(MODELS_DIR.glob(f"{WAKEWORD_MODEL}_*.onnx"))
        if have_preprocessing and have_wake_word:
            return  # nothing to fetch

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        from openwakeword.utils import download_models
    
        download_models(
            model_names=["hey_jarvis" if (bundled or manual) else WAKEWORD_MODEL],
            target_directory=str(MODELS_DIR),
        )
