# Model & Hardware Support

This page lists the AI models TT-Studio can deploy and the Tenstorrent machines
each one runs on, with its current support level.

The matrix is derived from the inference-server catalog that ships with
TT-Studio — [`app/backend/shared_config/models_from_inference_server.json`](../app/backend/shared_config/models_from_inference_server.json)
(artifact version `0.14.0`) — so it reflects what this build actually deploys.
It can change when the bundled `TT_INFERENCE_ARTIFACT_VERSION` is bumped; treat
the catalog as the source of truth if anything here looks out of date.

## Status legend

| Symbol | Meaning |
|---|---|
| 🟢 **Complete** | Fully supported and tested |
| 🟡 **Functional** | Works, may have known limitations |
| 🛠️ **Experimental** | Early stage, may have issues |

In the matrices below, ✅ marks a machine the model can be deployed on (at the
model's overall status shown in the **Status** column); – means it is not
offered on that machine.

## At a glance

| Category | Models | 🟢 Complete | 🟡 Functional | 🛠️ Experimental |
|---|---|---|---|---|
| Large language models | 18 | 4 | 7 | 7 |
| Vision-language models | 12 | 0 | 5 | 7 |
| Image generation | 9 | 7 | 2 | 0 |
| Video generation | 1 | 1 | 0 | 0 |
| Speech recognition | 2 | 2 | 0 | 0 |
| Text-to-speech | 1 | 1 | 0 | 0 |
| Embeddings | 3 | 0 | 0 | 3 |
| Computer vision (CNN) | 7 | 3 | 2 | 2 |
| **Total** | **53** | **18** | **16** | **19** |

## Supported machines

TT-Studio detects the attached board with `tt-smi` and maps it to one of the
configurations below (see [`board_control/services.py`](../app/backend/board_control/services.py)
and [`shared_config/device_config.py`](../app/backend/shared_config/device_config.py)).
The column headers in the matrices use the friendly names in the first column.

| Machine | Detected as | Architecture | Chips | Class |
|---|---|---|---|---|
| n150 | `N150` | Wormhole | 1 | Single-chip |
| n300 | `N300` | Wormhole | 1 | Single-chip |
| WH 4×N150 | `N150X4` | Wormhole | 4 | Multi-chip |
| TT-LoudBox / TT-QuietBox | `T3K` | Wormhole | 4 | Multi-chip |
| WH Galaxy | `GALAXY` | Wormhole (Galaxy) | 32 | Multi-chip |
| WH Galaxy (T3K) | `GALAXY_T3K` | Wormhole (Galaxy) | 32 | Multi-chip |
| p100 | `P100` | Blackhole | 1 | Single-chip |
| p150 | `P150` | Blackhole | 1 | Single-chip |
| p300 | `P300` | Blackhole | 2 (1 card) | Single card |
| BH 4×P150 | `P150X4` | Blackhole | 4 | Multi-chip |
| BH 8×P150 | `P150X8` | Blackhole | 8 | Multi-chip |
| BH 2×P300 | `P300x2` | Blackhole | 4 (2 cards) | Multi-chip |

> The `E150` (Wormhole) board is also recognized but no catalog model currently
> targets it. Speech models (Whisper, SpeechT5) run on a single chip even on
> multi-chip boards.

## Model support matrix

Each table shows only the machines that the models in that category support.

### Large language models (LLM)

| Model | Hugging Face | Status | n150 | n300 | WH 4×N150 | TT-LoudBox / TT-QuietBox | WH Galaxy | WH Galaxy (T3K) | p100 | p150 | p300 | BH 4×P150 | BH 8×P150 | BH 2×P300 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Llama-3.1-8B-Instruct | `meta-llama/Llama-3.1-8B-Instruct` | 🟢 Complete | ✅ | ✅ | – | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Llama-3.3-70B-Instruct | `meta-llama/Llama-3.3-70B-Instruct` | 🟢 Complete | – | – | – | ✅ | ✅ | ✅ | – | – | – | ✅ | ✅ | ✅ |
| Mistral-7B-Instruct-v0.3 | `mistralai/Mistral-7B-Instruct-v0.3` | 🟢 Complete | ✅ | ✅ | – | ✅ | – | – | – | – | – | – | – | – |
| Qwen3-32B | `Qwen/Qwen3-32B` | 🟢 Complete | – | – | – | ✅ | ✅ | ✅ | – | – | – | – | ✅ | ✅ |
| Llama-3.2-1B | `meta-llama/Llama-3.2-1B` | 🟡 Functional | ✅ | ✅ | – | ✅ | – | – | – | – | – | – | – | – |
| Llama-3.2-1B-Instruct | `meta-llama/Llama-3.2-1B-Instruct` | 🟡 Functional | ✅ | ✅ | – | ✅ | – | – | – | – | – | – | – | – |
| Llama-3.2-3B | `meta-llama/Llama-3.2-3B` | 🟡 Functional | ✅ | ✅ | – | ✅ | – | – | – | – | – | – | – | – |
| Llama-3.2-3B-Instruct | `meta-llama/Llama-3.2-3B-Instruct` | 🟡 Functional | ✅ | ✅ | – | ✅ | – | – | – | – | – | – | – | – |
| QwQ-32B | `Qwen/QwQ-32B` | 🟡 Functional | – | – | – | ✅ | ✅ | ✅ | – | – | – | – | – | – |
| Qwen2.5-72B | `Qwen/Qwen2.5-72B` | 🟡 Functional | – | – | – | ✅ | ✅ | ✅ | – | – | – | – | – | – |
| Qwen2.5-72B-Instruct | `Qwen/Qwen2.5-72B-Instruct` | 🟡 Functional | – | – | – | ✅ | ✅ | ✅ | – | – | – | – | – | – |
| AFM-4.5B | `arcee-ai/AFM-4.5B` | 🛠️ Experimental | – | ✅ | – | ✅ | – | – | – | – | – | – | – | – |
| Qwen2.5-7B | `Qwen/Qwen2.5-7B` | 🛠️ Experimental | – | ✅ | ✅ | – | – | – | – | – | – | – | – | – |
| Qwen2.5-7B-Instruct | `Qwen/Qwen2.5-7B-Instruct` | 🛠️ Experimental | – | ✅ | ✅ | – | – | – | – | – | – | – | – | – |
| Qwen2.5-Coder-32B-Instruct | `Qwen/Qwen2.5-Coder-32B-Instruct` | 🛠️ Experimental | – | – | – | ✅ | – | ✅ | – | – | – | – | – | – |
| gemma-3-1b-it | `google/gemma-3-1b-it` | 🛠️ Experimental | ✅ | – | – | – | – | – | – | – | – | – | – | – |
| gpt-oss-120b | `openai/gpt-oss-120b` | 🛠️ Experimental | – | – | – | ✅ | ✅ | – | – | – | – | – | – | – |
| gpt-oss-20b | `openai/gpt-oss-20b` | 🛠️ Experimental | – | – | – | ✅ | ✅ | ✅ | – | – | – | – | – | – |

### Vision-language models (VLM)

| Model | Hugging Face | Status | n150 | n300 | TT-LoudBox / TT-QuietBox | WH Galaxy | WH Galaxy (T3K) |
|---|---|---|---|---|---|---|---|
| Llama-3.2-11B-Vision | `meta-llama/Llama-3.2-11B-Vision` | 🟡 Functional | – | ✅ | ✅ | – | – |
| Llama-3.2-11B-Vision-Instruct | `meta-llama/Llama-3.2-11B-Vision-Instruct` | 🟡 Functional | – | ✅ | ✅ | – | – |
| Llama-3.2-90B-Vision | `meta-llama/Llama-3.2-90B-Vision` | 🟡 Functional | – | – | ✅ | – | – |
| Llama-3.2-90B-Vision-Instruct | `meta-llama/Llama-3.2-90B-Vision-Instruct` | 🟡 Functional | – | – | ✅ | – | – |
| Qwen2.5-VL-72B-Instruct | `Qwen/Qwen2.5-VL-72B-Instruct` | 🟡 Functional | – | – | ✅ | – | – |
| Qwen2.5-VL-32B-Instruct | `Qwen/Qwen2.5-VL-32B-Instruct` | 🛠️ Experimental | – | – | ✅ | – | – |
| Qwen2.5-VL-3B-Instruct | `Qwen/Qwen2.5-VL-3B-Instruct` | 🛠️ Experimental | ✅ | ✅ | – | – | – |
| Qwen2.5-VL-7B-Instruct | `Qwen/Qwen2.5-VL-7B-Instruct` | 🛠️ Experimental | – | ✅ | – | – | – |
| gemma-3-27b-it | `google/gemma-3-27b-it` | 🛠️ Experimental | – | – | ✅ | ✅ | ✅ |
| gemma-3-4b-it | `google/gemma-3-4b-it` | 🛠️ Experimental | ✅ | ✅ | – | – | – |
| medgemma-27b-it | `google/medgemma-27b-it` | 🛠️ Experimental | – | – | ✅ | ✅ | ✅ |
| medgemma-4b-it | `google/medgemma-4b-it` | 🛠️ Experimental | ✅ | ✅ | – | – | – |

### Image generation

| Model | Hugging Face | Status | n150 | n300 | TT-LoudBox / TT-QuietBox | WH Galaxy |
|---|---|---|---|---|---|---|
| FLUX.1-dev | `black-forest-labs/FLUX.1-dev` | 🟢 Complete | – | – | ✅ | ✅ |
| FLUX.1-schnell | `black-forest-labs/FLUX.1-schnell` | 🟢 Complete | – | – | ✅ | ✅ |
| Motif-Image-6B-Preview | `Motif-Technologies/Motif-Image-6B-Preview` | 🟢 Complete | – | – | ✅ | ✅ |
| stable-diffusion-3.5-large | `stabilityai/stable-diffusion-3.5-large` | 🟢 Complete | – | – | ✅ | ✅ |
| stable-diffusion-xl-1.0-inpainting-0.1 | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` | 🟢 Complete | ✅ | ✅ | ✅ | ✅ |
| stable-diffusion-xl-base-1.0 | `stabilityai/stable-diffusion-xl-base-1.0` | 🟢 Complete | ✅ | ✅ | ✅ | ✅ |
| stable-diffusion-xl-base-1.0-img-2-img | `stabilityai/stable-diffusion-xl-base-1.0-img-2-img` | 🟢 Complete | ✅ | ✅ | ✅ | ✅ |
| Qwen-Image | `Qwen/Qwen-Image` | 🟡 Functional | – | – | ✅ | ✅ |
| Qwen-Image-2512 | `Qwen/Qwen-Image-2512` | 🟡 Functional | – | – | ✅ | ✅ |

### Video generation

| Model | Hugging Face | Status | TT-LoudBox / TT-QuietBox | WH Galaxy |
|---|---|---|---|---|
| mochi-1-preview | `genmo/mochi-1-preview` | 🟢 Complete | ✅ | ✅ |

### Speech recognition

| Model | Hugging Face | Status | n150 | n300 | TT-LoudBox / TT-QuietBox | WH Galaxy | p150 | p300 | BH 2×P300 |
|---|---|---|---|---|---|---|---|---|---|
| distil-large-v3 | `distil-whisper/distil-large-v3` | 🟢 Complete | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| whisper-large-v3 | `openai/whisper-large-v3` | 🟢 Complete | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Text-to-speech (TTS)

| Model | Hugging Face | Status | n150 | n300 | p150 | p300 | BH 2×P300 |
|---|---|---|---|---|---|---|---|
| speecht5_tts | `microsoft/speecht5_tts` | 🟢 Complete | ✅ | ✅ | ✅ | ✅ | ✅ |

### Embeddings

| Model | Hugging Face | Status | n150 | n300 | TT-LoudBox / TT-QuietBox | WH Galaxy |
|---|---|---|---|---|---|---|
| Qwen3-Embedding-4B | `Qwen/Qwen3-Embedding-4B` | 🛠️ Experimental | ✅ | ✅ | ✅ | ✅ |
| Qwen3-Embedding-8B | `Qwen/Qwen3-Embedding-8B` | 🛠️ Experimental | ✅ | ✅ | ✅ | ✅ |
| bge-large-en-v1.5 | `BAAI/bge-large-en-v1.5` | 🛠️ Experimental | ✅ | ✅ | ✅ | ✅ |

### Computer vision (CNN)

| Model | Hugging Face | Status | n150 | n300 |
|---|---|---|---|---|
| mobilenetv2 | `mobilenetv2` | 🟢 Complete | ✅ | ✅ |
| vit | `vit` | 🟢 Complete | ✅ | ✅ |
| vovnet | `vovnet` | 🟢 Complete | ✅ | ✅ |
| resnet-50 | `resnet-50` | 🟡 Functional | ✅ | ✅ |
| segformer | `segformer` | 🟡 Functional | ✅ | ✅ |
| efficientnet | `efficientnet` | 🛠️ Experimental | ✅ | ✅ |
| unet | `unet` | 🛠️ Experimental | ✅ | ✅ |

## Legacy models

`YOLOv4` (object detection) and `Stable-Diffusion-1.4` (image generation) are
hardcoded legacy entries in [`shared_config/model_config.py`](../app/backend/shared_config/model_config.py)
that predate the catalog and are not part of the matrix above.
