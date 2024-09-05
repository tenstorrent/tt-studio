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

log "Reading packages from text file"

#* Read packages from text file and install them
while IFS= read -r package; do
    if [[ ! -z "$package" ]]; then
        run_command "install $package" "apt-get install -y $package"
    fi
done < inputs/packages.txt
log "All packages installed successfully."
