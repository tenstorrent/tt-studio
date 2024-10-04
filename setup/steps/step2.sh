#!/bin/bash
source ./common.sh

log "Step 2: Cloning repositories"
load_env

if [[ -z "$REPOSITORIES" ]]; then
    log "⛔ No repositories defined in environment file."
    exit 1
fi

run_command "create clone directory at $CLONE_DIR" "mkdir -p \"$CLONE_DIR\""

for repo in $REPOSITORIES; do
    repo_name=$(basename "$repo" .git)
    target_dir="$CLONE_DIR/$repo_name"

    if [[ -d "$target_dir" && -n "$(ls -A "$target_dir")" ]]; then
        log "⚠️ Skipping $repo_name, as it already exists and is not empty."
    else
        run_command "clone $repo_name into $target_dir" "git clone \"$repo\" \"$target_dir\""
    fi
done

log "🎉 Step 2: Cloning repositories completed successfully."
