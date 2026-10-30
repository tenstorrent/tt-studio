# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore
EXPOSE 8080

# debug tools
RUN apt-get update && \
  apt-get install -y \
  procps \
  net-tools \
  iputils-ping \
  python3-dev \
  build-essential \
  curl && \
  rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# install python dependencies 
COPY ./requirements.txt /app
RUN pip install -r requirements.txt --no-cache-dir 

# Copy files. The container runs as a non-root uid, so make them readable even
# when the checkout was made under a restrictive umask (files at 0660).
COPY . /app
RUN chmod -R a+rX /app

# Command to run when the container starts
CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080", "--reload"]
