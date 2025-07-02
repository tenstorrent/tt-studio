# Frequently Asked Questions

This FAQ covers general questions about TT-Studio. For specific troubleshooting guidance, please refer to our [Troubleshooting Guide](troubleshooting.md).

## Table of Contents 
1. [General Questions](#general-questions)
2. [Installation Questions](#installation-questions)
3. [Usage Questions](#usage-questions)

## General Questions

### What is TT-Studio?
TT-Studio is a comprehensive environment for deploying and interacting with Tenstorrent models, providing a unified frontend interface for various AI models including chat-based Language Models, Computer Vision, Speech Recognition, and Image Generation.

### Do I need Tenstorrent hardware to use TT-Studio?
No, TT-Studio can run without Tenstorrent hardware. Without TT hardware, you can still use TT-Studio as a frontend interface by connecting to external model endpoints. When Tenstorrent hardware is present, the system automatically detects and utilizes it for better performance.

## Installation Questions

### What are the minimum system requirements?
- Python 3.8 or higher
- Docker
- Sufficient disk space for Docker images and model weights

### How do I update TT-Studio?
Pull the latest code from the repository and run the setup script again:
```bash
git pull
python run.py
```

## Usage Questions

### How can I use TT-Studio as an AI playground?
You can use TT-Studio as a comprehensive AI playground by setting `VITE_ENABLE_DEPLOYED=true` in your `.env` file and configuring the endpoints for various model types. This allows you to interact with external models through TT-Studio's unified interface for chat-based Language Models (LLMs), Computer Vision (YOLO), Speech Recognition (Whisper), and Image Generation (Stable Diffusion) without requiring local model deployment.

### Can I use TT-Studio for commercial purposes?

---

For specific issues you might encounter while using TT-Studio, please check our [Troubleshooting Guide](troubleshooting.md).
