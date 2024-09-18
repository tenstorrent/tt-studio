#!/bin/bash

# Log function for messages
log() {
    echo "$1"
    echo "$1" >> /var/log/clone_repos.log
}

# Command runner with optional sudo
run_command() {
    local description="$1"
    local command="$2"

    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}

# Load environment variables from the .env file
log "Reading repositories from environment file"
source inputs/common.env

# Step 2: Clone Git repositories into /tmp directory
log "Step 2: Clone Git repositories into /tmp directory"

# Directory to clone repositories into
clone_dir="/tmp/tenstorrent_repos"
run_command "create clone directory at $clone_dir" "mkdir -p \"$clone_dir\""

# Check if REPOSITORIES variable is set
if [[ -z "$REPOSITORIES" ]]; then
    log "No repositories defined in environment file."
    exit 1
fi

#* Read repositories from the REPOSITORIES variable and clone them
for repo in $REPOSITORIES; do
    if [[ ! -z "$repo" ]]; then
        repo_name=$(basename "$repo" .git)
        target_dir="$clone_dir/$repo_name"

        if [ -d "$target_dir" ] && [ "$(ls -A "$target_dir")" ]; then
            log "Skipping $repo_name as it already exists and is not empty."
        else
            run_command "clone $repo_name into $target_dir" "git clone \"$repo\" \"$target_dir\""
        fi
    fi
done

log "Step 2 completed successfully."
