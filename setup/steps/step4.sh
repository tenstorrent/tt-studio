#!/bin/bash
# Step 4: Installing tt-kmd using DKMS

# Set up absolute paths based on this script's location
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_DIR="$STEP_DIR/"
ENV_FILE="$SETUP_DIR/inputs/common.env"
COMMON_SH="$SETUP_DIR/common.sh"

if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
else
    echo "⛔ Environment file $ENV_FILE not found."
    exit 1
fi

if [[ -f "$COMMON_SH" ]]; then
    source "$COMMON_SH"
else
    echo "⛔ Common functions file $COMMON_SH not found."
    exit 1
fi

log "Step 4: Installing tt-kmd using DKMS"
load_env

# Ensure that the TT_KMD_DIR directory exists
if [ -d "$TT_KMD_DIR" ]; then
    cd "$TT_KMD_DIR" || { log "⛔ Failed to navigate to $TT_KMD_DIR"; exit 1; }
    log "📂 Navigated to $TT_KMD_DIR"
else
    log "⛔ Directory $TT_KMD_DIR does not exist. Exiting."
    exit 1
fi

run_command "fetch all tags" "git fetch --all --tags"
run_command "check out version $TT_KMD_VERSION" "git checkout tags/$TT_KMD_VERSION"
run_command "install DKMS module $DKMS_MODULE" "sudo dkms install $DKMS_MODULE"
run_command "load Tenstorrent module" "sudo modprobe tenstorrent"

log "🎉 Step 4: Successfully installed tt-kmd using DKMS version $TT_KMD_VERSION."
