# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

# === GENERATED FILE -- DO NOT EDIT BY HAND ===
# Rebuild with:  python app/backend/vector_db_control/build_data.py
#
# Model-support knowledge for the RAG corpus. Imported by data.py into
# INTERNAL_KNOWLEDGE. Editing this by hand will be overwritten on the next run;
# change build_data.py instead.

# Generated: 2026-07-29T21:39:50+00:00
# tt-inference-server ref: v0.18.0

SUPPORTED_MODELS_BY_HARDWARE = """
# Supported Models by Tenstorrent Hardware

Which models the tt-inference-server can serve on each Tenstorrent platform.
Source: https://raw.githubusercontent.com/tenstorrent/tt-inference-server/v0.18.0/docs/model_support/models_by_hardware.md
tt-inference-server ref: v0.18.0

Status meanings: COMPLETE is validated end to end; FUNCTIONAL runs but is not fully validated for performance or accuracy; EXPERIMENTAL is under active development and may be unstable.

## BH QuietBox 2 (also called TT-QuietBox 2, QB2, the Blackhole QuietBox)

- Complete: FLUX.1-dev (Image), FLUX.1-schnell (Image), Motif-Image-6B-Preview (Image), Wan2.2-T2V-A14B-Diffusers (Video), mochi-1-preview (Video), whisper-large-v3 (Audio)
- Functional: Llama-3.1-8B (LLM), Llama-3.3-70B-Instruct (LLM), Qwen3-32B (LLM), Z-Image-Turbo (Image)
- Experimental: Qwen3.6-27B (LLM), gemma-4-31B-it (LLM), gpt-oss-120b (LLM), speecht5_tts (TTS)

## BH 4xP150

- Complete: FLUX.1-dev (Image), Llama-3.1-8B (LLM), Wan2.2-T2V-A14B-Diffusers (Video), mochi-1-preview (Video)
- Functional: Llama-3.3-70B-Instruct (LLM)

## BH LoudBox

- Complete: FLUX.1-dev (Image), Motif-Image-6B-Preview (Image), Wan2.2-T2V-A14B-Diffusers (Video), mochi-1-preview (Video)
- Functional: Llama-3.1-8B (LLM), Llama-3.3-70B-Instruct (LLM), Qwen3-32B (LLM)

## Dual WH Galaxy

- Experimental: DeepSeek-R1-0528 (LLM)

## n150

- Complete: Llama-3.1-8B (LLM), Mistral-7B-Instruct-v0.3 (LLM), mobilenetv2 (CNN), speecht5_tts (TTS), stable-diffusion-xl-1.0-inpainting-0.1 (Image), stable-diffusion-xl-base-1.0 (Image), vit (CNN), vovnet (CNN), whisper-large-v3 (Audio), yolox_nano (CNN)
- Functional: Llama-3.2-1B (LLM), Llama-3.2-3B (LLM), Qwen3-8B (LLM), resnet-50 (CNN), segformer (CNN)
- Experimental: Qwen2.5-VL-3B-Instruct (VLM), Qwen2.5-VL-7B-Instruct (VLM), Qwen3-4B (LLM), Qwen3-Embedding-4B (Embedding), Qwen3-Embedding-8B (Embedding), bge-large-en-v1.5 (Embedding), efficientnet (CNN), gemma-3-1b-it (LLM), gemma-3-4b-it (VLM), unet (CNN)

## n300

- Complete: Llama-3.1-8B (LLM), Mistral-7B-Instruct-v0.3 (LLM), mobilenetv2 (CNN), speecht5_tts (TTS), stable-diffusion-xl-1.0-inpainting-0.1 (Image), stable-diffusion-xl-base-1.0 (Image), vit (CNN), vovnet (CNN), whisper-large-v3 (Audio)
- Functional: Llama-3.2-11B-Vision (VLM), Llama-3.2-1B (LLM), Llama-3.2-3B (LLM), Qwen3-8B (LLM), resnet-50 (CNN), segformer (CNN)
- Experimental: AFM-4.5B (LLM), Qwen2.5-7B (LLM), Qwen2.5-VL-3B-Instruct (VLM), Qwen2.5-VL-7B-Instruct (VLM), Qwen3-4B (LLM), Qwen3-Embedding-4B (Embedding), Qwen3-Embedding-8B (Embedding), bge-large-en-v1.5 (Embedding), efficientnet (CNN), gemma-3-4b-it (VLM), unet (CNN)

## p100

- Experimental: Llama-3.1-8B (LLM)

## p150

- Complete: whisper-large-v3 (Audio), yolox_nano (CNN)
- Experimental: Falcon3-7B-Instruct (LLM), Llama-3.1-8B (LLM), speecht5_tts (TTS)

## Quad WH Galaxy

- Experimental: DeepSeek-R1-0528 (LLM)

## WH Galaxy

- Complete: FLUX.1-dev (Image), Llama-3.3-70B-Instruct (LLM), Motif-Image-6B-Preview (Image), Qwen3-32B (LLM), Wan2.2-T2V-A14B-Diffusers (Video), mochi-1-preview (Video), stable-diffusion-3.5-large (Image), stable-diffusion-xl-1.0-inpainting-0.1 (Image), stable-diffusion-xl-base-1.0 (Image), whisper-large-v3 (Audio)
- Functional: Llama-3.1-8B (LLM), QwQ-32B (LLM), Qwen-Image (Image), Qwen2.5-72B (LLM), Qwen3-8B (LLM)
- Experimental: DeepSeek-R1-0528 (LLM), Qwen3-Embedding-4B (Embedding), Qwen3-Embedding-8B (Embedding), bge-large-en-v1.5 (Embedding), gemma-3-27b-it (VLM), gpt-oss-120b (LLM), gpt-oss-20b (LLM)

## WH LoudBox/QuietBox

- Complete: FLUX.1-dev (Image), Llama-3.1-8B (LLM), Mistral-7B-Instruct-v0.3 (LLM), Motif-Image-6B-Preview (Image), Wan2.2-T2V-A14B-Diffusers (Video), mochi-1-preview (Video), stable-diffusion-3.5-large (Image), stable-diffusion-xl-1.0-inpainting-0.1 (Image), stable-diffusion-xl-base-1.0 (Image), whisper-large-v3 (Audio)
- Functional: Llama-3.2-11B-Vision (VLM), Llama-3.2-1B (LLM), Llama-3.2-3B (LLM), Llama-3.2-90B-Vision (VLM), Llama-3.3-70B-Instruct (LLM), QwQ-32B (LLM), Qwen-Image (Image), Qwen2.5-72B (LLM), Qwen2.5-VL-72B-Instruct (VLM), Qwen3-32B (LLM), Qwen3-8B (LLM), Qwen3-VL-32B-Instruct (VLM)
- Experimental: AFM-4.5B (LLM), Qwen2.5-Coder-32B-Instruct (LLM), Qwen2.5-VL-32B-Instruct (VLM), Qwen3-Embedding-4B (Embedding), Qwen3-Embedding-8B (Embedding), bge-large-en-v1.5 (Embedding), gemma-3-27b-it (VLM), gpt-oss-120b (LLM), gpt-oss-20b (LLM)
"""

