#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

set -euo pipefail

# This script restores artifacts captured by prefetch_online.sh and starts TT Studio offline.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT}/app"
OFFLINE_DIR="${ROOT}/offline_bundle"
HOST_PV="${ROOT}/tt_studio_persistent_volume"

if [[ ! -d "${OFFLINE_DIR}" ]]; then
  echo "Offline bundle not found at ${OFFLINE_DIR}. Run scripts/prefetch_online.sh first." >&2
  exit 1
fi

echo "[1/6] Loading Docker images from ${OFFLINE_DIR}/images.tar"
docker load -i "${OFFLINE_DIR}/images.tar"

echo "[2/6] Restoring HF cache to ~/.cache/huggingface (if archive available)"
mkdir -p "${HOME}/.cache"
if [[ -f "${OFFLINE_DIR}/hf-cache.tgz" ]]; then
  if tar -tzf "${OFFLINE_DIR}/hf-cache.tgz" >/dev/null 2>&1; then
    tar -C "${HOME}/.cache" -xzf "${OFFLINE_DIR}/hf-cache.tgz"
  else
    echo "  = Warning: hf-cache.tgz appears corrupted; skipping extract and using existing ~/.cache/huggingface if present"
  fi
else
  echo "  = hf-cache.tgz not found; using existing ~/.cache/huggingface if present"
fi

echo "[3/6] Restoring frontend node_modules"
tar -C "${APP_DIR}/frontend" -xzf "${OFFLINE_DIR}/frontend-node_modules.tgz"

if [[ -f "${OFFLINE_DIR}/tt-inference-server-venv.tgz" ]]; then
  echo "[4/6] Restoring inference server venv"
  tar -C "${ROOT}/tt-inference-server" -xzf "${OFFLINE_DIR}/tt-inference-server-venv.tgz"
fi

echo "[5/6] Configure persistent volume and map HF cache for containers (bind mount if possible)"
mkdir -p "${HOST_PV}/huggingface" "${HOST_PV}/model_envs"
if [[ -d "${HOME}/.cache/huggingface" ]]; then
  if [[ "$(uname -s)" == "Linux" ]]; then
    if ! mountpoint -q "${HOST_PV}/huggingface"; then
      if command -v sudo >/dev/null 2>&1; then
        echo "  > bind-mounting ${HOME}/.cache/huggingface -> ${HOST_PV}/huggingface"
        if ! sudo mount --bind "${HOME}/.cache/huggingface" "${HOST_PV}/huggingface"; then
          echo "  = bind mount failed; falling back to rsync"
          rsync -a --delete "${HOME}/.cache/huggingface/" "${HOST_PV}/huggingface/" || true
        fi
      else
        echo "  = sudo not available; using rsync"
        rsync -a --delete "${HOME}/.cache/huggingface/" "${HOST_PV}/huggingface/" || true
      fi
    else
      echo "  = bind mount already active"
    fi
  else
    echo "  = non-Linux OS; using rsync"
    rsync -a --delete "${HOME}/.cache/huggingface/" "${HOST_PV}/huggingface/" || true
  fi
else
  echo "  = host HF cache not found; skipping mirror"
fi

# Ensure .env has HF_HOME pointing to PV mount inside containers
APP_ENV="${APP_DIR}/.env"
touch "${APP_ENV}"
if ! grep -q '^HOST_HF_HOME=' "${APP_ENV}"; then
  printf "\nHOST_HF_HOME=/tt_studio_persistent_volume/huggingface\n" >> "${APP_ENV}"
fi
if ! grep -q '^HF_HOME=' "${APP_ENV}"; then
  printf "HF_HOME=/tt_studio_persistent_volume/huggingface\n" >> "${APP_ENV}"
fi
# Force offline mode for HF/Transformers runtime
grep -q '^TRANSFORMERS_OFFLINE=' "${APP_ENV}" || printf "TRANSFORMERS_OFFLINE=1\n" >> "${APP_ENV}"
grep -q '^HF_HUB_OFFLINE=' "${APP_ENV}" || printf "HF_HUB_OFFLINE=1\n" >> "${APP_ENV}"
# Optionally disable embeddings entirely if user requests
if [[ -n "${CHROMA_EMBED_DISABLED:-}" || -n "${TT_STUDIO_DISABLE_EMBED:-}" ]]; then
  grep -q '^CHROMA_EMBED_DISABLED=' "${APP_ENV}" || printf "CHROMA_EMBED_DISABLED=1\n" >> "${APP_ENV}"
  echo "  = embeddings disabled via CHROMA_EMBED_DISABLED=1"
fi

echo "[6/6] Starting Docker services without rebuild (offline)"
docker network create tt_studio_network >/dev/null 2>&1 || true
echo "Preparing docker compose files"
COMPOSE_ARGS=(
  -f "${APP_DIR}/docker-compose.yml"
  -f "${APP_DIR}/docker-compose.dev-mode.yml"
  -f "${APP_DIR}/docker-compose.embeds-off.override.yml"
)

HW_OVERRIDE="${APP_DIR}/docker-compose.hw.override.yml"
if [[ -e "/dev/tenstorrent" ]]; then
  if [[ ! -f "${HW_OVERRIDE}" ]]; then
    cat > "${HW_OVERRIDE}" <<'YAML'
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
services:
  tt_studio_backend:
    devices:
      - /dev/tenstorrent:/dev/tenstorrent
YAML
  fi
  echo "  > Detected /dev/tenstorrent, applying hardware override"
  COMPOSE_ARGS+=( -f "${HW_OVERRIDE}" )
else
  echo "  = /dev/tenstorrent not found; starting without hardware mapping"
fi

docker compose "${COMPOSE_ARGS[@]}" up --no-build -d

echo
echo "Services started. Verify:" 
echo "  docker compose -f ${APP_DIR}/docker-compose.yml -f ${APP_DIR}/docker-compose.dev-mode.yml ps"
echo "  curl -I http://localhost:3000/"


