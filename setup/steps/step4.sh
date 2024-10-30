#!/bin/bash
# Step 4: Installing tt-kmd using DKMS

source ./common.sh

log "Step 4: Installing tt-kmd using DKMS"
load_env


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
