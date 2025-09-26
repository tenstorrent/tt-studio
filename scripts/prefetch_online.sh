#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

set -euo pipefail

# This script prefetches all artifacts needed to run `python3 run.py --dev` offline.
# It builds images, downloads HF models, collects Python wheels, archives node_modules and venvs,
# and saves Docker images to a single tarball.

# Resolve repo root relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT}/app"
OFFLINE_DIR="${ROOT}/offline_bundle"

mkdir -p "${OFFLINE_DIR}" "${OFFLINE_DIR}/wheels/inference" "${OFFLINE_DIR}/wheels/backend"

# Allow override via env; space-separated list of HF repos to cache
HF_MODELS=${HF_MODELS:-"sentence-transformers/all-MiniLM-L6-v2"}

echo "[1/7] Building Docker images (frontend/backend/agent)"
docker compose -f "${APP_DIR}/docker-compose.yml" -f "${APP_DIR}/docker-compose.dev-mode.yml" build

echo "[2/7] Resolving image list from compose config"
mapfile -t IMAGE_LIST < <(docker compose -f "${APP_DIR}/docker-compose.yml" -f "${APP_DIR}/docker-compose.dev-mode.yml" config --images)
if [[ ${#IMAGE_LIST[@]} -eq 0 ]]; then
  echo "No images resolved from compose config. Aborting." >&2
  exit 1
fi
echo "Images: ${IMAGE_LIST[*]}"

echo "[3/7] Saving images to ${OFFLINE_DIR}/images.tar (this may take a while)"
docker save -o "${OFFLINE_DIR}/images.tar" "${IMAGE_LIST[@]}"

echo "[4/7] Archiving existing Hugging Face cache to ${OFFLINE_DIR}/hf-cache.tgz"
tar -C "${HOME}/.cache" -czf "${OFFLINE_DIR}/hf-cache.tgz" huggingface

echo "[5/7] Downloading Python wheels for offline pip installs"
# Inference server wheels
python3 -m pip download -r "${ROOT}/tt-inference-server/requirements-api.txt" -d "${OFFLINE_DIR}/wheels/inference"
# Backend wheels
python3 -m pip download -r "${APP_DIR}/backend/requirements.txt" -d "${OFFLINE_DIR}/wheels/backend"

echo "[6/7] Preparing frontend node_modules and optional inference venv"
pushd "${APP_DIR}/frontend" >/dev/null
npm ci
tar -czf "${OFFLINE_DIR}/frontend-node_modules.tgz" node_modules
popd >/dev/null

if [[ -d "${ROOT}/tt-inference-server/.venv" ]]; then
  tar -C "${ROOT}/tt-inference-server" -czf "${OFFLINE_DIR}/tt-inference-server-venv.tgz" .venv
fi

echo
echo "Prefetch complete. Offline bundle contents:"
ls -lh "${OFFLINE_DIR}"
echo
echo "Next, use scripts/restore_offline.sh on an offline machine to restore and start services."


