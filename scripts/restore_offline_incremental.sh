#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

set -euo pipefail

# Incremental restore: only reload/restore when the target differs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT}/app"
OFFLINE_DIR="${ROOT}/offline_bundle"
HOST_PV="${ROOT}/tt_studio_persistent_volume"

hash_file() {
  local p="$1"
  if [[ -d "$p" ]]; then
    find "$p" -type f -printf '%P %s %T@\n' | LC_ALL=C sort | sha256sum | awk '{print $1}'
  elif [[ -f "$p" ]]; then
    sha256sum "$p" | awk '{print $1}'
  else
    echo "missing"
  fi
}

[[ -d "$OFFLINE_DIR" ]] || { echo "Missing ${OFFLINE_DIR}"; exit 1; }

echo "[1/6] Load Docker images only if not already present"
if [[ -f "${OFFLINE_DIR}/images.tar" ]]; then
  # Check one image id as a heuristic; if missing, load all
  sample_img=$(docker compose -f "${APP_DIR}/docker-compose.yml" -f "${APP_DIR}/docker-compose.dev-mode.yml" config --images | head -n1 || true)
  if [[ -n "$sample_img" ]] && docker image inspect "$sample_img" >/dev/null 2>&1; then
    echo "  = images already present; skip load"
  else
    echo "  > loading images.tar"
    docker load -i "${OFFLINE_DIR}/images.tar"
  fi
else
  echo "  = no images.tar found; skipping"
fi

echo "[2/6] Use host HF cache (~/.cache/huggingface) in PV (bind mount if possible)"
mkdir -p "${HOME}/.cache" "${HOST_PV}/huggingface" "${HOST_PV}/model_envs"
if [[ -d "${HOME}/.cache/huggingface" ]]; then
  BIND_OK=""
  if [[ "$(uname -s)" == "Linux" ]]; then
    if ! mountpoint -q "${HOST_PV}/huggingface"; then
      if command -v sudo >/dev/null 2>&1; then
        echo "  > bind-mounting ${HOME}/.cache/huggingface -> ${HOST_PV}/huggingface"
        if sudo mount --bind "${HOME}/.cache/huggingface" "${HOST_PV}/huggingface"; then
          BIND_OK=1
        else
          echo "  = bind mount failed; will rsync instead"
        fi
      fi
    else
      echo "  = bind mount already active"
      BIND_OK=1
    fi
  fi
  if [[ -z "${BIND_OK}" ]]; then
    echo "  > rsync cache into PV"
    rsync -a --delete "${HOME}/.cache/huggingface/" "${HOST_PV}/huggingface/" || true
  fi
else
  echo "  = host HF cache not found; skipping"
fi

echo "[3/6] Restore frontend node_modules only if missing"
if [[ -f "${OFFLINE_DIR}/frontend-node_modules.tgz" ]]; then
  if [[ -d "${APP_DIR}/frontend/node_modules" ]]; then
    echo "  = node_modules exists; skipping"
  else
    echo "  > restoring node_modules"
    tar -C "${APP_DIR}/frontend" -xzf "${OFFLINE_DIR}/frontend-node_modules.tgz"
  fi
fi

echo "[4/6] Restore inference venv if missing"
if [[ -f "${OFFLINE_DIR}/tt-inference-server-venv.tgz" ]]; then
  if [[ -d "${ROOT}/tt-inference-server/.venv" ]]; then
    echo "  = .venv exists; skipping"
  else
    echo "  > restoring .venv"
    tar -C "${ROOT}/tt-inference-server" -xzf "${OFFLINE_DIR}/tt-inference-server-venv.tgz"
  fi
fi

echo "[5/7] Ensure env maps HF cache"
APP_ENV="${APP_DIR}/.env"
touch "$APP_ENV"
grep -q '^HOST_HF_HOME=' "$APP_ENV" || printf "\nHOST_HF_HOME=/tt_studio_persistent_volume/huggingface\n" >> "$APP_ENV"
grep -q '^HF_HOME=' "$APP_ENV" || printf "HF_HOME=/tt_studio_persistent_volume/huggingface\n" >> "$APP_ENV"
# Force offline mode for HF/Transformers runtime
grep -q '^TRANSFORMERS_OFFLINE=' "$APP_ENV" || printf "TRANSFORMERS_OFFLINE=1\n" >> "$APP_ENV"
grep -q '^HF_HUB_OFFLINE=' "$APP_ENV" || printf "HF_HUB_OFFLINE=1\n" >> "$APP_ENV"
# Optionally disable embeddings entirely if user requests
if [[ -n "${CHROMA_EMBED_DISABLED:-}" || -n "${TT_STUDIO_DISABLE_EMBED:-}" ]]; then
  grep -q '^CHROMA_EMBED_DISABLED=' "$APP_ENV" || printf "CHROMA_EMBED_DISABLED=1\n" >> "$APP_ENV"
  echo "  = embeddings disabled via CHROMA_EMBED_DISABLED=1"
