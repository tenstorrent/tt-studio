#!/bin/bash

# Log function for messages
log() {
    echo "$1"
    echo "$1" >> /var/log/install.log
}

# Command runner with optional sudo
run_command() {
    local description="$1"
    local command="$2"

    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}

# Load environment variables from the .env file
log "Reading packages from environment file"
source inputs/packages.env

# Check if PACKAGES variable is set
if [[ -z "$PACKAGES" ]]; then
    log "No packages defined in environment file."
    exit 1
fi

#* Read packages from the PACKAGES variable and install them
for package in $PACKAGES; do
    if [[ ! -z "$package" ]]; then
        run_command "install $package" "apt-get install -y $package"
    fi
done

log "All packages installed successfully."
