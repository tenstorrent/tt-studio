# From: https://github.com/tenstorrent/tt-metal/blob/v0.48.0/dockerfile/ubuntu-20.04-amd64.Dockerfile
# TT-METAL UBUNTU 20.04 AMD64 DOCKERFILE
FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles

# tt-metal build variables
ARG TT_METAL_TAG=v0.48.0
ENV GTEST_VERSION=1.13.0
ENV DOXYGEN_VERSION=1.9.6
ENV TT_METAL_HOME=/tt-metal
ENV PATH=$PATH:/home/user/.local/bin
ENV ARCH_NAME=wormhole_b0
ENV CONFIG=Release
# derived variables
ENV PYTHONPATH=${TT_METAL_HOME}

# checkout tt-metal repo
RUN apt-get update && apt-get install -y git
RUN git clone --branch ${TT_METAL_TAG} --single-branch https://github.com/tenstorrent-metal/tt-metal.git --recurse-submodules

# Install build and runtime deps
RUN apt-get -y update \
    && xargs -a ${TT_METAL_HOME}/scripts/docker/requirements.txt apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install dev deps
RUN apt-get -y update \
    && xargs -a ${TT_METAL_HOME}/scripts/docker/requirements_dev.txt apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

## Test Related Dependencies
RUN /bin/bash -c "${TT_METAL_HOME}/scripts/docker/install_test_deps.sh ${GTEST_VERSION} ${DOXYGEN_VERSION}"

# Install Clang-17: Recommended to use Clang-17 as that's what is officially supported and tested on CI.
RUN wget https://apt.llvm.org/llvm.sh \
    && chmod u+x llvm.sh \
    && ./llvm.sh 17

RUN pip config set global.extra-index-url https://download.pytorch.org/whl/cpu

## build tt-metal
RUN cd ${TT_METAL_HOME} \
    && git submodule foreach 'git lfs fetch --all && git lfs pull' \
    && bash ./create_venv.sh \
    && cmake -B build -G Ninja && ninja -C build \
    && bash -c "source python_env/bin/activate && ninja install -C build"

# for interactive useage use: docker exec -it <container id> bash
CMD sleep infinity
