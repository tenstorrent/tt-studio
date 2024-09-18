#!/bin/bash

# Configuration: directory and script name
directory="/tmp/tenstorrent_repos/tt-system-tools"
script="hugepages-setup.sh"

# Log function for messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step4.log  # Log to a standard location
}

# Command runner with optional sudo
run_command() {
    local description="$1"
    local command="$2"

    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}

# Step 4: Run hugepages-setup.sh script
log "Step 4: Run $script script"

# Check if the directory exists
if [ -d "$directory" ]; then
    cd "$directory" || { log "Failed to navigate to $directory"; exit 1; }
    log "Navigated to $directory"
else
    log "Directory $directory does not exist. Exiting."
    exit 1
fi

# Ensure the script is executable
run_command "make $script executable" "chmod +x ./$script"

# Run the script
run_command "run $script" "./$script"

# Step 4 continued: Verify hugepages setup
log "Step 4 continued: Verify hugepages setup"

# Check if HugePages_Total exists in /proc/meminfo
if grep -q HugePages_Total /proc/meminfo; then
    log "Completed hugepage setup"
else
    log "Hugepage setup failed"
    exit 1
fi

log "Step 4 completed successfully."
