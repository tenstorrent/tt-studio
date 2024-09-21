# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# Build stage
FROM ubuntu:20.04 AS builder
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

ENV SHELL=/bin/bash

USER root
WORKDIR /tmp/install

ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Los_Angeles

RUN apt update && apt install -y \
    python3.8-venv \
    # build deps
    tzdata \
    python-is-python3 \
    pciutils \
    python3-pip \
    git \
    git-lfs \
    # user tools
    htop \
    nano \
    screen \
    tmux \
    vim \
    unzip \
    zip \
    curl \
    iputils-ping \
    rsync \
    wget \
    && rm -rf /var/lib/apt/lists/*

## add user
ARG HOME_DIR=/home/user
ARG APP_DIR=tt-test-model

RUN useradd -u 1000 -s /bin/bash -d ${HOME_DIR} user && \
    mkdir -p ${HOME_DIR} && \
    chown -R user:user ${HOME_DIR}

USER user
WORKDIR ${HOME_DIR}
RUN python -m venv python_env

# install app requirements
WORKDIR "${HOME_DIR}/${APP_DIR}"
COPY --chown=user:user "src" "${HOME_DIR}/${APP_DIR}/src"
COPY --chown=user:user "requirements.txt" "${HOME_DIR}/${APP_DIR}/requirements.txt"
RUN /bin/bash -c "source ${HOME_DIR}/python_env/bin/activate && pip install --default-timeout=240 --no-cache-dir -r requirements.txt" 

# run app via gunicorn
WORKDIR "${HOME_DIR}/${APP_DIR}/src"
CMD ["/bin/bash", "-c", "source /home/user/python_env/bin/activate && gunicorn --config gunicorn.conf.py"]

# default port is 7000
ENV SERVICE_PORT=7000
HEALTHCHECK --retries=5 --start-period=1s CMD curl -f http://localhost:${SERVICE_PORT}/health || exit 1
