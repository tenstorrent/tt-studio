#!/bin/bash

# Function to log messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step4.log  # Log to a standard location within the container
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

# Step 4: Run hugepages-setup.sh script
log "Step 4: Run hugepages-setup.sh script"

# Define the directory where the script should be located
directory="/tmp/tenstorrent_repos/tt-system-tools"

# Check if the directory exists
if [ -d "$directory" ]; then
    cd "$directory" || { log "Failed to navigate to $directory"; exit 1; }
    log "Navigated to $directory"
else
    log "Directory $directory does not exist. Exiting."
    exit 1
fi

# Ensure the script is executable
run_command "make hugepages-setup.sh executable" "chmod +x ./hugepages-setup.sh"

# Run the script with or without sudo
run_command "run hugepages-setup.sh" "./hugepages-setup.sh"

# Step 4 continued: Verify hugepages setup
log "Step 4 continued:: Verify hugepages setup"

# Check if HugePages_Total exists in /proc/meminfo
if grep -q HugePages_Total /proc/meminfo; then
    log "Completed hugepage setup"
else
    log "Hugepage setup failed"
    exit 1
fi

log "Step 4 completed successfully."
