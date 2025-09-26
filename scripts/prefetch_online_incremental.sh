#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

set -euo pipefail

# Incremental prefetch: only (re)does a step if inputs or outputs changed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT}/app"
OFFLINE_DIR="${ROOT}/offline_bundle"

mkdir -p "${OFFLINE_DIR}" "${OFFLINE_DIR}/wheels/inference" "${OFFLINE_DIR}/wheels/backend"

# Allow overriding models to cache (space-separated)
HF_MODELS=${HF_MODELS:-"sentence-transformers/all-MiniLM-L6-v2"}

hash_file() {
  # Fast-enough content hash for a path (files or dir)
  local p="$1"
  if [[ -d "$p" ]]; then
    # file list with sizes and mtimes → sha256
    find "$p" -type f -printf '%P %s %T@\n' | LC_ALL=C sort | sha256sum | awk '{print $1}'
  elif [[ -f "$p" ]]; then
    sha256sum "$p" | awk '{print $1}'
  else
    echo "missing"
  fi
}

echo "[1/7] Compose build (always)"
docker compose -f "${APP_DIR}/docker-compose.yml" -f "${APP_DIR}/docker-compose.dev-mode.yml" build

echo "[2/7] Images manifest & save (only if changed)"
mapfile -t IMAGE_LIST < <(docker compose -f "${APP_DIR}/docker-compose.yml" -f "${APP_DIR}/docker-compose.dev-mode.yml" config --images)
MANIFEST_TMP="${OFFLINE_DIR}/images.manifest.tmp"
MANIFEST="${OFFLINE_DIR}/images.manifest"
> "$MANIFEST_TMP"
for img in "${IMAGE_LIST[@]}"; do
  id=$(docker image inspect --format '{{.Id}}' "$img") || id=""
  echo "$img|$id" >> "$MANIFEST_TMP"
done

if [[ -f "$MANIFEST" ]] && cmp -s "$MANIFEST_TMP" "$MANIFEST" && [[ -f "${OFFLINE_DIR}/images.tar" ]]; then
  echo "  = images unchanged; skipping docker save"
  rm -f "$MANIFEST_TMP"
else
  echo "  > images changed; saving to images.tar"
  docker save -o "${OFFLINE_DIR}/images.tar" "${IMAGE_LIST[@]}"
  mv "$MANIFEST_TMP" "$MANIFEST"
fi

echo "[3/6] Skipping HF cache archive; will mirror ~/.cache/huggingface at restore time"

echo "[4/6] Wheels (only if requirements changed)"
INF_REQ="${ROOT}/tt-inference-server/requirements-api.txt"
BE_REQ="${APP_DIR}/backend/requirements.txt"
INF_REQ_HASH_FILE="${OFFLINE_DIR}/wheels/inference/requirements.sha256"
BE_REQ_HASH_FILE="${OFFLINE_DIR}/wheels/backend/requirements.sha256"

INF_REQ_HASH=$(hash_file "$INF_REQ")
BE_REQ_HASH=$(hash_file "$BE_REQ")
INF_REQ_HASH_OLD=""; [[ -f "$INF_REQ_HASH_FILE" ]] && INF_REQ_HASH_OLD=$(cat "$INF_REQ_HASH_FILE") || true
BE_REQ_HASH_OLD=""; [[ -f "$BE_REQ_HASH_FILE" ]] && BE_REQ_HASH_OLD=$(cat "$BE_REQ_HASH_FILE") || true

if [[ "$INF_REQ_HASH" != "$INF_REQ_HASH_OLD" ]] || [[ -z "$(ls -A "${OFFLINE_DIR}/wheels/inference" 2>/dev/null)" ]]; then
  echo "  > downloading inference wheels"
  rm -f "${OFFLINE_DIR}/wheels/inference"/* || true
  python3 -m pip download -r "$INF_REQ" -d "${OFFLINE_DIR}/wheels/inference"
  echo "$INF_REQ_HASH" > "$INF_REQ_HASH_FILE"
else
  echo "  = inference wheels up-to-date"
fi

if [[ "$BE_REQ_HASH" != "$BE_REQ_HASH_OLD" ]] || [[ -z "$(ls -A "${OFFLINE_DIR}/wheels/backend" 2>/dev/null)" ]]; then
  echo "  > downloading backend wheels"
  rm -f "${OFFLINE_DIR}/wheels/backend"/* || true
  python3 -m pip download -r "$BE_REQ" -d "${OFFLINE_DIR}/wheels/backend"
  echo "$BE_REQ_HASH" > "$BE_REQ_HASH_FILE"
else
  echo "  = backend wheels up-to-date"
fi

echo "[5/6] Frontend node_modules (only if lockfile changed)"
pushd "${APP_DIR}/frontend" >/dev/null
LOCK_HASH_CUR=$( (cat package.json 2>/dev/null; cat package-lock.json 2>/dev/null) | sha256sum | awk '{print $1}')
LOCK_HASH_FILE="${OFFLINE_DIR}/frontend-node_modules.lock.sha256"
LOCK_HASH_OLD=""; [[ -f "$LOCK_HASH_FILE" ]] && LOCK_HASH_OLD=$(cat "$LOCK_HASH_FILE") || true
if [[ "$LOCK_HASH_CUR" != "$LOCK_HASH_OLD" ]] || [[ ! -f "${OFFLINE_DIR}/frontend-node_modules.tgz" ]]; then
  echo "  > rebuilding node_modules archive"
  npm ci
  tar -czf "${OFFLINE_DIR}/frontend-node_modules.tgz" node_modules
  echo "$LOCK_HASH_CUR" > "$LOCK_HASH_FILE"
else
  echo "  = node_modules archive up-to-date"
fi
popd >/dev/null

echo "[6/6] Inference .venv archive (only if venv newer)"
VENV_DIR="${ROOT}/tt-inference-server/.venv"
VENV_TAR="${OFFLINE_DIR}/tt-inference-server-venv.tgz"
VENV_MTIME_FILE="${OFFLINE_DIR}/tt-inference-server-venv.mtime"
if [[ -d "$VENV_DIR" ]]; then
  VENV_MTIME_CUR=$(find "$VENV_DIR" -type f -printf '%T@\n' | sort -n | tail -1 || echo 0)
  VENV_MTIME_OLD=0; [[ -f "$VENV_MTIME_FILE" ]] && VENV_MTIME_OLD=$(cat "$VENV_MTIME_FILE") || true
  if [[ "$VENV_MTIME_CUR" != "$VENV_MTIME_OLD" ]] || [[ ! -f "$VENV_TAR" ]]; then
    echo "  > archiving .venv"
    tar -C "${ROOT}/tt-inference-server" -czf "$VENV_TAR" .venv
    echo "$VENV_MTIME_CUR" > "$VENV_MTIME_FILE"
  else
    echo "  = .venv archive up-to-date"
  fi
else
  echo "  = .venv not found; skipping"
fi

echo "Summary of offline bundle"
ls -lh "${OFFLINE_DIR}"


