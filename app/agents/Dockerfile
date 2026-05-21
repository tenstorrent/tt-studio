# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
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

# Copy files
COPY . /app

# Command to run when the container starts
CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080", "--reload"]
