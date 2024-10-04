#!/bin/bash

# Log function for consistent logging to both stdout and a log file
log() {
    echo "$1"
    echo "$1" >> /var/log/script.log
}

# run_command function: templates a command with optional logging and error handling
# 
# Arguments:
#   $1 - Description of the action being performed (used for logging purposes).
#   $2 - The actual command to be executed.
#
# Behavior:
#   - The function evaluates the provided command ($2) using `eval`.
#   - If the command executes successfully (exit code 0), it logs a success message with a checkmark emoji.
#   - If the command fails (non-zero exit code), it logs a failure message with a cross emoji and exits the script with an error.
#
# Example Usage:
#   run_command "Updating package list" "apt-get update"
#   run_command "Cloning repository" "git clone https://github.com/repo.git /target-dir"


run_command() {
    if eval "$2"; then
        log "✅ $1 completed successfully."
    else
        log "⛔ Failed to $1"
        exit 1
    fi
}

# Function to load environment variables from a common.env file
# Ensures that environment variables are sourced from a predefined location.
# Exits with an error if the file is not found.
load_env() {
    ENV_FILE="inputs/common.env"
    log "Reading environment from: $ENV_FILE"

    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
    else
        log "⛔ Environment file $ENV_FILE not found."
        exit 1
    fi
}
