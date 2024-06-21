# From: https://github.com/tenstorrent/tt-metal/pkgs/container/tt-metal%2Ftt-metalium%2Fubuntu-20.04-amd64
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium/ubuntu-20.04-amd64@sha256:64a92ae68ecf14d5c2d87ee21761bdf0ee20291c0a37ec88cacf6d78ab5bf39c

# Build stage
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

ARG DEBIAN_FRONTEND=noninteractive

ENV TT_METAL_COMMIT_SHA=fa443d21f81a60bf6518b09370188b45c804d4de
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles
ENV TT_METAL_HOME=/tt-metal
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
    libyaml-cpp-dev \
    # dev deps
    cmake=3.16.3-1ubuntu1.20.04.1 \
    pandoc \
    libtbb-dev \
    libcapstone-dev \
    pkg-config \
    ninja-build

# build tt-metal
RUN git clone https://github.com/tenstorrent-metal/tt-metal.git ${TT_METAL_HOME} \
    && cd ${TT_METAL_HOME} \
    && git checkout ${TT_METAL_COMMIT_SHA} \
    && git submodule update --init --recursive \
    && git submodule foreach 'git lfs fetch --all && git lfs pull' \
    && cmake -B build -G Ninja \
    && cmake --build build --target tests \
    && cmake --build build --target install \
    && bash ./create_venv.sh

# user setup
ARG HOME_DIR=/home/user
RUN useradd -u 1000 -s /bin/bash -d ${HOME_DIR} user \
    && mkdir -p ${HOME_DIR} \
    && chown -R user:user ${HOME_DIR} \
    && chown -R user:user ${TT_METAL_HOME}

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
