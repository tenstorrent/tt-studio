#!/bin/bash

# Configuration: directory and module details
directory="/tmp/tenstorrent_repos/tt-kmd"
dkms_module="tenstorrent/1.29"

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

# Step 5: Install tt-kmd using dkms
log "Step 5: Install tt-kmd using dkms"

# Check if the directory exists
if [ -d "$directory" ]; then
    cd "$directory" || { log "Failed to navigate to $directory"; exit 1; }
    log "Navigated to $directory"
else
    log "Directory $directory does not exist. Exiting."
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

# Check if the DKMS module is already added
if echo "$dkms_status" | grep -q "$dkms_module"; then
    log "Skipping DKMS add for $dkms_module as it already exists."
else
    run_command "add DKMS module" "dkms add ."
fi

# Install the DKMS module
run_command "install DKMS module $dkms_module" "dkms install $dkms_module"

# Load the module
run_command "load tenstorrent module" "modprobe tenstorrent"

log "Completed installing tt-kmd using dkms."
