# From: https://github.com/tenstorrent/tt-metal/pkgs/container/tt-metal%2Ftt-metalium%2Fubuntu-20.04-amd64
# Dockerfile: https://github.com/tenstorrent/tt-metal/blob/v0.50.0-rc2/dockerfile/ubuntu-20.04-amd64.Dockerfile
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium/ubuntu-20.04-amd64:latest as tt-metal-builder

# Build stage
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

## add user
ARG HOME_DIR=/home/user
ARG DEBIAN_FRONTEND=noninteractive

ENV TT_METAL_TAG=v0.50.0-rc3
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles
ENV TT_METAL_HOME=/tt-metal
ENV PATH=$PATH:/home/user/.local/bin
ENV ARCH_NAME=wormhole_b0
ENV CONFIG=Release
# derived variables
ENV PYTHONPATH=${TT_METAL_HOME}
ENV PYTHON_ENV_DIR=${TT_METAL_HOME}/python_env

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
    && mkdir -p /opt/tt_metal_infra/tt-metal/python_env \
    && cp -r ${TT_METAL_HOME}/tt_metal/python_env /opt/tt_metal_infra/tt-metal/python_env \
    && git submodule foreach 'git lfs fetch --all && git lfs pull' \
    && bash ./create_venv.sh \
    && cmake -B build -G Ninja && ninja -C build \
    && bash -c "source ${PYTHON_ENV_DIR}/bin/activate && ninja install -C build"

# user setup
RUN useradd -u 1000 -s /bin/bash -d ${HOME_DIR} user \
    && mkdir -p ${HOME_DIR} \
    && chown -R user:user ${HOME_DIR} \
    && chown -R user:user ${TT_METAL_HOME} \
    && chown -R user:user /opt

USER user

# install app requirements
WORKDIR "${HOME_DIR}/${APP_DIR}"
COPY --chown=user:user "src" "${HOME_DIR}/${APP_DIR}/src"
COPY --chown=user:user "requirements.txt" "${HOME_DIR}/${APP_DIR}/requirements.txt"
RUN /bin/bash -c "source ${PYTHON_ENV_DIR}/bin/activate \
&& pip install --default-timeout=240 --no-cache-dir -r requirements.txt"

RUN echo "source ${PYTHON_ENV_DIR}/bin/activate" >> ${HOME_DIR}/.bashrc

# run app via gunicorn
WORKDIR "${HOME_DIR}/${APP_DIR}/src"
ENV PYTHONPATH=${HOME_DIR}/${APP_DIR}/src:${TT_METAL_HOME}
CMD ["/bin/bash", "-c", "source ${PYTHON_ENV_DIR}/bin/activate && gunicorn --config gunicorn.conf.py"]

# default port is 7000
ENV SERVICE_PORT=7000
HEALTHCHECK --retries=5 --start-period=300s CMD curl -f http://localhost:${SERVICE_PORT}/health || exit 1
