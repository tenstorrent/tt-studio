FROM python:3.12.8-slim-bookworm

# Accept build argument for AI Playground mode
ARG VITE_ENABLE_DEPLOYED=false
ENV VITE_ENABLE_DEPLOYED=${VITE_ENABLE_DEPLOYED}
ENV PYTHONUNBUFFERED=1

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
    echo "🔧 Local mode - installing Rust and TT-SMI"; \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
    . "$HOME/.cargo/env" && \
    pip3 install --upgrade pip && \
    git clone https://github.com/tenstorrent/tt-smi /tmp/tt-smi && \
    cd /tmp/tt-smi && \
    . "$HOME/.cargo/env" && \
    pip3 install . && \
    rm -rf /tmp/tt-smi; \
    else \
    echo "🌐 AI Playground mode - skipping TT-SMI installation"; \
    fi

# Set Rust environment variables (will be empty if not installed)
ENV PATH="/root/.cargo/bin:${PATH}" \
    CARGO_HOME="/root/.cargo"

# Set working directory and copy requirements first for better caching
WORKDIR /backend
COPY ./requirements.txt /backend/

# Install Python dependencies
RUN pip3 install --upgrade pip && \
    pip3 install -r requirements.txt --no-cache-dir

# Copy application code
COPY . /backend/