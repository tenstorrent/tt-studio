#!/bin/bash
source ./common.sh

log "Step 4: Installing tt-kmd using DKMS"
load_env

# Navigate to the tt-kmd directory
if [ -d "$TT_KMD_DIR" ]; then
    cd "$TT_KMD_DIR" || { log "⛔ Failed to navigate to $TT_KMD_DIR"; exit 1; }
    log "📂 Navigated to $TT_KMD_DIR"
else
    log "⛔ Directory $TT_KMD_DIR does not exist. Exiting."
    exit 1
fi

# Checkout the specific version of the driver
run_command "check out version $TT_KMD_VERSION" "git checkout -- $TT_KMD_VERSION"

# Install the necessary kernel headers for the current kernel version
kernel_version=$(uname -r)
run_command "install kernel headers for $kernel_version" "apt-get update && apt-get install -y linux-headers-$kernel_version"

# Check existing DKMS modules and log Tenstorrent-related drivers
log "🔍 Checking existing DKMS modules"
dkms_status=$(dkms status)

if echo "$dkms_status" | grep -q "tenstorrent"; then
    log "✅ Tenstorrent-related drivers found:"
    echo "$dkms_status" | grep "tenstorrent" | while IFS= read -r line; do
        log "$line"
    done
else
    log "⚠️ No Tenstorrent-related drivers found in DKMS."
fi

# Check if the DKMS module is already added, skip if it exists
if echo "$dkms_status" | grep -q "$DKMS_MODULE"; then
    log "🔄 Skipping DKMS add for $DKMS_MODULE as it already exists."
else
    run_command "add DKMS module" "dkms add ."
fi

# Install and load the DKMS module
run_command "install DKMS module $DKMS_MODULE" "dkms install $DKMS_MODULE"
run_command "load Tenstorrent module" "modprobe tenstorrent"

log "🎉 Step 4: Successfully installed tt-kmd using DKMS version $TT_KMD_VERSION."
