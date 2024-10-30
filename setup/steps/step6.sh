#!/bin/bash
source ./common.sh

log "Step 6: Setting up Python virtual environment and running topology command"
load_env

read -p "Is this system a 'TT Loudbox' or 'TT Quiet box'? (Y/N): " system_type
if [[ "$system_type" != "yes" ]]; then
    log "⛔ This script can only be run on a 'loudbox' or 'quiet box' system. Exiting.
    Read more here: https://github.com/tenstorrent/tt-topology"
    exit 1
fi

log "Confirmed system type as 'TT Loudbox' or 'TT Quiet Box'"

if [ ! -d "$TT_TOPOLOGY_VENV_PATH" ]; then
    log "Creating Python virtual environment for tt-topology..."
    run_command "create Python virtual environment" "python3 -m venv \"$TT_TOPOLOGY_VENV_PATH\""
    log "Virtual environment created at $TT_TOPOLOGY_VENV_PATH"
fi

. "$TT_TOPOLOGY_VENV_PATH/bin/activate"
log "Activated virtual environment at $TT_TOPOLOGY_VENV_PATH"

cd "$TT_TOPOLOGY_DIR" || { log "⛔ Failed to navigate to $TT_TOPOLOGY_DIR"; exit 1; }
log "📂 Navigated to tt-topology repository at $TT_TOPOLOGY_DIR"


run_command "run tt-topology -l mesh" "./tt-topology -l mesh"

log "🎉 Step 6: tt-topology setup and mesh command completed successfully."
