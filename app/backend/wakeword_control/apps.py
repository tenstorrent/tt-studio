# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import os
from pathlib import Path

from django.apps import AppConfig

# Specify wake word model to load, can be overridden with WAKEWORD_MODEL env var.
WAKE_MODEL = os.environ.get("WAKEWORD_MODEL", "hey_jarvis")

# All weights (preprocessing + wake word, downloaded and manually-added) live in
# the gitignored persistent volume so the image stays small and files survive
# container rebuilds.
MODELS_DIR = Path("/tt_studio_persistent_volume/openwakeword_models")


class WakeWordConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wakeword_control"

    def ready(self):
        if not MODELS_DIR.parent.is_dir():
            return  # volume not mounted — nothing to do here

        manual = (MODELS_DIR / f"{WAKE_MODEL}.onnx").is_file()
        have_preprocessing = (MODELS_DIR / "melspectrogram.onnx").exists()
        have_wake_word = manual or any(MODELS_DIR.glob(f"{WAKE_MODEL}_*.onnx"))
        if have_preprocessing and have_wake_word:
            return  # nothing to fetch

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        from openwakeword.utils import download_models
        # download_model into MODELS_DIR
        download_models(
            model_names=["hey_jarvis" if manual else WAKE_MODEL],
            target_directory=str(MODELS_DIR),
        )
