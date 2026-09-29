# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the fine-tuning (training) phase template in model_control.log_classifier.
"""

from unittest.mock import patch

from shared_config.model_type_config import ModelTypes
from model_control import download_progress
from model_control.log_classifier import (
    LLM_PHASES,
    TRAINING_PHASES,
    category_for_model,
    classify_startup_phase,
)

# Trimmed from a real trainer-training-lora startup on p150 (Llama-3.1-8B-Instruct).
_BOOT = [
    "INFO:     Started server process [20]",
    "INFO:     Waiting for application startup.",
    "2026-09-23 15:49:17,034 - INFO - Settings init: MODEL='Llama-3.1-8B-Instruct', DEVICE='p150', model_runner(default)='trainer-training-lora'",
    "2026-09-23 15:49:21,376 - INFO - Setting up Prometheus metrics...",
    "2026-09-23 15:49:21,398 - INFO - Creating new Training service instance",
    "2026-09-23 15:49:22,479 - INFO - get_device_runner: created TrainerTrainingLoraRunner for worker -1",
]
_DOWNLOAD = [
    "2026-09-23 15:49:22,479 - INFO - Downloading weights for model: meta-llama/Llama-3.1-8B-Instruct",
    "Fetching 17 files:  47%|████▋     | 8/17 [00:00<00:00, 40.03it/s]",
]
_WORKERS = [
    "2026-09-23 15:53:19,966 - INFO - Successfully downloaded model weights to: /home/container_app_user/cache_root/huggingface/models--meta-llama--Llama-3.1-8B-Instruct/snapshots/0e9e39f",
    "2026-09-23 15:53:20,067 - INFO - Job persistence enabled with database",
    "2026-09-23 15:53:20,085 - INFO - Starting worker 0",
    "INFO:     Application startup complete.",
    "INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)",
    "2026-09-23 15:53:20,173 - INFO - setup_runner_environment: device_id='0', is_galaxy=False, device_mesh_shape=(1, 1), model_runner='trainer-training-lora'",
    "2026-09-23 15:53:20,181 - INFO - get_device_runner: created TrainerTrainingLoraRunner for worker 0",
    "2026-09-23 15:53:20,186 - INFO - [warmup] async executed in 0.0037 seconds. Setting up trainer-backed LoRA training",
    "2026-09-23 15:53:20,193 - INFO - Worker 0 reported ready",
]
_HEALTH_OK = ['INFO:     172.18.0.3:33278 - "GET /health HTTP/1.1" 200 OK']


def _classify(lines):
    return classify_startup_phase(lines, now=0.0, model_type=ModelTypes.TRAINING.value)


def test_training_type_selects_training_category():
    assert category_for_model(model_type=ModelTypes.TRAINING.value) == "training"
    assert category_for_model(model_type="TRAINING") == "training"


def test_training_name_alone_stays_llm():
    assert category_for_model(model_name="Llama-3.1-8B-Instruct") == "llm"


def test_training_template_has_no_inference_phases():
    result = _classify(_BOOT)
    assert result["category"] == "training"
    assert result["phases"] == TRAINING_PHASES
    labels = " ".join(result["phase_labels"].values()).lower()
    for inference_only in ("vllm", "kv cache", "inference graph", "api server"):
        assert inference_only not in labels


def test_boot_lines_are_container_starting():
    result = _classify(_BOOT)
    assert result["phase"] == "container_starting"
    assert result["phase_label"] == "Starting container"


def test_download_phase_tracks_repo_in_container():
    result = _classify(_BOOT + _DOWNLOAD)
    assert result["phase"] == "downloading_weights"
    assert result["phase_label"] == "Downloading base model weights"
    assert result["weights_repo"] == "meta-llama/Llama-3.1-8B-Instruct"
    assert result["download_in_container"] is True
    assert result["weights_cached"] is False


def test_post_download_steps_collapse_into_starting_workers():
    result = _classify(_BOOT + _DOWNLOAD + _WORKERS)
    assert result["phase"] == "starting_workers"
    assert result["phase_label"] == "Starting fine-tuning workers"


def test_health_ok_is_ready_for_jobs():
    result = _classify(_BOOT + _DOWNLOAD + _WORKERS + _HEALTH_OK)
    assert result["phase"] == "ready"
    assert result["phase_label"] == "Ready for fine-tuning jobs"
    assert result["progress"] == 100


def test_chat_type_keeps_llm_template():
    result = classify_startup_phase(_BOOT, now=0.0, model_type=ModelTypes.CHAT.value)
    assert result["category"] == "llm"
    assert result["phases"] == LLM_PHASES


def test_full_repo_download_counts_every_file():
    with patch.object(download_progress, "_container_dir_size", return_value=1000), \
            patch.object(download_progress, "_fetch_total_bytes", return_value=None) as fetch:
        download_progress.compute_download_progress(
            deploy_id="train-full", repo="meta-llama/Llama-3.1-8B-Instruct",
            container_path=None, cached=False, full_repo=True,
        )
        fetch.assert_called_with("meta-llama/Llama-3.1-8B-Instruct", subset_only=False)

        download_progress.compute_download_progress(
            deploy_id="media-subset", repo="openai/whisper-large-v3",
            container_path=None, cached=False,
        )
        fetch.assert_called_with("openai/whisper-large-v3", subset_only=True)
    download_progress.prune_state(set())
