#!/bin/bash

# Function to log messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step1.log  # Log to a standard location within the container
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

# Step 1: System update and package installation
log "Step 1: System update and package installation"

run_command "update package lists" "apt-get update"
run_command "remove existing Node.js and npm" "apt-get remove -y nodejs npm"
run_command "install pciutils" "apt-get install -y pciutils"
run_command "update packages" "apt update -y"
run_command "upgrade packages" "apt upgrade -y --no-install-recommends"

run_command "add NodeSource repository" "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
run_command "install Node.js from NodeSource" "apt-get install -y nodejs"

run_command "install additional packages" "apt install -y build-essential curl libboost-all-dev libgl1-mesa-glx libgoogle-glog-dev libhdf5-serial-dev ruby software-properties-common libzmq3-dev clang wget python3-pip python-is-python3 python3-venv git"

log "Step 1 completed successfully. :)"
