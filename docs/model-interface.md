# Using TT-Studio as a Model Interface

TT-Studio provides a unified frontend interface for interacting with various AI models. This guide explains how to set up and use TT-Studio with different model types.

## Supported Models

### 1. Chat-based Language Models (LLMs)

- Interactive chat interface for text generation
- Support for various LLM models through vLLM integration
- Real-time conversation capabilities
- **Requirements**:
  - TT Inference Server must be enabled (do not use `--skip-fastapi`)
  - Valid Hugging Face token (`HF_TOKEN`) for model access

### 2. Computer Vision (YOLO)

- Object detection and recognition
- Real-time video processing capabilities
- Support for multiple object classes
- Bounding box visualization
- Confidence score display
- Supports both local and cloud-based YOLO models

### 3. Speech Recognition (Whisper)

- Audio transcription and processing
- Support for multiple languages
- Real-time speech-to-text capabilities
- Audio file upload support
- Microphone input support

### 4. Image Generation (Stable Diffusion)

- Text-to-image generation
- Image editing and manipulation
- Style transfer capabilities
- Advanced prompt engineering support
- Image variations and modifications

## Setup Instructions

### 1. Enable AI Playground Mode

Set the following in your `.env` file:

```env
VITE_ENABLE_DEPLOYED=true
```

### 2. Configure Model Endpoints

Add the following configurations to your `.env` file:

```env
# LLM Chat Configuration
CLOUD_CHAT_UI_URL=<your-llm-endpoint>
CLOUD_CHAT_UI_AUTH_TOKEN=<your-auth-token>

# Computer Vision Configuration
CLOUD_YOLOV4_API_URL=<your-yolo-endpoint>
CLOUD_YOLOV4_API_AUTH_TOKEN=<your-auth-token>

# Speech Recognition Configuration
CLOUD_SPEECH_RECOGNITION_URL=<your-whisper-endpoint>
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN=<your-auth-token>

# Image Generation Configuration
CLOUD_STABLE_DIFFUSION_URL=<your-sd-endpoint>
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN=<your-auth-token>

# Video Generation Configuration
CLOUD_VIDEO_GENERATION_URL=<your-video-gen-endpoint>
CLOUD_VIDEO_GENERATION_AUTH_TOKEN=<your-auth-token>
```

### 3. Additional Requirements

1. **For LLM Models**:

   - Ensure TT Inference Server is running (do not use `--skip-fastapi`)
   - Configure `HF_TOKEN` in your `.env` file
   - Sufficient system resources for model loading

2. **For Computer Vision**:

   - Webcam access (for real-time processing)
   - Sufficient storage for image uploads

3. **For Speech Recognition**:

   - Microphone access
   - Audio file support (.wav, .mp3)

4. **For Image Generation**:
   - Sufficient storage for generated images
   - GPU recommended for faster processing

## Usage Guide

### Accessing the Interface

1. Start TT-Studio:

   ```bash
   python run.py
   ```

2. Open your browser and navigate to:

   ```
   http://localhost:3000
   ```

3. Select your desired model interface from the navigation menu

### Model-Specific Features

#### LLM Chat

- Start conversations with natural language
- Configure model parameters (temperature, max tokens)
- View conversation history
- Export chat logs

#### YOLO Vision

- Upload images or use webcam
- Adjust detection confidence threshold
- Real-time object tracking
- Export detection results

#### Whisper Speech

- Record audio directly
- Upload audio files
- Select target language
- View transcription history
- Export transcriptions

#### Stable Diffusion

- Enter text prompts
- Adjust generation parameters
- Apply style modifications
- Save and download generated images

## Troubleshooting

### Common Issues

1. **Model Not Available**

   - Verify endpoint configurations
   - Check authentication tokens
   - Ensure services are running

2. **Performance Issues**

   - Check system resources
   - Verify network connectivity
   - Adjust model parameters

3. **Connection Errors**
   - Verify endpoint URLs
   - Check network firewall settings
   - Validate authentication tokens

### Getting Help

- Check the [FAQ](FAQ.md) for common questions
- Review the [Troubleshooting Guide](development.md#troubleshooting)
- Submit issues on GitHub for technical support
