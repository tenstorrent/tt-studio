<p align="center">
  <img src="https://raw.githubusercontent.com/tenstorrent/tt-metal/main/docs/source/common/images/favicon.png" width="120" height="120" />
</p>

<h1 align="center">TT-Studio</h1>

> To use TT-Studio's deployment features, you need access to a Tenstorrent AI accelerator.<br>
> Alternatively, you can connect to [remote endpoints](docs/remote-endpoint-setup.md) running models on Tenstorrent cards without local hardware.

**TL;DR:** TT-Studio is an easy-to-use web interface for running AI models on Tenstorrent hardware. It handles all the technical setup automatically and gives you a simple GUI to deploy models, chat with models, and more.

---

TT-Studio combines [TT Inference Server's](https://github.com/tenstorrent/tt-inference-server) core packaging setup, containerization, and deployment automation with [TT-Metal's](https://github.com/tenstorrent-metal/tt-metal) model execution framework specifically optimized for Tenstorrent hardware and provides an intuitive GUI for model management and interaction.

## Prerequisites

Before you start, make sure you have:

> **⚠️ IMPORTANT**: Complete the base Tenstorrent software installation first:
>
> **[Follow the Tenstorrent Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html)**
>
> This guide covers hardware setup, driver installation, and system configuration. You must complete this before using TT-Studio.

**Also ensure you have:**

- **Python 3.8+** ([Download here](https://www.python.org/downloads/))
- **Docker** ([Installation guide](https://docs.docker.com/engine/install/))

## 📚 Choose Your Path

### 👤 I'm a Normal User

> **Want to start using AI models right away on your Tenstorrent hardware? This is for you!**

**Quick Setup:**

```bash
git clone https://github.com/tenstorrent/tt-studio.git && cd tt-studio && python3 run.py
```

**What happens step by step:**

1. **Downloads TT-Studio** - Gets the code from GitHub
2. **Enters the directory** - Changes to the tt-studio folder
3. **Runs the setup script** - Automatically configures everything
4. **Initializes submodules** - Downloads TT Inference Server and dependencies
5. **Prompts for configuration** - Asks for your Hugging Face token and generates security keys
6. **Builds containers** - Sets up Docker environments for frontend and backend
7. **Starts all services** - Launches the web interface and backend server

**After Setup:**

- Go to **[http://localhost:3000](http://localhost:3000)** to use TT-Studio
- The backend runs at [http://localhost:8001](http://localhost:8001)
- Individual AI models run on ports 7000+ (e.g., 7001, 7002, etc.)

**To Stop TT-Studio:**

```bash
python3 run.py --cleanup
```

**🎯 What Can You Do Next?**

Once TT-Studio is running:

1. **Deploy a Model** - Go to the Model Deployment page and deploy a model to start using AI features
2. **Use AI Features**:
   - **💬 Chat with AI models** - Upload documents and ask questions
   - **🖼️ Generate images** - Create art with Stable Diffusion
   - **🎤 Process speech** - Convert speech to text with Whisper
   - **👁️ Analyze images** - Detect objects with YOLO models
   - **📚 RAG (Retrieval-Augmented Generation)** - Query your documents with AI-powered search
   - **🤖 AI Agent** - Autonomous AI assistant for complex tasks

📖 **Learn More**: Check out our [Model Interface Guide](docs/model-interface.md) for detailed tutorials.

**🆘 Need Help?**

- **No Tenstorrent hardware?** → [Remote Endpoint Setup](docs/remote-endpoint-setup.md) - Connect to remote Tenstorrent cards
- **Issues during setup?** → [Troubleshooting Guide](docs/model-interface.md#troubleshooting)
- **Questions?** → [FAQ](docs/FAQ.md)
- **Remote server setup?** → See [Remote Access Guide](#remote-access) below
- **Technical support?** → [Submit issues on GitHub](https://github.com/tenstorrent/tt-studio/issues)

### 🛠️ I'm a Developer

> **Want to contribute to TT-Studio or modify it?**

**Development Mode Setup:**

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py --dev
```

**Development Features:**

- **Hot Reload**: Code changes automatically trigger rebuilds
- **Container Mounting**: Local files mounted for real-time development
- **Automatic Setup**: All submodules and dependencies handled automatically

**Get Started:**

- [Contributing Guide](CONTRIBUTING.md) - How to contribute code
- [Development Setup](docs/development.md) - Set up your dev environment
- [Frontend Development](app/frontend/README.md) - React frontend
- [Backend API](app/backend/README.md) - Django backend

**Resources:**

- [Development Tools](dev-tools/README.md)
- [Complete run.py Guide](docs/run-py-guide.md)
- [vLLM Models Guide](docs/HowToRun_vLLM_Models.md)

---

## Remote Access

Running TT-Studio on a remote server? Use SSH port forwarding to access it from your local browser:

```bash
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 -L 7000-7010:localhost:7000-7010 username@your-server
```

> **Note**: Port range 7000-7010 forwards the model inference ports where individual AI models run.

Then open [http://localhost:3000](http://localhost:3000) in your local browser.

---

## About TT-Studio

> **Hardware Requirements**: Tenstorrent AI accelerator hardware is automatically detected when available. You can also connect to remote endpoints if you don't have direct hardware access.

TT-Studio combines [TT Inference Server](https://github.com/tenstorrent/tt-inference-server) and [TT-Metal](https://github.com/tenstorrent-metal/tt-metal) to provide:

- **Modern Web Interface**: React-based UI for easy model interaction
- **Django Backend**: Robust backend service for model management and deployment
- **Vector Database**: ChromaDB for document storage and semantic search
- **Multiple AI Models**: Chat, vision, speech, and image generation
- **Model Isolation**: Each AI model runs on separate ports (7000+) for better resource management
- **Hardware Optimization**: Specifically optimized for Tenstorrent devices
- **Docker Containers**: Isolated environments for frontend, backend, and inference services

### Supported AI Models

- **Language Models (LLMs)**: Chat, Q&A, text completion
- **Computer Vision**: Object detection with YOLO
- **Speech Processing**: Speech-to-text with Whisper
- **Image Generation**: Create images with Stable Diffusion

---

## 🛠️ For Developers

Want to contribute or customize TT-Studio?

**Get Started:**

- [Contributing Guide](CONTRIBUTING.md) - How to contribute code
- [Development Setup](docs/development.md) - Set up your dev environment
- [Frontend Development](app/frontend/README.md) - React frontend
- [Backend API](app/backend/README.md) - Django backend

**Development Mode:**

```bash
python3 run.py --dev  # Enables hot reload for development
```

**Development Features:**

- **Hot Reload**: Code changes automatically trigger rebuilds
- **Container Mounting**: Local files mounted for real-time development
- **Automatic Setup**: All submodules and dependencies handled automatically

**Resources:**

- [Development Tools](dev-tools/README.md)
- [Complete run.py Guide](docs/run-py-guide.md)
- [vLLM Models Guide](docs/HowToRun_vLLM_Models.md)

---

## 📋 Additional Resources

### Documentation

- **[FAQ](docs/FAQ.md)** - Quick answers to common questions
- **[Troubleshooting Guide](docs/troubleshooting.md)** - Fix common setup issues
- **[Model Interface Guide](docs/model-interface.md)** - Detailed tutorials for using AI models
- **[Complete run.py Guide](docs/run-py-guide.md)** - Advanced usage and command-line options

### Community & Support

- **Having issues?** Check our [Troubleshooting Guide](docs/troubleshooting.md)
- **Want to contribute?** See our [Contributing Guide](CONTRIBUTING.md)
- **Need specific models?** Follow our [vLLM Models Guide](docs/HowToRun_vLLM_Models.md)

> ⚠️ **Note**: The `startup.sh` script is deprecated. Always use `python3 run.py` for setup and management.
