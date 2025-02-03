# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

# install ubutntu base image 
FROM ubuntu:20.04
ENV TZ=America/Los_Angeles
ARG DEBIAN_FRONTEND=noninteractive

# Update the package repository and install some default tools
RUN apt-get update && apt-get install -y \
    vim \
    nano \
    software-properties-common  \ 
    git \
    htop \
    screen \
    tmux \
    unzip \
    zip \
    curl \
    wget 

# add deadsnakes for newer python versions
RUN add-apt-repository ppa:deadsnakes/ppa -y && apt-get update
# Install the specific version of Python 
RUN apt-get install -y python3.11 python3.11-venv python3.11-dev

# Set Python3.11 as the default Python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Ensure pip is installed and upgrade it
RUN python3 -m ensurepip --upgrade && \
    python3 -m pip install --upgrade pip setuptools wheel

# Verify the Python version
RUN python3 --version

# install python dependencies 
RUN pip install --no-cache-dir e2b==1.0.5 \
    e2b-code-interpreter==1.0.0 \
    langchain==0.3.11 \
    langchain-community==0.3.11 \
    langchain-core==0.3.24 \
    langchain-experimental==0.3.3 \
    langchain-text-splitters==0.3.2 \
    langgraph==0.2.56 \
    langgraph-checkpoint==2.0.8 \
    langgraph-sdk==0.1.43 \
    langsmith==0.1.147 \
    pydantic==2.10.3 \
    pydantic-settings==2.6.1 \
    pydantic_core==2.27.1 \
    regex==2024.11.6 \
    requests==2.32.3 \
    tavily-python==0.5.0 \
    typing-inspect==0.9.0 \
    typing_extensions==4.12.2 \
    uvicorn \
    fastapi \
    pyjwt
# Set the working directory
WORKDIR /app

# Copy files (optional)
COPY . /app

# Command to run when the container starts
CMD ["/bin/bash"]
