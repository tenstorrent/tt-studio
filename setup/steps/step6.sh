#!/bin/bash

# Function to log messages
log() {
    echo "$1"
    echo "$1" >> /var/log/step6.log  # Log to a standard location within the container
}

# Function to run a command with optional sudo and log its success or failure
run_command() {
    local description="$1"
    local command="$2"
    local use_sudo="${USE_SUDO:-false}"
    
    if [ "$use_sudo" = true ]; then
        command="sudo $command"
    fi
    
    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}

# Step 6: Install Rust, tt-flash, and Flash Firmware
log "Step 6: Install Rust, tt-flash, and Flash Firmware"

# Define the virtual environment, directory, and firmware path
venv_path="/tmp/tenstorrent_repos/venv"
tt_flash_repo="/tmp/tenstorrent_repos/tt-flash"
firmware_path="/tmp/tenstorrent_repos/tt-firmware/fw_pack-80.10.0.0.fwbundle"

# Check and install required packages
required_packages="python3-venv curl build-essential"
for package in $required_packages; do
    if ! dpkg -l | grep -q $package; then
        run_command "install $package" "apt-get update && apt-get install -y $package"
    fi
done

# Remove existing Rust installation if present
if [ -d "$HOME/.cargo" ]; then
    log "Removing existing Rust installation..."
    run_command "remove existing Rust installation" "rm -rf \"$HOME/.cargo\" \"$HOME/.rustup\""
fi

# Install Rust
log "Installing Rust..."
run_command "install Rust" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
export PATH="$HOME/.cargo/bin:$PATH"
run_command "set Rust default to stable" "rustup default stable"
run_command "verify Rust installation" "rustc --version"
run_command "verify Cargo installation" "cargo --version"

# Create Python virtual environment if not exists
if [ ! -d "$venv_path" ]; then
    log "Creating Python virtual environment..."
    run_command "create Python virtual environment" "python3 -m venv \"$venv_path\""
    log "Virtual environment created at $venv_path"
fi

# Activate the virtual environment
. "$venv_path/bin/activate"
log "Activated virtual environment"

# Set the path to the virtual environment's Python and pip
VENV_PYTHON="$venv_path/bin/python"
VENV_PIP="$venv_path/bin/pip"

# Upgrade pip and install wheel
run_command "upgrade pip, wheel, and setuptools" "$VENV_PIP install --upgrade pip wheel setuptools"

# Check if the tt-flash repository directory exists
if [ -d "$tt_flash_repo" ]; then
    cd "$tt_flash_repo" || { log "Failed to navigate to $tt_flash_repo"; exit 1; }
    log "Navigated to tt-flash repository at $tt_flash_repo"
else
    log "tt-flash repository not found at $tt_flash_repo. Exiting."
    exit 1
fi

# Install tt-flash using pip
log "Installing tt-flash using pip..."
run_command "install tt-flash" "$VENV_PIP install ."

# Verify that tt-flash is installed and accessible
if ! "$venv_path/bin/tt-flash" -h; then
    log "tt-flash -h command failed. Exiting."
    exit 1
fi

log "Step 6 completed successfully: Rust and tt-flash installed."

# Step 8: Flash firmware using tt-flash
log "Step 8: Flash firmware using tt-flash"

# Check if the firmware file exists
if [ -f "$firmware_path" ]; then
    log "Firmware file found at $firmware_path"
else
    log "Firmware file not found at $firmware_path. Exiting."
    exit 1
fi

# Flash the firmware using tt-flash
run_command "flash firmware using tt-flash" "$venv_path/bin/tt-flash flash --fw-tar \"$firmware_path\""

log "Step 8 flashing completed successfully."
