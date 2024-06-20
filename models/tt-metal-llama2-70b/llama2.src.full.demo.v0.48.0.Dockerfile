# From: https://github.com/tenstorrent/tt-metal/blob/v0.48.0/dockerfile/ubuntu-20.04-amd64.Dockerfile
# TT-METAL UBUNTU 20.04 AMD64 DOCKERFILE
FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TT_METAL_TAG=v0.48.0
ENV GTEST_VERSION=1.13.0
ENV DOXYGEN_VERSION=1.9.6

ENV TT_METAL_INFRA_DIR=/opt/tt_metal_infra

# git checkout instead of COPY
RUN apt-get update && apt-get install -y git
RUN git clone --branch ${TT_METAL_TAG} --single-branch https://github.com/tenstorrent-metal/tt-metal.git --recurse-submodules
RUN cd tt-metal && \
    mkdir -p ${TT_METAL_INFRA_DIR}/scripts/docker/ && \
    mkdir -p ${TT_METAL_INFRA_DIR}/tt-metal/docs/ && \
    mkdir -p ${TT_METAL_INFRA_DIR}/tt-metal/tt_metal/python_env/ && \
    mkdir -p /scripts && \
    cp -r scripts/docker/requirements.txt ${TT_METAL_INFRA_DIR}/scripts/docker/requirements.txt && \
    cp -r scripts/docker/requirements_dev.txt ${TT_METAL_INFRA_DIR}/scripts/docker/requirements_dev.txt && \
    cp -r scripts/docker/install_test_deps.sh ${TT_METAL_INFRA_DIR}/scripts/docker/install_test_deps.sh && \
    cp -r scripts ${TT_METAL_INFRA_DIR}/scripts && \
    cp build_metal.sh /scripts/build_metal.sh && \
    cp -r docs/requirements-docs.txt ${TT_METAL_INFRA_DIR}/tt-metal/docs/. && \
    cp -r tt_metal/python_env/* ${TT_METAL_INFRA_DIR}/tt-metal/tt_metal/python_env/.

# Install build and runtime deps
RUN apt-get -y update \
    && xargs -a ${TT_METAL_INFRA_DIR}/scripts/docker/requirements.txt apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install dev deps
RUN apt-get -y update \
    && xargs -a ${TT_METAL_INFRA_DIR}/scripts/docker/requirements_dev.txt apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

## Test Related Dependencies
RUN /bin/bash ${TT_METAL_INFRA_DIR}/scripts/docker/install_test_deps.sh ${GTEST_VERSION} ${DOXYGEN_VERSION}

# Build stage
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles

# Install Clang-17: Recommended to use Clang-17 as that's what is officially supported and tested on CI.
RUN wget https://apt.llvm.org/llvm.sh \
    && chmod u+x llvm.sh \
    && ./llvm.sh 17

ENV PATH=$PATH:${HOME_DIR}/.local/bin
ENV ARCH_NAME=wormhole_b0
ENV TT_METAL_HOME=${HOME_DIR}/tt-metal
ENV PYTHONPATH=${HOME_DIR}/tt-metal
ENV CONFIG=Release

RUN pip config set global.extra-index-url https://download.pytorch.org/whl/cpu

## build tt-metal
RUN cd tt-metal \
    && git submodule foreach 'git lfs fetch --all && git lfs pull' \
    && cmake -B build -G Ninja && ninja -C build \
    && bash ./create_venv.sh \
    && bash -c "source python_env/bin/activate && ninja install -C build"

## add user
ARG HOME_DIR=/home/user
ARG APP_DIR=tt-metal-llama2-70b

RUN useradd -u 1000 -s /bin/bash -d ${HOME_DIR} user \
    && mkdir -p ${HOME_DIR} \
    && chown -R user:user ${HOME_DIR} \
    && chown -R user:user /tt-metal

USER user

WORKDIR "${HOME_DIR}"
# requirements for llama2 / llama3 demo
RUN bash -c "source /tt-metal/python_env/bin/activate \
    && pip install fairscale \
    fire \
    sentencepiece \
    blobfile \
    torch==2.2.1.0+cpu \
    transformers==4.38.0 \
    tqdm==4.66.3 \
    tiktoken==0.3.3 \
    pytest==7.2.2"
RUN echo "source /tt-metal/python_env/bin/activate" >> ${HOME_DIR}/.bashrc

# for interactive usage, override to run workload directly
CMD sleep infinity