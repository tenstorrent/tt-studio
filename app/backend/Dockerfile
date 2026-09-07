# SPDX-License-Identifier: Apache-2.0
#


FROM python:3.12.8-slim-bookworm

# Accept build argument for AI Playground mode
ARG VITE_ENABLE_DEPLOYED=false
ENV VITE_ENABLE_DEPLOYED=${VITE_ENABLE_DEPLOYED}
ENV PYTHONUNBUFFERED=1
# /backend is bind-mounted from the host repo; don't litter it with bytecode
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Install only essential system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3-dev \
    build-essential \
    libsqlite3-dev \
    ca-certificates \
    curl \
    git \
    pkg-config \
    libssl-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install tt-smi conditionally for local mode only
RUN if [ "$VITE_ENABLE_DEPLOYED" != "true" ]; then \
    echo "🔧 Local mode - attempting TT-SMI installation" && \
    # Install Rust
    #? copied from https://github.com/tenstorrent/tt-smi?tab=readme-ov-file#using-rustup to avoid build issues
    (curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
    . "$HOME/.cargo/env" && \
    # Clone and install tt-smi
    mkdir -p /opt/tenstorrent-tools && \
    git clone --branch v4.1.2 --depth 1 https://github.com/tenstorrent/tt-smi.git /opt/tenstorrent-tools/tt-smi && \
    cd /opt/tenstorrent-tools/tt-smi && \
    pip3 install --upgrade pip && \
    pip3 install . && \
    echo "✅ TT-SMI installation successful") || \
    echo "⚠️  TT-SMI installation failed, continuing without it"; \
    else \
    echo "🌐 AI Playground mode - skipping TT-SMI installation"; \
    fi


# Set working directory and copy requirements first for better caching
WORKDIR /backend
COPY ./requirements.txt /backend/

# Install Python dependencies
RUN pip3 install --upgrade pip && \
    pip3 install -r requirements.txt --no-cache-dir

# openwakeword pins tflite-runtime as a hard Linux dep, which has no Python 3.12 wheel.
# We use inference_framework="onnx", so install without deps (onnxruntime is in requirements.txt).
RUN pip3 install --no-cache-dir --no-deps openwakeword==0.6.0

# Bake in the all-MiniLM-L6-v2 embedding model. ChromaDB otherwise fetches it
# (79 MB) into ~/.cache/chroma on first use, which no volume persists — so every
# container recreation would re-download it, and concurrent request threads would
# race to extract the same archive (ChromaDB's downloader takes no lock).
# Embedding rather than calling the private download helper also proves the
# onnxruntime and tokenizer path works at build time. The archive is removed
# afterwards; ChromaDB skips the download once the extracted files are present.
RUN python3 -c "from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2; \
v = ONNXMiniLM_L6_V2()(['bake']); \
assert len(v) == 1 and len(v[0]) == 384, f'unexpected embedding shape: {len(v[0])}'" && \
    rm -f /root/.cache/chroma/onnx_models/all-MiniLM-L6-v2/onnx.tar.gz

# Copy application code
COPY . /backend/