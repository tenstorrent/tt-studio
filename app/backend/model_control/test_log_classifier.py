# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the fine-tuning (training) phase template in model_control.log_classifier.
"""

from shared_config.model_type_config import ModelTypes
from model_control.log_classifier import (
    LLM_PHASES,
    TRAINING_PHASES,
    category_for_model,
    classify_startup_phase,
)

# Trimmed from a real trainer-training-lora startup on p150 (Llama-3.1-8B-Instruct)
# with an image that skips the startup weight download.
_BOOT = [
    "2026-10-07 10:14:18,729 - INFO - Settings init: MODEL='Llama-3.1-8B-Instruct', DEVICE='p150', model_runner(default)='trainer-training-lora'",
    "2026-10-07 10:14:18,729 - INFO - Settings resolved: model_runner='trainer-training-lora', model_service='training', device_ids='(0)', is_galaxy=False, device_mesh_shape=(1, 1), model_weights_path='meta-llama/Llama-3.1-8B-Instruct', max_batch_size=1",
    "2026-10-07 10:14:21,877 - INFO - Setting up Prometheus metrics...",
    "INFO:     Started server process [20]",
    "INFO:     Waiting for application startup.",
    "2026-10-07 10:14:21,890 - INFO - Creating new Training service instance",
]
_WORKERS = [
    "2026-10-07 10:14:21,909 - INFO - Job persistence enabled with database",
    "2026-10-07 10:14:21,910 - INFO - Starting worker 0",
    "2026-10-07 10:14:21,916 - INFO - All workers started in sequence",
    "INFO:     Application startup complete.",
    "INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)",
    "2026-10-07 10:14:22,640 - INFO - setup_runner_environment: device_id='0', is_galaxy=False, device_mesh_shape=(1, 1), model_runner='trainer-training-lora'",
    "2026-10-07 10:14:22,640 - INFO - get_device_runner: created TrainerTrainingLoraRunner for worker 0",
    "2026-10-07 10:14:22,640 - INFO - [warmup] async executed in 0.0000 seconds. Setting up trainer-backed LoRA training",
    "2026-10-07 10:14:22,641 - INFO - Worker 0 reported ready",
]
_HEALTH_OK = ['INFO:     172.18.0.4:32770 - "GET /health HTTP/1.1" 200 OK']

# Older forge images still download base weights while the service starts.
_LEGACY_DOWNLOAD = [
    "2026-09-23 15:49:22,479 - INFO - get_device_runner: created TrainerTrainingLoraRunner for worker -1",
    "2026-09-23 15:49:22,479 - INFO - Downloading weights for model: meta-llama/Llama-3.1-8B-Instruct",
    "Fetching 17 files:  47%|████▋     | 8/17 [00:00<00:00, 40.03it/s]",
]


def _classify(lines):
    return classify_startup_phase(lines, now=0.0, model_type=ModelTypes.TRAINING.value)


def test_training_type_selects_training_category():
    assert category_for_model(model_type=ModelTypes.TRAINING.value) == "training"
    assert category_for_model(model_type="TRAINING") == "training"


def test_training_name_alone_stays_llm():
    assert category_for_model(model_name="Llama-3.1-8B-Instruct") == "llm"


def test_training_template_has_no_inference_or_download_phases():
    result = _classify(_BOOT)
    assert result["category"] == "training"
    assert result["phases"] == TRAINING_PHASES
    assert "downloading_weights" not in result["phases"]
    labels = " ".join(result["phase_labels"].values()).lower()
    for inference_only in ("vllm", "kv cache", "inference graph", "api server", "download"):
        assert inference_only not in labels


def test_boot_lines_are_container_starting():
    result = _classify(_BOOT)
    assert result["phase"] == "container_starting"
    assert result["phase_label"] == "Starting container"


def test_worker_lines_are_starting_workers():
    result = _classify(_BOOT + _WORKERS)
    assert result["phase"] == "starting_workers"
    assert result["phase_label"] == "Starting fine-tuning workers"


def test_health_ok_is_ready_for_jobs():
    result = _classify(_BOOT + _WORKERS + _HEALTH_OK)
    assert result["phase"] == "ready"
    assert result["phase_label"] == "Ready for fine-tuning jobs"
    assert result["progress"] == 100


def test_legacy_startup_download_is_not_a_phase():
    result = _classify(_BOOT + _LEGACY_DOWNLOAD)
    assert result["phase"] == "container_starting"
    assert result["download_in_container"] is False
    assert result["weights_repo"] is None


def test_chat_type_keeps_llm_template():
    result = classify_startup_phase(_BOOT, now=0.0, model_type=ModelTypes.CHAT.value)
    assert result["category"] == "llm"
    assert result["phases"] == LLM_PHASES
