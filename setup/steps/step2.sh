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

# Step 2: Clone Git repositories into /tmp directory
log "Step 2: Clone Git repositories into /tmp directory"

# Directory to clone repositories into
clone_dir="/tmp/tenstorrent_repos"
run_command "create clone directory at $clone_dir" "mkdir -p \"$clone_dir\""

# Read repository URLs from the text file
log "Reading repositories from repos.txt"
while IFS= read -r repo; do
    if [[ ! -z "$repo" ]]; then
        repo_name=$(basename "$repo" .git)
        target_dir="$clone_dir/$repo_name"

        if [ -d "$target_dir" ] && [ "$(ls -A "$target_dir")" ]; then
            log "Skipping $repo_name as it already exists and is not empty."
        else
            run_command "clone $repo_name into $target_dir" "git clone \"$repo\" \"$target_dir\""
        fi
    fi
done < repos.txt

log "Step 2 completed successfully."
