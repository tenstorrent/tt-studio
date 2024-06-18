ARG IMAGE_TAG=latest

FROM ghcr.io/tenstorrent/tt-metal/tt-metalium/ubuntu-20.04-amd64:${IMAGE_TAG}

ARG GITHUB_BRANCH=v0.50.0-rc3
ENV TT_METAL_HOME=/tt-metal
ENV PYTHON_ENV_DIR=${TT_METAL_HOME}/python_env
# TODO: remove this once system deps in Dockerfile are complete
# RUN apt-get update && apt-get install -y \
#     software-properties-common=0.99.9.12 \
#     build-essential=12.8ubuntu1.1 \
#     python3.8-venv=3.8.10-0ubuntu1~20.04.9 \
#     libhwloc-dev \
#     graphviz \
#     # extra required
#     patchelf \
#     libc++-17-dev \
#     libc++abi-17-dev \
#     # dev deps
#     cmake=3.16.3-1ubuntu1.20.04.1 \
#     pandoc \
#     libtbb-dev \
#     libcapstone-dev \
#     pkg-config \
#     ninja-build

ARG ARCH_NAME=wormhole_b0

ENV ARCH_NAME=${ARCH_NAME}
ENV GITHUB_BRANCH=${GITHUB_BRANCH}

# note: ./create_venv.sh uses PYTHON_ENV_DIR
RUN git clone https://github.com/tenstorrent/tt-metal.git --depth 1 -b ${GITHUB_BRANCH} --recurse-submodules ${TT_METAL_HOME}
RUN cd tt-metal \
    && bash ./create_venv.sh \
    && bash -c "source ${PYTHON_ENV_DIR}/bin/activate && pip install -e . && pip install -e ttnn"

# Build stage
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

ARG DEBIAN_FRONTEND=noninteractive
ENV TT_METAL_TAG=${GITHUB_BRANCH}
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles

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

# run app via gunicorn
WORKDIR "${HOME_DIR}/${APP_DIR}/src"
ENV PYTHONPATH=${HOME_DIR}/${APP_DIR}/src:${TT_METAL_HOME}
CMD ["/bin/bash", "-c", "source ${PYTHON_ENV_DIR}/bin/activate && gunicorn --config gunicorn.conf.py"]

# default port is 7000
ENV SERVICE_PORT=7000
HEALTHCHECK --retries=5 --start-period=300s CMD curl -f http://localhost:${SERVICE_PORT}/health || exit 1
