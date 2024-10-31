#!/bin/bash

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

log "Step 2: Cloning repositories"

# Ensure required environment variables are loaded
if [[ -z "$REPOSITORIES" ]]; then
    log "⛔ No repositories defined in environment file."
    exit 1
fi

run_command "Create clone directory at $CLONE_DIR" "mkdir -p \"$CLONE_DIR\""

for repo in $REPOSITORIES; do
    repo_name=$(basename "$repo" .git)
    target_dir="$CLONE_DIR/$repo_name"

    if [[ -d "$target_dir" && -n "$(ls -A "$target_dir")" ]]; then
        log "⚠️ Skipping $repo_name, as it already exists and is not empty."
    else
        run_command "Clone $repo_name into $target_dir" "git clone \"$repo\" \"$target_dir\""
    fi
done

log "🎉 Step 2: Cloning repositories completed successfully."
