#!/bin/bash

# Function to log messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step2.log  # Log to a standard location within the container
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

# Step 2: Download and install YAML-CPP
log "Step 2: Download and install YAML-CPP"

run_command "download libyaml-cpp-dev" "wget http://mirrors.kernel.org/ubuntu/pool/main/y/yaml-cpp/libyaml-cpp-dev_0.6.2-4ubuntu1_amd64.deb"
run_command "download libyaml-cpp0.6" "wget http://mirrors.kernel.org/ubuntu/pool/main/y/yaml-cpp/libyaml-cpp0.6_0.6.2-4ubuntu1_amd64.deb"

run_command "install YAML-CPP packages" "dpkg -i libyaml-cpp-dev_0.6.2-4ubuntu1_amd64.deb libyaml-cpp0.6_0.6.2-4ubuntu1_amd64.deb"

run_command "remove downloaded files" "rm libyaml-cpp-dev_0.6.2-4ubuntu1_amd64.deb libyaml-cpp0.6_0.6.2-4ubuntu1_amd64.deb"

run_command "install dkms" "apt install -y dkms"

log "Step 2 completed successfully. :)"
