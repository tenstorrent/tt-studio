#!/bin/bash
# step1.sh - Step 1: Installing packages

# Set up absolute paths based on this script's location
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_DIR="$STEP_DIR/"
ENV_FILE="$SETUP_DIR/inputs/common.env"
COMMON_SH="$SETUP_DIR/common.sh"

if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
else
    echo "⛔ Environment file $ENV_FILE not found."
    exit 1
fi

if [[ -f "$COMMON_SH" ]]; then
    source "$COMMON_SH"
else
    echo "⛔ Common functions file $COMMON_SH not found."
    exit 1
fi

log "Step 1: Installing packages..."

run_command "Updating package list" "apt-get update"

for package in "${PACKAGES[@]}"; do
    run_command "Installing package: $package" "apt-get install -y $package"
done

log "Checking for broken dependencies..."
run_command "Fixing broken dependencies" "apt --fix-broken install"

log "🎉 Step 1: All packages installed successfully."
