#!/bin/bash

# Log function for messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step5.log  # Log to a standard location
}

# Command runner with optional sudo
run_command() {
    local description="$1"
    local command="$2"

    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}

# Load environment variables from the .env file
log "Reading environment variables from common.env"
source inputs/common.env

# Step 5: Install tt-kmd using dkms
log "Step 5: Install tt-kmd using dkms"

# Check if the directory exists from the env variable
if [ -d "$TT_KMD_DIR" ]; then
    cd "$TT_KMD_DIR" || { log "Failed to navigate to $TT_KMD_DIR"; exit 1; }
    log "Navigated to $TT_KMD_DIR"
else
    log "Directory $TT_KMD_DIR does not exist. Exiting."
    exit 1
fi

# Install the necessary kernel headers
kernel_version=$(uname -r)
run_command "install kernel headers for $kernel_version" "apt-get update && apt-get install -y linux-headers-$kernel_version"

# List all DKMS modules and inform the user about Tenstorrent-related drivers
log "Checking existing DKMS modules"
dkms_status=$(dkms status)

if echo "$dkms_status" | grep -q "tenstorrent"; then
    log "Tenstorrent-related drivers found:"
    echo "$dkms_status" | grep "tenstorrent" | while IFS= read -r line; do
        log "$line"
    done
else
    log "No Tenstorrent-related drivers found in DKMS."
fi

# Check if the DKMS module is already added using the env variable
if echo "$dkms_status" | grep -q "$DKMS_MODULE"; then
    log "Skipping DKMS add for $DKMS_MODULE as it already exists."
else
    run_command "add DKMS module" "dkms add ."
fi

# Install the DKMS module using the env variable
run_command "install DKMS module $DKMS_MODULE" "dkms install $DKMS_MODULE"

# Load the module
run_command "load tenstorrent module" "modprobe tenstorrent"

log "Step 4: Completed installing tt-kmd using dkms."
