# From: https://github.com/tenstorrent/tt-metal/pkgs/container/tt-metal%2Ftt-metalium%2Fubuntu-20.04-amd64
# Dockerfile: https://github.com/tenstorrent/tt-metal/blob/v0.50.0-rc2/dockerfile/ubuntu-20.04-amd64.Dockerfile
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium/ubuntu-20.04-amd64:latest

# Build stage
LABEL maintainer="Tom Stesco <tstesco@tenstorrent.com>"

ARG DEBIAN_FRONTEND=noninteractive
ENV TT_METAL_TAG=v0.49.0
ENV SHELL=/bin/bash
ENV TZ=America/Los_Angeles

## add user
ARG HOME_DIR=/home/user
ARG APP_DIR=tt-metal-llama2-70b

RUN apt-get update && apt-get install -y patchelf

RUN useradd -u 1000 -s /bin/bash -d ${HOME_DIR} user \
    && mkdir -p ${HOME_DIR} \
    && chown -R user:user ${HOME_DIR}

USER user

# install app requirements
WORKDIR "${HOME_DIR}/${APP_DIR}"

# create app python venv
ENV PYTHON_ENV_NAME="python_env"
ENV PYTHON_ENV_DIR="${HOME_DIR}/${APP_DIR}/${PYTHON_ENV_NAME}"
RUN /bin/bash -c "wget https://github.com/tenstorrent/tt-metal/releases/download/v0.49.0/metal_libs-0.49.0+wormhole.b0-cp38-cp38-linux_x86_64.whl \
&& python3 -m venv ${PYTHON_ENV_NAME} \
&& source ${PYTHON_ENV_DIR}/bin/activate \
&& pip config set global.extra-index-url https://download.pytorch.org/whl/cpu \
&& pip install --upgrade pip setuptools wheel \
&& pip install metal_libs-0.49.0+wormhole.b0-cp38-cp38-linux_x86_64.whl --default-timeout=240 --no-cache-dir"

COPY --chown=user:user "src" "${HOME_DIR}/${APP_DIR}/src"
COPY --chown=user:user "requirements.txt" "${HOME_DIR}/${APP_DIR}/requirements.txt"
RUN /bin/bash -c "source ${PYTHON_ENV_DIR}/bin/activate \
&& pip install --default-timeout=240 --no-cache-dir -r requirements.txt"

RUN echo "source ${PYTHON_ENV_DIR}/bin/activate" >> ${HOME_DIR}/.bashrc

# run app via gunicorn
WORKDIR "${HOME_DIR}/${APP_DIR}/src"
ENV PYTHONPATH=${HOME_DIR}/${APP_DIR}/src
CMD ["/bin/bash", "-c", "source ${PYTHON_ENV_DIR}/bin/activate && gunicorn --config gunicorn.conf.py"]

# default port is 7000
ENV SERVICE_PORT=7000
HEALTHCHECK --retries=5 --start-period=300s CMD curl -f http://localhost:${SERVICE_PORT}/health || exit 1
