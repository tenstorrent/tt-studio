#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

set -euo pipefail

# Run Stable Diffusion 3.5 Large fully offline after restore.
# - Waits for frontend readiness
# - Uses local HF cache (~/.cache/huggingface) via bind mount
# - Forces Hugging Face offline mode
# - Points both HF_MODEL_PATH and MODEL_WEIGHTS_PATH at the exact snapshot dir
# - Connects to tt_studio_network and exposes host port

# Configurable via env vars
MODEL_NAME=${MODEL_NAME:-stable-diffusion-3.5-large}
DEVICE_NAME=${DEVICE_NAME:-t3k}
HOST_PORT=${HOST_PORT:-7000}
IMAGE=${IMAGE:-ghcr.io/tenstorrent/tt-inference-server/tt-server-dev-ubuntu-22.04-amd64:v0.0.3-rc5}
FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000/}
HF_CACHE_HOST=${HF_CACHE_HOST:-$HOME/.cache/huggingface}
NETWORK_NAME=${NETWORK_NAME:-tt_studio_network}

echo "[1/5] Wait for frontend to be ready: ${FRONTEND_URL}"
for i in {1..90}; do
  if curl -fsS -o /dev/null -w '%{http_code}' "$FRONTEND_URL" | grep -q '^200$'; then
    echo "  = Frontend is ready"
    break
  fi
  sleep 1
  if [[ $i -eq 90 ]]; then
    echo "  ! Frontend not ready after 90s; proceeding anyway"
  fi
done

echo "[2/5] Resolve local snapshot for stabilityai/stable-diffusion-3.5-large"
SNAP_DIR=$(ls -dt "$HF_CACHE_HOST"/models--stabilityai--stable-diffusion-3.5-large/snapshots/* 2>/dev/null | head -n1 || true)
if [[ -z "$SNAP_DIR" || ! -d "$SNAP_DIR" ]]; then
  echo "ERROR: Snapshot not found under $HF_CACHE_HOST/models--stabilityai--stable-diffusion-3.5-large/snapshots" >&2
  echo "       Download while online, e.g.:" >&2
  echo "       python3 - <<'PY'" >&2
  echo "from huggingface_hub import snapshot_download" >&2
  echo "snapshot_download(repo_id=\"stabilityai/stable-diffusion-3.5-large\", cache_dir=\"$HF_CACHE_HOST\")" >&2
  echo "PY" >&2
  exit 1
fi
SNAP_BN=$(basename "$SNAP_DIR")
echo "  = Using snapshot: $SNAP_DIR"

echo "[3/5] Find a free host port starting at ${HOST_PORT}"
BASE=$HOST_PORT
FREE_PORT=""
for p in $(seq $BASE $((BASE+20))); do
  if ! ss -ltn | awk '{print $4}' | grep -q ":$p$"; then
    FREE_PORT=$p; break
  fi
done
if [[ -z "$FREE_PORT" ]]; then
  echo "ERROR: No free port found in range ${BASE}-${BASE+20}" >&2
  exit 1
fi
echo "  = Selected host port: $FREE_PORT"

echo "[4/5] Run Stable Diffusion container fully offline"

# Build docker args
DOCKER_ARGS=(
  --rm -it
  --user root
  --device /dev/tenstorrent
  -p ${FREE_PORT}:8000
  --network ${NETWORK_NAME}
  -e MODEL=${MODEL_NAME}
  -e DEVICE=${DEVICE_NAME}
  -e HF_HUB_OFFLINE=1
  -e TRANSFORMERS_OFFLINE=1
  -e HF_HOME=/root/.cache/huggingface
  -e TRANSFORMERS_CACHE=/root/.cache/huggingface
  -e HF_MODEL_PATH=/root/.cache/huggingface/models--stabilityai--stable-diffusion-3.5-large/snapshots/${SNAP_BN}
  -e MODEL_WEIGHTS_PATH=/root/.cache/huggingface/models--stabilityai--stable-diffusion-3.5-large/snapshots/${SNAP_BN}
  -v ${HF_CACHE_HOST}:/root/.cache/huggingface:ro
)

# Hugepages mount if present
if [[ -d /dev/hugepages-1G ]]; then
  DOCKER_ARGS+=( --mount type=bind,src=/dev/hugepages-1G,dst=/dev/hugepages-1G )
else
  echo "  = /dev/hugepages-1G not found; continuing without hugepages"
fi

CONTAINER_NAME="sd35_large_p${FREE_PORT}"
DOCKER_ARGS+=( --name ${CONTAINER_NAME} )

echo "  > docker run ${IMAGE}"
docker run "${DOCKER_ARGS[@]}" "${IMAGE}"

echo "[5/5] Done. Container name: ${CONTAINER_NAME}"
echo "Open: http://localhost:${FREE_PORT}"


