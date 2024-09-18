#!/bin/bash

# Log function for messages
log() {
    echo "$1"
    echo "$1" >> /var/log/install_clone.log
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

# Step 3: Run hugepages-setup.sh script
log "Step 3: Run hugepages-setup.sh script"

# Check if the directory exists from the env variable
if [ -d "$TT_SYSTEM_TOOLS_DIR" ]; then
    cd "$TT_SYSTEM_TOOLS_DIR" || { log "Failed to navigate to $TT_SYSTEM_TOOLS_DIR"; exit 1; }
    log "Navigated to $TT_SYSTEM_TOOLS_DIR"
else
    log "Directory $TT_SYSTEM_TOOLS_DIR does not exist. Exiting."
    exit 1
fi

# Ensure the script is executable, script name from env variable
run_command "make $HUGEPAGES_SCRIPT executable" "chmod +x ./$HUGEPAGES_SCRIPT"

# Run the script
run_command "run $HUGEPAGES_SCRIPT" "./$HUGEPAGES_SCRIPT"

# Step 3 continued: Verify hugepages setup
log "Step 3 continued: Verify hugepages setup"

# Check if HugePages_Total exists in /proc/meminfo
if grep -q HugePages_Total /proc/meminfo; then
    log "Completed hugepage setup"
else
    log "Hugepage setup failed"
    exit 1
fi

log "Step 3 completed successfully."
