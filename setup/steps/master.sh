#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

set -euo pipefail  # Exit on error, unset variables treated as errors, and exit on pipeline failure

# Load environment variables from common.env
ENV_FILE="inputs/common.env"
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
else
    echo "⛔ Environment file $ENV_FILE not found. Exiting."
    exit 1
fi

# Logging function
log() {
    echo "$1"
    echo "$1" >> /var/log/master.log
}

# Show usage/help
usage() {
    echo "Usage: $0 [options] <step> ..."
    echo
    echo "Options:"
    echo "  --help              Show this help message and exit."
    echo "  --sudo              Run all specified steps with sudo."
    echo "  --sudo-step <step>  Run a specific step with sudo."
    echo
    echo "Available Steps:"
    for i in "${!STEPS[@]}"; do
        echo "  ${STEPS[$i]}  - ${STEPS_DESCRIPTIONS[$i]}"
    done
    echo "  all    - Run all steps sequentially."
    echo
    echo "Examples:"
    echo "  $0 step1 step2"
    echo "  $0 --sudo all"
    exit 0
}

# Function to run step scripts with optional sudo
run_step_script() {
    local step="$1"
    local use_sudo="$2"
    local step_script="./$step.sh"

    if [[ ! -f "$step_script" ]]; then
        log "⛔ Step script $step_script not found."
        exit 1
    fi

    log "🚀 Running $step..."
    if [ "$use_sudo" = true ]; then
        sudo bash "$step_script" || { log "⛔ Failed to run $step."; exit 1; }
    else
        bash "$step_script" || { log "⛔ Failed to run $step."; exit 1; }
    fi
    log "✅ $step completed successfully."
}

# Check if any arguments were passed
if [[ "$#" -eq 0 ]]; then
    usage
fi

# Initialize variables
USE_SUDO=false
step_to_sudo=""

# Parse options
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --help)
            usage
            ;;
        --sudo)
            USE_SUDO=true
            shift
            ;;
        --sudo-step)
            step_to_sudo=$2
            shift 2
            ;;
        all)
            for step in "${STEPS[@]}"; do
                if [[ "$step" == "$step_to_sudo" ]]; then
                    run_step_script "$step" true
                else
                    run_step_script "$step" "$USE_SUDO"
                fi
            done
            shift
            ;;
        step1|step2|step3|step4|step5|step6)
            if [[ "$1" == "$step_to_sudo" ]]; then
                run_step_script "$1" true
            else
                run_step_script "$1" "$USE_SUDO"
            fi
            shift
            ;;
        *)
            echo "⛔ Unknown option or step: $1"
            usage
            ;;
    esac
done
