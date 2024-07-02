# From: https://github.com/tenstorrent/tt-metal/blob/v0.48.0/dockerfile/ubuntu-20.04-amd64.Dockerfile
# TT-METAL UBUNTU 20.04 AMD64 DOCKERFILE
FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles

# tt-metal build variables
ARG TT_METAL_TAG=v0.48.0
ENV DOXYGEN_VERSION=1.9.6
ENV TT_METAL_HOME=/tt-metal

ENV ARCH_NAME=wormhole_b0
ENV CONFIG=Release
# derived variables
ENV PYTHONPATH=${TT_METAL_HOME}
ENV PYTHON_ENV_DIR=${TT_METAL_HOME}/python_env
ENV PATH=$PATH:/home/user/.local/bin:${PYTHON_ENV_DIR}/bin

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
RUN /bin/bash -c "${TT_METAL_HOME}/scripts/docker/install_test_deps.sh ${DOXYGEN_VERSION}"

# Install Clang-17: Recommended to use Clang-17 as that's what is officially supported and tested on CI.
RUN wget https://apt.llvm.org/llvm.sh \
    && chmod u+x llvm.sh \
    && ./llvm.sh 17

# Install compatible gdb debugger for clang-17
# RUN cd ${TT_METAL_HOME} \
#     && wget https://ftp.gnu.org/gnu/gdb/gdb-14.2.tar.gz \
#     && tar -xvf gdb-14.2.tar.gz \
#     && cd gdb-14.2 \
#     && ./configure \
#     && make -j$(nproc)

# ENV PATH="${TT_METAL_HOME}/gdb-14.2/gdb:$PATH"

# Can only be installed after Clang-17 installed
RUN apt-get -y update \
    && apt-get install -y --no-install-recommends \
    libc++-17-dev \
    libc++abi-17-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip config set global.extra-index-url https://download.pytorch.org/whl/cpu

## build tt-metal
RUN cd ${TT_METAL_HOME} \
    && git submodule foreach 'git lfs fetch --all && git lfs pull' \
    && bash ./create_venv.sh \
    && cmake -B build -G Ninja && ninja -C build \
    && bash -c "source python_env/bin/activate && ninja install -C build"

# user setup
ARG HOME_DIR=/home/user
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
