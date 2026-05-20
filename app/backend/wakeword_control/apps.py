# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from pathlib import Path

from django.apps import AppConfig

# Specify wake word model to load, can be overridden with WAKEWORD_MODEL env var.
WAKE_MODEL = os.environ.get("WAKEWORD_MODEL", "hey_jarvis")

# Detection score above which a wake event fires (0.0–1.0). Lower = more
# sensitive (triggers at lower confidence, more false positives).
# Default 0.5 is openwakeword's recommendation; try 0.3 if you have to shout.
WAKE_THRESHOLD = float(os.environ.get("WAKEWORD_THRESHOLD", "0.5"))

# When truthy, log every per-frame top-score >= 0.1 so you can see what the
# model is actually outputting and pick a threshold empirically.
WAKE_DEBUG_SCORES = os.environ.get("WAKEWORD_DEBUG_SCORES", "").lower() in ("1", "true", "yes")

# Repo-bundled wake-word weights. Drop `{name}.onnx` here and set
# WAKEWORD_MODEL={name} to ship a custom model with the repo. Use this for
# small custom-trained models that have no other download source; downloaded
# pretrained models from openwakeword should NOT go here (they live in the
# persistent volume to keep the repo lean).
BUNDLED_DIR = Path(__file__).resolve().parent / "bundled_models"

# Downloaded weights + preprocessing models live in the gitignored persistent
# volume so the image stays small and files survive container rebuilds.
MODELS_DIR = Path("/tt_studio_persistent_volume/openwakeword_models")


class WakeWordConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wakeword_control"

    def ready(self):
        if not MODELS_DIR.parent.is_dir():
            return  # volume not mounted — nothing to do here

        bundled = (BUNDLED_DIR / f"{WAKE_MODEL}.onnx").is_file()
        manual = (MODELS_DIR / f"{WAKE_MODEL}.onnx").is_file()
        have_preprocessing = (MODELS_DIR / "melspectrogram.onnx").exists()
        have_wake_word = bundled or manual or any(MODELS_DIR.glob(f"{WAKE_MODEL}_*.onnx"))
        if have_preprocessing and have_wake_word:
            return  # nothing to fetch

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        from openwakeword.utils import download_models
        # download_models always fetches the preprocessing pair. If the wake
        # word is bundled in-repo (or dropped manually) we only need that
        # preprocessing, so pass a known pretrained name to trigger it.
        download_models(
            model_names=["hey_jarvis" if (bundled or manual) else WAKE_MODEL],
            target_directory=str(MODELS_DIR),
        )
