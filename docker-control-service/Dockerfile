# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

FROM python:3.12.8-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements-api.txt /app/requirements-api.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements-api.txt

COPY . /app

# Documentation only: Compose intentionally does not publish this port to the
# host.  Backend traffic reaches it through the tt_studio_network bridge.
EXPOSE 8002

CMD ["python", "entrypoint.py", "--host", "0.0.0.0", "--port", "8002"]
