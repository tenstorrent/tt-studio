FROM python:3.12.1-slim-bullseye
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

RUN apt-get update && \
    apt-get install -y \
    procps \
    net-tools \
    iputils-ping \
    dnsutils \
    curl \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# Clone and install tt-smi
RUN git clone https://github.com/tenstorrent/tt-smi /tmp/tt-smi && \
    cd /tmp/tt-smi && \
    pip3 install .

WORKDIR /api
COPY ./requirements.txt /api
RUN pip3 install -r requirements.txt --no-cache-dir
COPY . /api