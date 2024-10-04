#!/bin/bash
source ./common.sh

log "Step 1: Installing packages"
load_env

if [[ -z "$PACKAGES" ]]; then
    log "⛔ No packages defined in environment file."
    exit 1
fi

for package in $PACKAGES; do
    run_command "install $package" "apt-get install -y $package"
done

log "🎉 All packages installed successfully."
