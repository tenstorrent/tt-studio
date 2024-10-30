#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

set -euo pipefail  # Exit on error, unset variables treated as errors, and exit on pipeline failure

# setup steps directory
SETUP_DIR="./setup/steps"
ENV_FILE="$SETUP_DIR/inputs/common.env"

#  environment variables 
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
else
    echo "⛔ Environment file $ENV_FILE not found. Exiting."
    exit 1
fi

# Logging function with conditional sudo
log() {
    if [ "$USE_SUDO" = true ]; then
        sudo bash -c "echo '$1' >> /var/log/master.log"
    else
        echo "$1" >> /var/log/master.log
    fi
    echo "$1"
}

# Final summary log for errors
summary_log=""

# Show usage/help
usage() {
    echo -e "🤖Usage: ./setup.sh [options] <step> ..."
    echo
    echo -e "Options:"
    echo -e "  --help              ❓ Show this help message and exit."
    echo -e "  --sudo              🔐 Run all specified steps with sudo."
    echo -e "  --sudo-step         🔐 Run a specific step with sudo."
    echo -e "  --step              🪜 Run a specific step without sudo."
    echo
    echo -e "Available Steps:"
    echo -e "  step1  - 📦 Install required packages"
    echo -e "  step2  - 🔄 Clone repositories"
    echo -e "  step3  - 💾 Setup hugepages"
    echo -e "  step4  - 🛠️  Install DKMS module"
    echo -e "  step5  - 🌐 Setup Python virtual environment and flash firmware"
    echo -e "  step6  - 🗺️  Run tt topology command"
    echo -e "  all    - 🚀 Run all steps sequentially."
    echo
    echo -e "Examples:"
    echo -e "  ./setup.sh step1 step2"
    echo -e "  ./setup.sh --sudo all"
    exit 0
}

run_step_script() {
    local step="$1"
    local use_sudo="$2"
    local step_script="$SETUP_DIR/$step.sh"

    if [[ ! -f "$step_script" ]]; then
        log "⛔ Step script $step_script not found."
        summary_log+="Failed: $step script not found.\n"
        return
    fi

    log "🚀 Running $step..."
    if [ "$use_sudo" = true ]; then
        sudo bash "$step_script" || { 
            log "⛔ Failed to run $step."
            summary_log+="Failed: $step\n"
            return
        }
    else
        bash "$step_script" || { 
            log "⛔ Failed to run $step."
            summary_log+="Failed: $step\n"
            return
        }
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

if [[ -n "$summary_log" ]]; then
    echo -e "⚠️  Summary of failures:\n$summary_log" | tee -a /var/log/master.log
fi