fi

docker network create tt_studio_network >/dev/null 2>&1 || true
echo "Preparing docker compose files"
COMPOSE_ARGS=(
  -f "${APP_DIR}/docker-compose.yml"
  -f "${APP_DIR}/docker-compose.dev-mode.yml"
  -f "${APP_DIR}/docker-compose.embeds-off.override.yml"
)

# Add hardware override if Tenstorrent device exists
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

echo "[6/7] Start TT Inference Server FastAPI (if available)"
INF_DIR="${ROOT}/tt-inference-server"
VENV_UVICORN="${INF_DIR}/.venv/bin/uvicorn"
FASTAPI_LOG="${ROOT}/fastapi.log"
FASTAPI_PID="${ROOT}/fastapi.pid"
if [[ -x "${VENV_UVICORN}" ]]; then
  # Ensure tt-inference-server writable dirs
  for d in "${INF_DIR}/workflow_logs" "${INF_DIR}/persistent_volume" "${INF_DIR}/.workflow_venvs"; do
    if command -v sudo >/dev/null 2>&1; then
      sudo mkdir -p "$d" || true
      sudo chown -R "$(id -u)":"$(id -g)" "$d" || true
    else
      mkdir -p "$d" || true
      chmod -R u+rwX "$d" || true
    fi
  done
  # Free port 8001 if needed
  if ss -ltn '( sport = :8001 )' | grep -q ':8001'; then
    echo "  = Port 8001 busy; skipping FastAPI start"
  else
    echo "  > launching FastAPI on :8001"
    # Export secrets from app .env if present
    JWT_SECRET_VAL=$(grep -E '^JWT_SECRET=' "${APP_ENV}" | sed 's/^JWT_SECRET=\"\?//; s/\"\?$//') || true
    HF_TOKEN_VAL=$(grep -E '^HF_TOKEN=' "${APP_ENV}" | sed 's/^HF_TOKEN=\"\?//; s/\"\?$//') || true
    export JWT_SECRET="${JWT_SECRET_VAL:-}"
    export HF_TOKEN="${HF_TOKEN_VAL:-}"
    export TT_STUDIO_SKIP_PIP=1
    nohup "${VENV_UVICORN}" --app-dir "${INF_DIR}" api:app --host 0.0.0.0 --port 8001 >"${FASTAPI_LOG}" 2>&1 & echo $! > "${FASTAPI_PID}"
  fi
else
  echo "  = ${VENV_UVICORN} not found; skip FastAPI"
fi

echo "[7/8] Ensure at least one model is deployed (populate deploy cache)"
# Wait for backend readiness
for i in {1..30}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/docker/catalog/ || true)
  if [[ "$code" == "200" ]]; then break; fi; sleep 1;
done

DEPLOY_JSON="$(curl -fsS http://localhost:8000/docker/catalog/ 2>/dev/null || echo '{}')"
MODEL_ID="$(python3 - <<'PY'
import json,sys
try:
    data=json.loads(sys.stdin.read())
    models=data.get('models',{})
    # prefer non-chat models that already exist
    for k,v in models.items():
        if v.get('exists') and v.get('model_type') in ('image_generation','object_detection','speech_recognition'):
            print(k)
            sys.exit(0)
    # fallback to any existing model
    for k,v in models.items():
        if v.get('exists'):
            print(k)
            sys.exit(0)
except Exception:
    pass
print("")
PY
<<< "$DEPLOY_JSON")"

if [[ -n "$MODEL_ID" ]]; then
  echo "  > deploying model: $MODEL_ID"
  curl -fsS -X POST http://localhost:8000/docker/deploy/ \
    -H 'Content-Type: application/json' \
    -d "{\"model_id\":\"$MODEL_ID\",\"weights_id\":\"\"}" >/dev/null || true
  # give backend time to refresh cache
  sleep 3
  echo "  = deployed models: $(curl -fsS http://localhost:8000/models/deployed/ | wc -c) bytes"
else
  echo "  = no suitable pre-pulled model found to auto-deploy"
fi

echo "[8/8] Done. Open http://localhost:3000"


