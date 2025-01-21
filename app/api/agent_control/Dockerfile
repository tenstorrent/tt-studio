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

COPY requirements_agent_env.txt . 
# install python dependencies 
RUN pip install --no-cache-dir -r requirements_agent_env.txt

# Set the working directory
WORKDIR /app

# Copy files (optional)
COPY . /app

# Command to run when the container starts
CMD ["/bin/bash"]
