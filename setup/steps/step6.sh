#!/bin/bash
source ./common.sh

log "Step 6: Setting up Python virtual environment and running topology command"
load_env

if [ ! -d "$TT_TOPOLOGY_VENV_PATH" ]; then
    log "Creating Python virtual environment for tt-topology..."
    run_command "create Python virtual environment" "python3 -m venv \"$TT_TOPOLOGY_VENV_PATH\""
    log "Virtual environment created at $TT_TOPOLOGY_VENV_PATH"
fi

. "$TT_TOPOLOGY_VENV_PATH/bin/activate"
log "Activated virtual environment at $TT_TOPOLOGY_VENV_PATH"


cd "$TT_TOPOLOGY_DIR" || { log "⛔ Failed to navigate to $TT_TOPOLOGY_DIR"; exit 1; }
log "📂 Navigated to tt-topology repository at $TT_TOPOLOGY_DIR"


if [ -f "requirements.txt" ]; then
    run_command "install tt-topology dependencies" "pip install -r requirements.txt"
fi


run_command "run tt-topology -l mesh" "./tt-topology -l mesh"

log "🎉 Step 6: tt-topology setup and mesh command completed successfully."
