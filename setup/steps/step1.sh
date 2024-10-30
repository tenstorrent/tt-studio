#!/bin/bash
# step1.sh - Step 1: Installing packages

log() {
    echo "$1"
    echo "$1" >> /var/log/step1.log
}


source ./inputs/common.env
source ./common.sh  

log "Step 1: Installing packages..."

run_command "Updating package list" "apt-get update"

for package in "${PACKAGES[@]}"; do
    run_command "Installing package: $package" "apt-get install -y $package"
done

log "Checking for broken dependencies..."
run_command "Fixing broken dependencies" "apt --fix-broken install"

log "🎉 Step 1: All packages installed successfully."
