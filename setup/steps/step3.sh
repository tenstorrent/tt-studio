#!/bin/bash

# Function to log messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step3.log  # Log to a standard location within the container
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

# Step 3: Clone Git repositories into /tmp directory
log "Step 3: Clone Git repositories into /tmp directory"

# Directory to clone repositories into
clone_dir="/tmp/tenstorrent_repos"
run_command "create clone directory at $clone_dir" "mkdir -p \"$clone_dir\""

# List of repositories to clone
repo_urls="https://github.com/tenstorrent/tt-system-tools
https://github.com/tenstorrent/tt-kmd
https://github.com/tenstorrent/tt-firmware
https://github.com/tenstorrent/tt-flash
https://github.com/tenstorrent/tt-smi"

# Clone each repository
for repo in $repo_urls; do
    repo_name=$(basename "$repo" .git)
    target_dir="$clone_dir/$repo_name"

    if [ -d "$target_dir" ] && [ "$(ls -A "$target_dir")" ]; then
        log "Skipping $repo_name as it already exists and is not empty."
    else
        run_command "clone $repo_name into $target_dir" "git clone \"$repo\" \"$target_dir\""
    fi
done

log "Step 3 completed successfully."