DEPLOYABLE_MODEL_CATALOG = """
# Models TT-Studio Can Deploy

The models this TT-Studio installation can launch on Tenstorrent hardware, from the tt-inference-server catalog the deploy UI reads. Every model here is served through the tt-inference-server; LLMs and VLMs run on vLLM, media models on the media inference server.
tt-inference-server artifact version: 0.18.0
Total models in the catalog: 54

## Models supported on the TT-QuietBox 2 (QB2)

The TT-QuietBox 2 reports as board type P300x2 (2x p300 cards, 4 Blackhole ASICs, 480 Tensix cores, 128 GB GDDR6). It runs models built for the whole 4-chip mesh as well as single-chip models. 9 of the 54 catalog models can be deployed on it.

### Text and chat models (LLM) on the QB2
- Llama-3.1-8B-Instruct (Complete) -- Hugging Face id meta-llama/Llama-3.1-8B-Instruct
- Llama-3.3-70B-Instruct (Complete) -- Hugging Face id meta-llama/Llama-3.3-70B-Instruct
- Qwen3-32B (Complete) -- Hugging Face id Qwen/Qwen3-32B

### Image generation on the QB2
- FLUX.1-dev (Complete) -- Hugging Face id black-forest-labs/FLUX.1-dev
- FLUX.1-schnell (Complete) -- Hugging Face id black-forest-labs/FLUX.1-schnell

### Video generation on the QB2
- Wan2.2-T2V-A14B-Diffusers (Complete) -- Hugging Face id Wan-AI/Wan2.2-T2V-A14B-Diffusers

### Speech to text on the QB2
- distil-large-v3 (Complete) -- Hugging Face id distil-whisper/distil-large-v3
- whisper-large-v3 (Complete) -- Hugging Face id openai/whisper-large-v3

### Text to speech on the QB2
- speecht5_tts (Complete) -- Hugging Face id microsoft/speecht5_tts

## Full catalog, grouped by model type

### LLM
- AFM-4.5B (Experimental) runs on: n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- DeepSeek-R1-0528 (Experimental) runs on: WH Galaxy
- Llama-3.1-8B-Instruct (Complete) runs on: WH Galaxy, WH Galaxy (T3K mesh), n150 (single Wormhole card), n300 (dual-chip Wormhole card), p100 (Blackhole), p150 (single Blackhole card), 4x p150 (Blackhole), 8x p150 (Blackhole), p300 (dual-ASIC Blackhole card), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-1B (Functional) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-1B-Instruct (Functional) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-3B (Functional) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-3B-Instruct (Functional) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.3-70B-Instruct (Complete) runs on: WH Galaxy, WH Galaxy (T3K mesh), 4x p150 (Blackhole), 8x p150 (Blackhole), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Mistral-7B-Instruct-v0.3 (Complete) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- QwQ-32B (Functional) runs on: WH Galaxy, WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen2.5-72B (Functional) runs on: WH Galaxy, WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen2.5-72B-Instruct (Functional) runs on: WH Galaxy, WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen2.5-7B (Experimental) runs on: 4x n150, n300 (dual-chip Wormhole card)
- Qwen2.5-7B-Instruct (Experimental) runs on: 4x n150, n300 (dual-chip Wormhole card)
- Qwen2.5-Coder-32B-Instruct (Experimental) runs on: WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen3-32B (Complete) runs on: WH Galaxy, WH Galaxy (T3K mesh), 8x p150 (Blackhole), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen3-4B (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- gemma-3-1b-it (Experimental) runs on: n150 (single Wormhole card)
- gpt-oss-20b (Experimental) runs on: WH Galaxy, WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)

### VLM
- Llama-3.2-11B-Vision (Functional) runs on: n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-11B-Vision-Instruct (Functional) runs on: n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-90B-Vision (Functional) runs on: TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Llama-3.2-90B-Vision-Instruct (Functional) runs on: TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen2.5-VL-32B-Instruct (Experimental) runs on: TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen2.5-VL-3B-Instruct (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- Qwen2.5-VL-72B-Instruct (Functional) runs on: TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen2.5-VL-7B-Instruct (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- Qwen3-VL-32B-Instruct (Functional) runs on: TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- gemma-3-27b-it (Experimental) runs on: WH Galaxy, WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- gemma-3-4b-it (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- medgemma-27b-it (Experimental) runs on: WH Galaxy, WH Galaxy (T3K mesh), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- medgemma-4b-it (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)

### IMAGE
- FLUX.1-dev (Complete) runs on: WH Galaxy, 4x p150 (Blackhole), 8x p150 (Blackhole), p300 (dual-ASIC Blackhole card), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- FLUX.1-schnell (Complete) runs on: WH Galaxy, 4x p150 (Blackhole), 8x p150 (Blackhole), p300 (dual-ASIC Blackhole card), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen-Image (Functional) runs on: WH Galaxy, TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen-Image-2512 (Functional) runs on: WH Galaxy, TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- stable-diffusion-3.5-large (Complete) runs on: WH Galaxy, TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- stable-diffusion-xl-1.0-inpainting-0.1 (Complete) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- stable-diffusion-xl-base-1.0 (Complete) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- stable-diffusion-xl-base-1.0-img-2-img (Complete) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)

### VIDEO
- Wan2.2-T2V-A14B-Diffusers (Complete) runs on: WH Galaxy, 4x p150 (Blackhole), 8x p150 (Blackhole), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)

### AUDIO
- distil-large-v3 (Complete) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), p150 (single Blackhole card), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- whisper-large-v3 (Complete) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), p150 (single Blackhole card), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)

### TEXT_TO_SPEECH
- speecht5_tts (Complete) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card), p150 (single Blackhole card), TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs)

### EMBEDDING
- Qwen3-Embedding-4B (Experimental) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- Qwen3-Embedding-8B (Experimental) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)
- bge-large-en-v1.5 (Experimental) runs on: WH Galaxy, n150 (single Wormhole card), n300 (dual-chip Wormhole card), TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)

### CNN
- efficientnet (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- mobilenetv2 (Complete) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- resnet-50 (Functional) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- segformer (Functional) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- unet (Experimental) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- vit (Complete) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)
- vovnet (Complete) runs on: n150 (single Wormhole card), n300 (dual-chip Wormhole card)

## Notes

- A model listed here is deployable from the TT-Studio model catalog; it still has to be deployed before it can answer requests.
- Gated models such as the Llama family need a Hugging Face token (HF_TOKEN) with access granted on Hugging Face first.
- Status Complete means validated end to end, Functional means it runs but is not fully validated, Experimental means under active development.
"""


MODEL_SUPPORT_DOCS = [
    SUPPORTED_MODELS_BY_HARDWARE,
    DEPLOYABLE_MODEL_CATALOG,
]
