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


log() {
    echo "$1"
    echo "$1" >> /var/log/master.log
}


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

# Function to run commands with optional sudo
run_command() {
    local description="$1"
    local command="$2"
    local use_sudo="$3"

    log "🚀 $description..."
    if [ "$use_sudo" = true ]; then
        sudo bash -c "$command" || { log "⛔ Failed to $description"; exit 1; }
    else
        bash -c "$command" || { log "⛔ Failed to $description"; exit 1; }
    fi
    log "✅ $description completed successfully."
}

# Define the steps
step1() {
    log "Step 1: Installing packages..."
    run_command "Install packages" "apt-get install -y $PACKAGES" $USE_SUDO
}

step2() {
    log "Step 2: Cloning repositories..."
    for repo in $REPOSITORIES; do
        run_command "Clone repository $repo" "git clone $repo /tmp/tenstorrent_repos" $USE_SUDO
    done
}

step3() {
    log "Step 3: Setting up hugepages..."
    run_command "Make hugepages script executable" "chmod +x $TT_SYSTEM_TOOLS_DIR/$HUGEPAGES_SCRIPT" $USE_SUDO
    run_command "Run hugepages script" "$TT_SYSTEM_TOOLS_DIR/$HUGEPAGES_SCRIPT" $USE_SUDO
}

step4() {
    log "Step 4: Installing DKMS module..."
    run_command "Navigate to DKMS directory" "cd $TT_KMD_DIR" $USE_SUDO
    run_command "Install DKMS module" "dkms add $DKMS_MODULE && dkms install $DKMS_MODULE" $USE_SUDO
}

step5() {
    log "Step 5: Setting up Python virtual environment and flashing firmware..."
    run_command "Create Python virtual environment" "python3 -m venv $VENV_PATH" $USE_SUDO
    run_command "Activate virtual environment and install tt-flash" "$VENV_PATH/bin/pip install $TT_FLASH_REPO" $USE_SUDO
    run_command "Flash firmware using tt-flash" "$VENV_PATH/bin/tt-flash flash --fw-tar $FIRMWARE_PATH" $USE_SUDO
}

# Check if arguments are passed
if [[ $# -lt 1 ]]; then
    usage
fi

# Parse command-line arguments
USE_SUDO=false
if [[ "$1" == "--help" ]]; then
    usage
elif [[ "$1" == "--sudo" ]]; then
    USE_SUDO=true
    shift
fi

# If 'all' is specified, run all steps
if [[ "$1" == "all" ]]; then
    steps=("step1" "step2" "step3" "step4" "step5")
else
    steps=("$@")
fi

# Run each specified step
for step in "${steps[@]}"; do
    case $step in
        step1) step1 ;;
        step2) step2 ;;
        step3) step3 ;;
        step4) step4 ;;
        step5) step5 ;;
        *) log "⛔ Invalid step: $step"; usage ;;
    esac
done

log "🎉 All requested steps completed successfully."
