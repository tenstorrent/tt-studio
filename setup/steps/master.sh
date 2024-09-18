#!/bin/bash

# Function to run a script with or without sudo
run_with_sudo() {
    local use_sudo="$1"
    local script="$2"
    
    if [ "$use_sudo" = true ]; then
        sudo bash "$script"
    else
        bash "$script"
    fi
}

# Parse command-line arguments
USE_SUDO=false
if [[ "$1" == "--sudo" ]]; then
    USE_SUDO=true
fi

# # Run the step1 script
run_with_sudo $USE_SUDO "step1.sh"

# # # Run the step2 script
run_with_sudo $USE_SUDO "step2.sh"

# # Run the step3 script
run_with_sudo $USE_SUDO "step3.sh"

# # Run the step4script
run_with_sudo $USE_SUDO "step4.sh"

# Run the step5script
run_with_sudo $USE_SUDO "step5.sh"
