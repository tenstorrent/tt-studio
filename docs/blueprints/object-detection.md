# Object Detection Pipeline

Visual understanding with CNN models. Submit images for classification and detection using Forge-backed models — no GPU required. Upload images and get real-time detection results with bounding boxes and class labels.

## Use This Blueprint When

- You need image classification or object detection on Tenstorrent hardware without a GPU
- You want to evaluate CNN-based vision models (ResNet, EfficientNet, ViT) on Forge
- You need semantic segmentation alongside detection in the same pipeline

## Architecture

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  Image    │     │  Control  │     │  CNN      │
│  Upload   │────>│  Plane    │────>│  Model    │
│  (Web UI) │     │  Resize + │     │  (Forge)  │
│           │     │  Route    │     │  Tenstorrent│
└───────────┘     └───────────┘     └───────────┘
                        │                 │
                   Preprocessing     Detection
                   (320x320)         Results
                        └─────────────────┘
                         Bounding Boxes +
                         Class Labels
```

## How It Works

1. **Upload** — User uploads an image through the web interface
2. **Preprocess** — Image is resized (320x320) and formatted for the model
3. **Inference** — Image is sent to a deployed CNN model running on Forge
4. **Results** — Detection results (bounding boxes, class labels, confidence scores) are returned
5. **Visualize** — Results are overlaid on the original image in the UI

## Key Features

- Real-time image classification and object detection
- Multiple CNN architectures (ResNet, EfficientNet, ViT, VoVNet, MobileNetV2)
- Semantic segmentation (SegFormer, UNet)
- Image preprocessing and resizing handled by the control plane
- Cloud endpoint fallback for remote inference

## Models Used

| Model | Type | Inference Engine | Supported Devices |
|-------|------|-----------------|-------------------|
| resnet-50 | Classification | Forge | N150, N300 |
| efficientnet | Classification | Forge | N150, N300 |
| vit | Classification | Forge | N150, N300 |
| mobilenetv2 | Classification | Forge | N150, N300 |
| vovnet | Classification | Forge | N150, N300 |
| segformer | Segmentation | Forge | N150, N300 |
| unet | Segmentation | Forge | N150, N300 |

See the full [Model Catalog](../model-catalog.md) for all compatible models and hardware.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | All CNN models supported |
| N300 | All CNN models supported |

CNN models run on the Forge inference engine and are currently validated on Wormhole devices (N150, N300).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/object-detection/` | POST | Local inference — upload image, get detections |
| `/api/models/object-detection-cloud/` | POST | Remote endpoint — route to cloud API |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (model serving)
- TT-Forge (compiler-based inference)
- TT-Metal (execution framework)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy a CNN model (e.g., resnet-50) from the model catalog
3. Navigate to **Object Detection** in the web interface
4. Upload an image to see classification or detection results

See the [Quick Start Guide](../quickstart.md) for full provisioning details.

## Related Blueprints

- [Vision Language Model](vlm.md) — for open-ended visual Q&A rather than structured detection
