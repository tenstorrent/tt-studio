#!/bin/bash

# Function to log messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step5.log  # Log to a standard location within the container
}

# Function to run a command with optional sudo and log its success or failure
run_command() {
    local description="$1"
    local command="$2"
    local use_sudo="${USE_SUDO:-false}"  # Use the USE_SUDO environment variable if set
    
    if [ "$use_sudo" = true ]; then
        command="sudo $command"
    fi
    
    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}

# Step 5: Install tt-kmd using dkms
log "Step 5: Install tt-kmd using dkms"

# Define the directory where the tt-kmd repository is located
directory="/tmp/tenstorrent_repos/tt-kmd"

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

# Check if the DKMS module is already added
if dkms status | grep -q "tenstorrent/1.29"; then
    log "Skipping DKMS add for tenstorrent-1.29 as it already exists."
else
    run_command "add DKMS module" "dkms add ."
fi

# Install the DKMS module
run_command "install DKMS module tenstorrent/1.29" "dkms install tenstorrent/1.29"

# Load the module
run_command "load tenstorrent module" "modprobe tenstorrent"

log "Completed installing tt-kmd using dkms."
