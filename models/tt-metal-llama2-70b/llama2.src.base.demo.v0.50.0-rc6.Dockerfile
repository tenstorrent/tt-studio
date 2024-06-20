# From: https://github.com/tenstorrent/tt-metal/pkgs/container/tt-metal%2Ftt-metalium%2Fubuntu-20.04-amd64
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium/ubuntu-20.04-amd64@sha256:64a92ae68ecf14d5c2d87ee21761bdf0ee20291c0a37ec88cacf6d78ab5bf39c

# Build stage
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

ARG DEBIAN_FRONTEND=noninteractive

ENV TT_METAL_TAG=v0.50.0-rc6
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles
ENV TT_METAL_HOME=/tt-metal
ENV PATH=$PATH:/home/user/.local/bin
ENV ARCH_NAME=wormhole_b0
ENV CONFIG=Release
ENV TT_METAL_ENV=dev
ENV LOGURU_LEVEL=INFO
# derived variables
ENV PYTHONPATH=${TT_METAL_HOME}
# note: PYTHON_ENV_DIR is used by create_venv.sh
ENV PYTHON_ENV_DIR=${TT_METAL_HOME}/python_env
ENV LD_LIBRARY_PATH=${TT_METAL_HOME}/build/lib

# TODO: remove this once system deps in Dockerfile are complete
RUN apt-get update && apt-get install -y \
    software-properties-common=0.99.9.12 \
    build-essential=12.8ubuntu1.1 \
    python3.8-venv=3.8.10-0ubuntu1~20.04.9 \
    libhwloc-dev \
    graphviz \
    # extra required
    patchelf \
    libc++-17-dev \
    libc++abi-17-dev \
    # dev deps
    cmake=3.16.3-1ubuntu1.20.04.1 \
    pandoc \
    libtbb-dev \
    libcapstone-dev \
    pkg-config \
    ninja-build

# build tt-metal
RUN git clone --branch ${TT_METAL_TAG} --single-branch https://github.com/tenstorrent-metal/tt-metal.git --recurse-submodules ${TT_METAL_HOME} \
    && cd ${TT_METAL_HOME} \
    && git submodule foreach 'git lfs fetch --all && git lfs pull' \
    && cmake -B build -G Ninja \
    && cmake --build build --target tests \
    && cmake --build build --target install \
    && bash ./create_venv.sh

ARG HOME_DIR=/home/root/
WORKDIR "${HOME_DIR}"
# requirements for llama2 / llama3 demo
RUN bash -c "source ${PYTHON_ENV_DIR}/bin/activate \
    && pip install fairscale \
    fire \
    sentencepiece \
    blobfile \
    torch==2.2.1.0+cpu \
    transformers==4.38.0 \
    tqdm==4.66.3 \
    tiktoken==0.3.3 \
    pytest==7.2.2"
RUN echo "source ${PYTHON_ENV_DIR}/bin/activate" >> ${HOME_DIR}/.bashrc


# for interactive usage, override to run workload directly
CMD sleep infinity